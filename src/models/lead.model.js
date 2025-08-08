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
// Allow more flexible transitions while maintaining logical flow
const STATUS_TRANSITIONS = {
  // Keep INQUIRY transitions for backwards compatibility
  [LEAD_STATUSES.INQUIRY]: [
    LEAD_STATUSES.CONTACTED,
    LEAD_STATUSES.PRE_QUALIFIED,
    LEAD_STATUSES.APPLIED,
    LEAD_STATUSES.NURTURE,
    LEAD_STATUSES.REJECTED,
    LEAD_STATUSES.ADMITTED, // Allow direct admission for special cases
  ],
  [LEAD_STATUSES.CONTACTED]: [
    LEAD_STATUSES.PRE_QUALIFIED,
    LEAD_STATUSES.APPLIED,
    LEAD_STATUSES.QUALIFIED,
    LEAD_STATUSES.NURTURE,
    LEAD_STATUSES.REJECTED,
    LEAD_STATUSES.ADMITTED, // Allow direct admission for special cases
  ],
  [LEAD_STATUSES.PRE_QUALIFIED]: [
    LEAD_STATUSES.APPLIED,
    LEAD_STATUSES.QUALIFIED,
    LEAD_STATUSES.NURTURE,
    LEAD_STATUSES.REJECTED,
    LEAD_STATUSES.ADMITTED, // Allow direct admission
    LEAD_STATUSES.ENROLLED, // Allow direct enrollment for special cases
  ],
  [LEAD_STATUSES.APPLIED]: [
    LEAD_STATUSES.QUALIFIED,
    LEAD_STATUSES.ADMITTED,
    LEAD_STATUSES.REJECTED,
    LEAD_STATUSES.ENROLLED, // Allow direct enrollment for special cases
  ],
  [LEAD_STATUSES.QUALIFIED]: [
    LEAD_STATUSES.ADMITTED,
    LEAD_STATUSES.ENROLLED,
    LEAD_STATUSES.REJECTED,
  ],
  [LEAD_STATUSES.ADMITTED]: [LEAD_STATUSES.ENROLLED, LEAD_STATUSES.REJECTED],
  // Terminal statuses
  [LEAD_STATUSES.ENROLLED]: [], // Final success state
  [LEAD_STATUSES.REJECTED]: [], // Final rejection state
  [LEAD_STATUSES.NURTURE]: [
    LEAD_STATUSES.PRE_QUALIFIED,
    LEAD_STATUSES.APPLIED,
    LEAD_STATUSES.QUALIFIED,
    LEAD_STATUSES.REJECTED,
    LEAD_STATUSES.ADMITTED, // Allow direct admission from nurture
  ], // Can re-engage
};

/**
 * Simple Lead Document Structure for Firestore
 */
