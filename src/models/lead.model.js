/**
 * Simple Lead Model for Firestore
 * Straightforward structure without complex indexing
 */

// Import auto-qualification configuration
const { QUALIFICATION_RULES } = require("../config/autoQualification.config");
const { LEAD_STATUSES, LEAD_SOURCES } = require("../config/lead.constants");

// Auto-qualification rules (moved to separate config file)
// Keeping here for backwards compatibility - will be deprecated
const DEPRECATED_QUALIFICATION_RULES = {
  // Use AUTO_QUALIFICATION_CONFIG from config file instead
  PRE_QUALIFIED_INTERACTION_THRESHOLD: 3,
  QUALIFYING_INTERACTION_TYPES: ["WHATSAPP", "EMAIL", "PHONE", "MEETING"],
  ELIGIBLE_STATUSES_FOR_AUTO_QUALIFICATION: [
    LEAD_STATUSES.INQUIRY,
    LEAD_STATUSES.CONTACTED,
    LEAD_STATUSES.NURTURE,
  ],
};

// Status transition rules - simple array of allowed next statuses
const STATUS_TRANSITIONS = {
  [LEAD_STATUSES.INQUIRY]: [
    LEAD_STATUSES.CONTACTED,
    LEAD_STATUSES.PRE_QUALIFIED,
    LEAD_STATUSES.APPLIED,
    LEAD_STATUSES.NURTURE,
  ],
  [LEAD_STATUSES.CONTACTED]: [
    LEAD_STATUSES.PRE_QUALIFIED,
    LEAD_STATUSES.APPLIED,
    LEAD_STATUSES.NURTURE,
  ],
  [LEAD_STATUSES.NURTURE]: [LEAD_STATUSES.PRE_QUALIFIED, LEAD_STATUSES.EXPIRED],
  [LEAD_STATUSES.PRE_QUALIFIED]: [
    LEAD_STATUSES.APPLIED,
    LEAD_STATUSES.FOLLOW_UP,
  ],
  [LEAD_STATUSES.FOLLOW_UP]: [LEAD_STATUSES.APPLIED, LEAD_STATUSES.NURTURE],
  [LEAD_STATUSES.APPLIED]: [
    LEAD_STATUSES.QUALIFIED,
    LEAD_STATUSES.REVIEW,
    LEAD_STATUSES.DISQUALIFIED,
  ],
  [LEAD_STATUSES.REVIEW]: [LEAD_STATUSES.QUALIFIED, LEAD_STATUSES.DISQUALIFIED],
  [LEAD_STATUSES.QUALIFIED]: [
    LEAD_STATUSES.ADMITTED,
    LEAD_STATUSES.PENDING_DOCS,
    LEAD_STATUSES.REJECTED,
  ],
  [LEAD_STATUSES.PENDING_DOCS]: [LEAD_STATUSES.ADMITTED, LEAD_STATUSES.EXPIRED],
  [LEAD_STATUSES.ADMITTED]: [LEAD_STATUSES.ENROLLED, LEAD_STATUSES.DECLINED],
  [LEAD_STATUSES.ENROLLED]: [LEAD_STATUSES.ARCHIVED],
  [LEAD_STATUSES.DECLINED]: [LEAD_STATUSES.ARCHIVED],
  [LEAD_STATUSES.DISQUALIFIED]: [LEAD_STATUSES.ARCHIVED],
  [LEAD_STATUSES.REJECTED]: [LEAD_STATUSES.ARCHIVED],
  [LEAD_STATUSES.EXPIRED]: [LEAD_STATUSES.ARCHIVED],
};

/**
 * Simple Lead Document Structure for Firestore
 */
class LeadModel {
  /**
   * Create a default lead structure
   */
  static createLead(contactInfo, source = null) {
    return {
      // Basic Info
      status: LEAD_STATUSES.INQUIRY,
      source: source,
      createdAt: new Date(),
      updatedAt: new Date(),

      // Contact Info
      name: contactInfo.name || null,
      phone: contactInfo.phone || null,
      email: contactInfo.email || null,
      whatsappNumber: contactInfo.whatsappNumber || contactInfo.phone,

      // Application Info
      program: null,
      applicationSubmitted: false,
      applicationDate: null,

      // Assignment
      assignedTo: null,
      priority: "MEDIUM",

      // Tracking
      totalInteractions: 0,
      lastInteractionAt: null,
      nextFollowUpDate: null,

      // Timeline - simple array
      timeline: [
        {
          date: new Date(),
          action: "CREATED",
          status: LEAD_STATUSES.INQUIRY,
          notes: `Lead created from ${source || "unknown source"}`,
        },
      ],

      // Notes
      notes: "",
      tags: [],
    };
  }