class LeadModel {
  /**
   * Create a default lead structure
   * Ensures status field and timeline are synchronized
   */
  static createLead(contactInfo, source = null) {
    // Determine the initial status (use provided status or default to CONTACTED)
    const initialStatus = contactInfo.status || LEAD_STATUSES.CONTACTED;

    // Create the initial timeline entry with reliable date object
    const now = new Date();
    const initialTimelineEntry = {
      date: now,
      action: "CREATED",
      status: initialStatus, // Same as the status field for consistency
      notes: `Lead created from ${source || "unknown source"}`,
    };

    // Always use an array for timeline
    const timeline = [initialTimelineEntry];

    return {
      // Basic Info
      status: initialStatus, // Status field is synchronized with timeline
      source: source,
      createdAt: now,
      updatedAt: now,

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

      // Timeline - with synchronized initial status
      // Explicitly ensure it's always an array
      timeline: Array.isArray(timeline) ? timeline : [initialTimelineEntry],

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
    } else if (
      (!leadData.phone || leadData.phone.toString().trim() === "") &&
      (!leadData.email || leadData.email.toString().trim() === "")
    ) {
      errors.push("Either phone or email must have a non-empty value");
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
   * This is the source of truth for lead status in the system
   */
  static getCurrentStatus(leadData) {
    try {
      // More robust check to handle non-array timelines
      if (
        !leadData ||
        !leadData.timeline ||
        !Array.isArray(leadData.timeline) ||
        leadData.timeline.length === 0
      ) {
        return leadData?.status || LEAD_STATUSES.CONTACTED;
      }

      // Create a copy of the timeline to avoid mutating the original
      // Sort by date in descending order (newest first)
      const sortedTimeline = [...leadData.timeline].sort((a, b) => {
        // Handle date conversion safely
        try {
          const dateA = a.date instanceof Date ? a.date : new Date(a.date || 0);
          const dateB = b.date instanceof Date ? b.date : new Date(b.date || 0);
          return dateB.getTime() - dateA.getTime();
        } catch (err) {
          console.error("❌ Error comparing dates in timeline:", err);
          return 0; // Keep original order if dates can't be compared
        }
      });

      // Find the most recent entry with a status
      const latestStatusEntry = sortedTimeline.find((entry) => entry.status);

      // Check if status field is synchronized with timeline
      const timelineStatus = latestStatusEntry?.status;
      if (
        timelineStatus &&
        leadData.status &&
        timelineStatus !== leadData.status
      ) {
        console.warn(
          `⚠️ Status field (${leadData.status}) doesn't match timeline status (${timelineStatus})`
        );
      }

      return (
        latestStatusEntry?.status || leadData.status || LEAD_STATUSES.CONTACTED
      );
    } catch (error) {
      console.error("❌ Error getting current status from timeline:", error);
      return leadData?.status || LEAD_STATUSES.CONTACTED;
    }
  }

  /**
   * Check if lead should be automatically qualified based on interactions
   * Auto-qualification has been disabled as requested
   */
  static shouldAutoQualify(leadData, customRules = null) {
    // Auto-qualification is disabled
    return {
      shouldQualify: false,
      reason: "Auto-qualification is disabled",
      qualifyingInteractions: [],
      threshold: 0,
    };
  }

  /**
   * Check if current status is eligible for auto-qualification (private helper)
   * Auto-qualification has been disabled as requested
   */
  static _checkStatusEligibility(currentStatus, rules) {
    return {
      eligible: false,
      result: {
        shouldQualify: false,
        reason: "Auto-qualification is disabled",
        currentStatus,
      },
    };
  }

  /**
   * Analyze interactions to find qualifying ones (private helper)
   * Auto-qualification has been disabled as requested
   */
  static _analyzeQualifyingInteractions(leadData, rules) {
    return {
      count: 0,
      items: [],
      meetsThreshold: false,
      threshold: 0,
    };
  }

  /**
   * Determine if lead should be qualified based on analysis (private helper)
   * Auto-qualification has been disabled as requested
   */
  static _determineQualificationResult(interactionAnalysis, rules) {
    return {
      shouldQualify: false,
      reason: "Auto-qualification is disabled",
      qualifyingInteractions: [],
      threshold: 0,
    };
  }

  /**
   * Add timeline entry
   * @returns {Object} Object containing updated timeline and the current status
   */
  static addTimelineEntry(timeline, action, status, notes = "", metadata = {}) {
    const entry = {
      date: new Date(),
      action,
      status,
      notes,
      metadata,
    };

    const updatedTimeline = [...timeline, entry];

    // Return both the updated timeline and the new current status
    // This ensures status field and timeline status remain synchronized
    return {
      timeline: updatedTimeline,
      currentStatus: status, // The new entry becomes the most recent status
    };
  }

  /**
   * Update lead status
   * Ensures the status field and timeline remain synchronized
   */
  static updateStatus(leadData, newStatus, notes = "", updatedBy = null) {
    // Get current status from timeline instead of stored status field
    const currentStatus = this.getCurrentStatus(leadData);

    // Validate status transition
    if (!this.canTransitionTo(currentStatus, newStatus)) {
      throw new Error(
        `Cannot transition from ${currentStatus} to ${newStatus}`
      );
    }

    // Add timeline entry using the improved method that returns timeline and status
    const { timeline } = this.addTimelineEntry(
      leadData.timeline || [],
      "STATUS_CHANGE",
      newStatus,
      notes,
      { previousStatus: currentStatus, updatedBy }
    );

    // Return updated lead data with synchronized status field and timeline
    return {
      ...leadData,
      status: newStatus, // Status field explicitly set to match timeline
      updatedAt: new Date(),
      timeline,
    };
  }

  /**
   * Verify and fix status consistency between status field and timeline
   * Use this method periodically to ensure data integrity
   * @returns {Object} The lead data with corrected status if needed
   */
  static verifyStatusConsistency(leadData) {
    if (!leadData) return leadData;

    const timelineStatus = this.getCurrentStatus(leadData);

    // If status field matches timeline status, no changes needed
    if (leadData.status === timelineStatus) {
      return leadData;
    }

    // Status field needs to be synchronized with timeline
    console.warn(
      `⚠️ Fixing inconsistent status: field=${leadData.status}, timeline=${timelineStatus}`
    );

    return {
      ...leadData,
      status: timelineStatus,
      updatedAt: new Date(),
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