  /**
   * Validate lead data
   */
  static validate(leadData) {
    const errors = [];

    if (!leadData.phone && !leadData.email) {
      errors.push("Either phone or email is required");
    }

    if (!Object.values(LEAD_STATUSES).includes(leadData.status)) {
      errors.push("Invalid status");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if status transition is allowed
   */
  static canTransitionTo(currentStatus, newStatus) {
    // Allow staying in the same status (for updates/notes)
    if (currentStatus === newStatus) {
      return true;
    }

    const allowed = STATUS_TRANSITIONS[currentStatus] || [];
    return allowed.includes(newStatus);
  }

  /**
   * Get next possible statuses
   */
  static getNextStatuses(currentStatus) {
    return STATUS_TRANSITIONS[currentStatus] || [];
  }

  /**
   * Get current status from timeline (most recent status)
   */
  static getCurrentStatus(leadData) {
    try {
      if (!leadData || !leadData.timeline || leadData.timeline.length === 0) {
        return leadData?.status || LEAD_STATUSES.INQUIRY;
      }

      // Get the most recent timeline entry with a status
      const timeline = leadData.timeline.sort((a, b) => {
        const dateA = a.date instanceof Date ? a.date : new Date(a.date || 0);
        const dateB = b.date instanceof Date ? b.date : new Date(b.date || 0);
        return dateB.getTime() - dateA.getTime();
      });
      const latestStatusEntry = timeline.find((entry) => entry.status);

      return (
        latestStatusEntry?.status || leadData.status || LEAD_STATUSES.INQUIRY
      );
    } catch (error) {
      console.error("❌ Error getting current status from timeline:", error);
      return leadData?.status || LEAD_STATUSES.INQUIRY;
    }
  }

  /**
   * Check if lead should be automatically qualified based on interactions
   * Improved version following best practices
   */
  static shouldAutoQualify(leadData, customRules = null) {
    try {
      // Use dependency injection for rules (testability)
      const rules = customRules || QUALIFICATION_RULES;

      const currentStatus = this.getCurrentStatus(leadData);

      // Check status eligibility
      const statusEligibility = this._checkStatusEligibility(
        currentStatus,
        rules
      );
      if (!statusEligibility.eligible) {
        return statusEligibility.result;
      }

      // Count and validate interactions
      const interactionAnalysis = this._analyzeQualifyingInteractions(
        leadData,
        rules
      );

      // Determine qualification result
      return this._determineQualificationResult(interactionAnalysis, rules);
    } catch (error) {
      console.error("❌ Error checking auto-qualification:", error);
      return {
        shouldQualify: false,
        reason: "Error during qualification check",
        error: error.message,
      };
    }
  }

  /**
   * Check if current status is eligible for auto-qualification (private helper)
   */
  static _checkStatusEligibility(currentStatus, rules) {
    const isEligible =
      rules.ELIGIBLE_STATUSES_FOR_AUTO_QUALIFICATION.includes(currentStatus);

    return {
      eligible: isEligible,
      result: isEligible
        ? null
        : {
            shouldQualify: false,
            reason: `Status '${currentStatus}' not eligible for auto-qualification`,
            currentStatus,
          },
    };
  }

  /**
   * Analyze qualifying interactions from timeline (private helper)
   */
  static _analyzeQualifyingInteractions(leadData, rules) {
    const allInteractions = (leadData.timeline || []).filter(
      (entry) => entry.action === "INTERACTION"
    );

    // Count WhatsApp messages specifically
    const whatsappMessages = allInteractions.filter(
      (entry) =>
        entry.metadata &&
        entry.metadata.type === "WHATSAPP" &&
        !entry.metadata.automated &&
        entry.metadata.direction === "incoming"
    );

    // Count other qualifying interactions
    const qualifyingInteractions = allInteractions.filter(
      (entry) =>
        entry.metadata &&
        rules.QUALIFYING_INTERACTION_TYPES.includes(
          entry.metadata.type || entry.metadata.channel
        ) &&
        entry.metadata.type !== "WHATSAPP" // Exclude WhatsApp as we count it separately
    );

    // Group by type for detailed analysis
    const interactionsByType = {
      WHATSAPP: whatsappMessages.length,
      ...qualifyingInteractions.reduce((acc, interaction) => {
        const type = interaction.metadata.type || interaction.metadata.channel;
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {}),
    };

    return {
      total: qualifyingInteractions.length,
      byType: interactionsByType,
      qualifyingInteractions,
      allInteractions,
    };
  }

  /**
   * Determine final qualification result (private helper)
   */
  static _determineQualificationResult(interactionAnalysis, rules) {
    const { total: qualifyingCount } = interactionAnalysis;
    const threshold = rules.PRE_QUALIFIED_INTERACTION_THRESHOLD;

    console.log(`📊 Lead qualification analysis:`, {
      qualifyingCount,
      threshold,
      breakdown: interactionAnalysis.byType,
    });

    const shouldQualify = qualifyingCount >= threshold;

    return {
      shouldQualify,
      reason: shouldQualify
        ? `Reached ${qualifyingCount} qualifying interactions (threshold: ${threshold})`
        : `Only ${qualifyingCount} qualifying interactions (need ${threshold})`,
      qualifyingInteractions: qualifyingCount,
      threshold,
      interactionBreakdown: interactionAnalysis.byType,
      analysis: interactionAnalysis,
    };
  }

  /**
   * Add timeline entry
   */
  static addTimelineEntry(timeline, action, status, notes = "", metadata = {}) {
    const entry = {
      date: new Date(),
      action,
      status,
      notes,
      metadata,
    };

    return [...timeline, entry];
  }

  /**
   * Update lead status
   */
  static updateStatus(leadData, newStatus, notes = "", updatedBy = null) {
    if (!this.canTransitionTo(leadData.status, newStatus)) {
      throw new Error(
        `Cannot transition from ${leadData.status} to ${newStatus}`
      );
    }

    const timeline = this.addTimelineEntry(
      leadData.timeline || [],
      "STATUS_CHANGE",
      newStatus,
      notes,
      { previousStatus: leadData.status, updatedBy }
    );

    return {
      ...leadData,
      status: newStatus,
      updatedAt: new Date(),
      timeline,
    };
  }
}

module.exports = {
  LeadModel,
  STATUS_TRANSITIONS,
  // Export both for backwards compatibility
  QUALIFICATION_RULES: QUALIFICATION_RULES, // From config file
  DEPRECATED_QUALIFICATION_RULES, // Deprecated inline rules
};
