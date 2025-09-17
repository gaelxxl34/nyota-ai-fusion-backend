/**
 * Simple Lead Model for Firestore
 * Straightforward structure without complex indexing
 */

const { LEAD_STATUSES, LEAD_SOURCES } = require("../config/lead.constants");

// Status transition rules - Updated for new streamlined funnel
// CONTACTED → INTERESTED → APPLIED → MISSING_DOCUMENT → IN_REVIEW → QUALIFIED → ADMITTED → ENROLLED
const STATUS_TRANSITIONS = {
  [LEAD_STATUSES.CONTACTED]: [
    LEAD_STATUSES.INTERESTED, // CONTACTED leads can naturally progress to INTERESTED when they engage
    LEAD_STATUSES.APPLIED, // Allow direct application for special cases
    LEAD_STATUSES.EXPIRED, // Allow expiry for any status
  ],
  [LEAD_STATUSES.INTERESTED]: [
    LEAD_STATUSES.APPLIED,
    LEAD_STATUSES.MISSING_DOCUMENT, // Allow direct missing document for special cases
    LEAD_STATUSES.IN_REVIEW, // Allow direct review for special cases
    LEAD_STATUSES.QUALIFIED, // Allow direct qualification for special cases
    LEAD_STATUSES.DEFERRED, // Allow deferred for any status
    LEAD_STATUSES.EXPIRED, // Allow expired for any status
  ],
  [LEAD_STATUSES.APPLIED]: [
    LEAD_STATUSES.MISSING_DOCUMENT, // New transition to missing document status
    LEAD_STATUSES.IN_REVIEW,
    LEAD_STATUSES.QUALIFIED, // Allow direct qualification for special cases
    LEAD_STATUSES.ADMITTED, // Allow direct admission for bulk imports
    LEAD_STATUSES.DEFERRED, // Allow deferred for any status
    LEAD_STATUSES.EXPIRED, // Allow expired for any status
  ],
  [LEAD_STATUSES.MISSING_DOCUMENT]: [
    LEAD_STATUSES.IN_REVIEW, // Can transition to review once documents are provided
    LEAD_STATUSES.APPLIED, // Allow back to applied if needed
    LEAD_STATUSES.DEFERRED, // Allow deferred for any status
    LEAD_STATUSES.EXPIRED, // Allow expired for any status
  ],
  [LEAD_STATUSES.IN_REVIEW]: [
    LEAD_STATUSES.QUALIFIED,
    LEAD_STATUSES.ADMITTED, // Allow direct admission for special cases
    LEAD_STATUSES.APPLIED, // Allow back to applied if needed
    LEAD_STATUSES.MISSING_DOCUMENT, // Allow transition back to missing document if needed
    LEAD_STATUSES.DEFERRED, // Allow deferred for any status
    LEAD_STATUSES.EXPIRED, // Allow expired for any status
  ],
  [LEAD_STATUSES.QUALIFIED]: [
    LEAD_STATUSES.ADMITTED,
    LEAD_STATUSES.ENROLLED, // Allow direct enrollment for special cases
    LEAD_STATUSES.DEFERRED, // Allow deferred for any status
    LEAD_STATUSES.EXPIRED, // Allow expired for any status
  ],
  [LEAD_STATUSES.ADMITTED]: [
    LEAD_STATUSES.ENROLLED,
    LEAD_STATUSES.DEFERRED, // Allow deferred for admitted students
    LEAD_STATUSES.EXPIRED, // Allow expired for admitted students
  ],
  // Terminal statuses
  [LEAD_STATUSES.ENROLLED]: [
    LEAD_STATUSES.DEFERRED, // Allow deferred for enrolled students
    LEAD_STATUSES.EXPIRED, // Allow expired for enrolled students
  ], // Final success state
  [LEAD_STATUSES.DEFERRED]: [
    LEAD_STATUSES.APPLIED, // Can reapply
    LEAD_STATUSES.IN_REVIEW, // Can go back to review
    LEAD_STATUSES.EXPIRED, // Allow transition to expired
  ],
  [LEAD_STATUSES.EXPIRED]: [
    LEAD_STATUSES.INTERESTED, // Can restart the process
    LEAD_STATUSES.APPLIED, // Can reapply
    LEAD_STATUSES.DEFERRED, // Allow transition to deferred
  ],
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
    // Determine the initial status (use provided status or default to INTERESTED)
    const initialStatus = contactInfo.status || LEAD_STATUSES.INTERESTED;

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
      program: contactInfo.preferredProgram || contactInfo.program || null,
      applicationSubmitted: false,
      applicationDate: null,

      // Assignment
      assignedTo: null, // Email of the assigned user
      assignment: {
        assignedTo: null, // Email of the assigned user (redundant for backwards compatibility)
        assignedToName: null, // Display name of the assigned user
        assignedBy: null, // Email of the user who made the assignment
        assignedByName: null, // Display name of the user who made the assignment
        assignedAt: null, // Timestamp when the assignment was made
        previousAssignee: null, // Previous assignee before current assignment
        notes: null, // Optional notes about the assignment
      },
      priority: "MEDIUM",

      // Enhanced Interaction Tracking
      interactionSummary: {
        totalInteractions: 0,
        phoneCallCount: 0,
        whatsappMessageCount: 0,
        whatsappCallCount: 0,
        emailCount: 0,
        meetingCount: 0,
        smsCount: 0,

        // Outcome tracking
        positiveInteractions: 0,
        neutralInteractions: 0,
        negativeInteractions: 0,

        // Recent activity
        lastInteractionDate: null,
        lastInteractionType: null,
        lastInteractionOutcome: null,
        lastAgentId: null,
        lastAgentName: null,

        // Follow-up tracking
        nextFollowUpDate: null,
        nextFollowUpAction: null,
        nextFollowUpPriority: null,

        // Engagement metrics
        engagementLevel: "low", // low, medium, high
        conversionScore: 0.0, // 0-1 probability
        responseRate: 0.0, // Response rate to outreach
        createdAt: now,
        updatedAt: now,
      },

      // Tracking (Legacy fields for backwards compatibility)
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
        return leadData?.status || LEAD_STATUSES.INTERESTED;
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

      // Check if status field is synchronized with timeline (only warn once per lead)
      const timelineStatus = latestStatusEntry?.status;
      if (
        timelineStatus &&
        leadData.status &&
        timelineStatus !== leadData.status
      ) {
        // Only log warning if this hasn't been flagged before
        if (!leadData._statusMismatchWarned) {
          console.warn(
            `⚠️ Status field (${leadData.status}) doesn't match timeline status (${timelineStatus})`
          );
        }
      }

      return (
        latestStatusEntry?.status || leadData.status || LEAD_STATUSES.INTERESTED
      );
    } catch (error) {
      console.error("❌ Error getting current status from timeline:", error);
      return leadData?.status || LEAD_STATUSES.INTERESTED;
    }
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
   * Add enhanced interaction timeline entry
   * @param {Array} timeline - Current timeline array
   * @param {Object} interactionData - Rich interaction data from frontend
   * @param {string} currentStatus - Current lead status
   * @param {Object} agent - Agent who logged the interaction
   * @returns {Object} Object containing updated timeline and interaction summary
   */
  static addInteractionEntry(
    timeline,
    interactionData,
    currentStatus,
    agent = null
  ) {
    const now = new Date();

    // Generate unique interaction ID
    const interactionId = `int_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Map frontend interaction types to consistent backend types
    const typeMapping = {
      phone: "PHONE_CALL",
      whatsapp_message: "WHATSAPP_MESSAGE",
      whatsapp_call: "WHATSAPP_CALL",
      meeting: "MEETING",
      email: "EMAIL",
      sms: "SMS",
    };

    // Create enhanced interaction entry
    const entry = {
      date: now,
      action: "INTERACTION",
      status: currentStatus,
      notes: interactionData.notes || "",

      // Enhanced interaction-specific data
      interaction: {
        // Core interaction details
        id: interactionId,
        type:
          typeMapping[interactionData.type] ||
          interactionData.type?.toUpperCase() ||
          "OTHER",
        direction: interactionData.direction || "outgoing",
        duration: interactionData.duration
          ? parseInt(interactionData.duration)
          : null,

        // Outcome and sentiment
        outcome: interactionData.outcome || "neutral",
        sentiment:
          interactionData.sentiment || interactionData.outcome || "neutral",
        interactionTag: interactionData.interactionTag || null,

        // Calculate priority from interaction tag
        priority: this.calculateInteractionPriority(
          interactionData.interactionTag
        ),

        // Agent information
        agent:
          agent?.name ||
          agent?.displayName ||
          interactionData.agent ||
          "Unknown",
        agentId: agent?.uid || agent?.id || null,
        agentEmail: agent?.email || null,

        // Follow-up planning
        nextAction: interactionData.nextAction || null,
        nextActionDate: interactionData.nextActionDate
          ? new Date(interactionData.nextActionDate)
          : null,
        nextActionPriority: this.calculateNextActionPriority(
          interactionData.nextAction,
          interactionData.outcome
        ),

        // Communication details
        subject: interactionData.subject || null,
        channel: this.getChannelFromType(interactionData.type),

        // References and attachments
        attachments: interactionData.attachments || [],
        relatedMessageId: interactionData.relatedMessageId || null,
        conversationId: interactionData.conversationId || null,

        // Analytics and tracking
        responseTime: interactionData.responseTime || null,
        customerSatisfaction: interactionData.customerSatisfaction || null,
        conversionImpact: this.calculateConversionImpact(
          interactionData.interactionTag,
          interactionData.outcome
        ),

        // System metadata
        automated: interactionData.automated || false,
        source: interactionData.source || "manual",
        createdAt: now,
        updatedAt: now,
      },
    };

    const updatedTimeline = [...timeline, entry];

    return {
      timeline: updatedTimeline,
      currentStatus: currentStatus,
      interaction: entry.interaction,
    };
  }

  /**
   * Calculate interaction priority based on interaction tag
   */
  static calculateInteractionPriority(interactionTag) {
    if (!interactionTag) return "medium";

    // High priority - strong conversion signals
    const highPriorityTags = [
      "application_started",
      "application_submitted",
      "application_assistance",
      "campus_visit",
      "parent_meeting",
    ];

    // Low priority - negative conversion signals
    const lowPriorityTags = [
      "scholarship_info",
      "financial_assistance",
      "payment_plan_inquiry",
      "lead_closed",
    ];

    if (highPriorityTags.includes(interactionTag)) return "high";
    if (lowPriorityTags.includes(interactionTag)) return "low";
    return "medium";
  }

  /**
   * Calculate next action priority
   */
  static calculateNextActionPriority(nextAction, outcome) {
    if (!nextAction) return "medium";

    if (outcome === "positive") return "high";
    if (outcome === "negative") return "low";
    return "medium";
  }

  /**
   * Get communication channel from interaction type
   */
  static getChannelFromType(type) {
    const channelMapping = {
      phone: "PHONE",
      whatsapp_message: "WHATSAPP",
      whatsapp_call: "WHATSAPP",
      meeting: "IN_PERSON",
      email: "EMAIL",
      sms: "SMS",
    };

    return channelMapping[type] || "OTHER";
  }

  /**
   * Calculate conversion impact score
   */
  static calculateConversionImpact(interactionTag, outcome) {
    let baseScore = 0;

    // Base score from outcome
    switch (outcome) {
      case "positive":
        baseScore = 0.3;
        break;
      case "neutral":
        baseScore = 0.1;
        break;
      case "negative":
        baseScore = -0.2;
        break;
      default:
        baseScore = 0;
    }

    // Adjustment based on interaction tag
    const tagMultipliers = {
      application_started: 2.0,
      application_submitted: 3.0,
      application_assistance: 1.8,
      campus_visit: 2.2,
      parent_meeting: 1.9,
      document_shared: 1.2,
      follow_up_scheduled: 1.1,
      scholarship_info: 0.5,
      financial_assistance: 0.4,
      payment_plan_inquiry: 0.3,
      lead_closed: 0.0,
    };

    const multiplier = tagMultipliers[interactionTag] || 1.0;
    return Math.max(-1.0, Math.min(1.0, baseScore * multiplier));
  }

  /**
   * Update interaction summary counters
   */
  static updateInteractionSummary(lead, interaction) {
    const summary = lead.interactionSummary || {};

    // Update counters
    const updatedSummary = {
      totalInteractions: (summary.totalInteractions || 0) + 1,
      phoneCallCount: summary.phoneCallCount || 0,
      whatsappMessageCount: summary.whatsappMessageCount || 0,
      whatsappCallCount: summary.whatsappCallCount || 0,
      emailCount: summary.emailCount || 0,
      meetingCount: summary.meetingCount || 0,
      smsCount: summary.smsCount || 0,

      // Outcome counters
      positiveInteractions: summary.positiveInteractions || 0,
      neutralInteractions: summary.neutralInteractions || 0,
      negativeInteractions: summary.negativeInteractions || 0,

      // Update specific counters
      lastInteractionDate: interaction.createdAt,
      lastInteractionType: interaction.type,
      lastInteractionOutcome: interaction.outcome,
      lastAgentId: interaction.agentId,
      lastAgentName: interaction.agent,

      // Next follow-up
      nextFollowUpDate: interaction.nextActionDate,
      nextFollowUpAction: interaction.nextAction,
      nextFollowUpPriority: interaction.nextActionPriority,

      // Conversion metrics
      engagementLevel: this.calculateEngagementLevel(
        summary.totalInteractions + 1,
        interaction.outcome
      ),
      updatedAt: new Date(),
    };

    // Increment specific type counters
    switch (interaction.type) {
      case "PHONE_CALL":
        updatedSummary.phoneCallCount++;
        break;
      case "WHATSAPP_MESSAGE":
        updatedSummary.whatsappMessageCount++;
        break;
      case "WHATSAPP_CALL":
        updatedSummary.whatsappCallCount++;
        break;
      case "EMAIL":
        updatedSummary.emailCount++;
        break;
      case "MEETING":
        updatedSummary.meetingCount++;
        break;
      case "SMS":
        updatedSummary.smsCount++;
        break;
    }

    // Increment outcome counters
    switch (interaction.outcome) {
      case "positive":
        updatedSummary.positiveInteractions++;
        break;
      case "neutral":
        updatedSummary.neutralInteractions++;
        break;
      case "negative":
        updatedSummary.negativeInteractions++;
        break;
    }

    return updatedSummary;
  }

  /**
   * Calculate engagement level based on interaction count and recent outcomes
   */
  static calculateEngagementLevel(totalInteractions, lastOutcome) {
    if (totalInteractions >= 10 && lastOutcome === "positive") return "high";
    if (totalInteractions >= 5 && lastOutcome !== "negative") return "medium";
    if (lastOutcome === "negative") return "low";
    return "medium";
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

  /**
   * Assign a lead to a user
   * @param {Object} leadData - The lead to assign
   * @param {Object} assignTo - The user to assign the lead to (null to unassign)
   * @param {Object} assignedBy - The user making the assignment
   * @param {String} notes - Optional notes about the assignment
   * @returns {Object} The updated lead data
   */
  static assignLead(leadData, assignTo, assignedBy, notes = "") {
    if (!leadData) throw new Error("Lead data is required");
    if (!assignedBy)
      throw new Error("Assignment must specify who assigned the lead");

    const timestamp = new Date();
    const previousAssignee = leadData.assignedTo;
    const isReassignment =
      previousAssignee && assignTo && previousAssignee !== assignTo.email;
    const isUnassignment = previousAssignee && !assignTo;

    // Create assignment object
    const assignment = {
      assignedTo: assignTo ? assignTo.email : null,
      assignedToName: assignTo ? assignTo.name || assignTo.displayName : null,
      assignedBy: assignedBy.email,
      assignedByName: assignedBy.name || assignedBy.displayName,
      assignedAt: timestamp,
      previousAssignee: previousAssignee,
      notes: notes || "",
    };

    // Create timeline entry
    let action = "ASSIGNED";
    if (isReassignment) action = "REASSIGNED";
    if (isUnassignment) action = "UNASSIGNED";

    const entryNotes =
      notes ||
      (assignTo
        ? isReassignment
          ? `Lead reassigned from ${previousAssignee} to ${
              assignTo.name || assignTo.email
            }`
          : `Lead assigned to ${assignTo.name || assignTo.email}`
        : "Lead unassigned");

    const timelineEntry = {
      date: timestamp,
      action,
      status: leadData.status,
      notes: entryNotes,
      metadata: {
        previousAssignee,
        newAssignee: assignTo?.email,
        assignedBy: assignedBy.email,
        assignedByName: assignedBy.name || assignedBy.displayName,
      },
    };

    // Create the updated timeline
    const timeline = Array.isArray(leadData.timeline)
      ? [...leadData.timeline, timelineEntry]
      : [timelineEntry];

    // Return updated lead data
    return {
      ...leadData,
      assignedTo: assignTo ? assignTo.email : null, // For backwards compatibility
      assignment,
      updatedAt: timestamp,
      timeline,
    };
  }

  /**
   * Validate and fix timeline structure
   * Ensures timeline is always an array with proper structure
   * @param {Object} leadData - The lead data to validate
   * @returns {Object} The lead data with corrected timeline if needed
   */
  static validateAndFixTimeline(leadData) {
    if (!leadData) return leadData;

    // If timeline doesn't exist or isn't an array, create a proper one
    if (!leadData.timeline || !Array.isArray(leadData.timeline)) {
      console.warn(`⚠️ Fixing invalid timeline format for lead`);

      const now = new Date();
      const status = leadData.status || LEAD_STATUSES.INTERESTED;

      const fixedTimeline = [
        {
          date: leadData.createdAt || now,
          action: "CREATED",
          status: status,
          notes: `Timeline reconstructed due to invalid format`,
          metadata: { reconstructed: true },
        },
      ];

      return {
        ...leadData,
        timeline: fixedTimeline,
        updatedAt: new Date(),
      };
    }

    // Validate each timeline entry
    const validatedTimeline = leadData.timeline.map((entry, index) => {
      const validatedEntry = { ...entry };

      // Ensure date is a proper Date object
      if (!entry.date || !(entry.date instanceof Date)) {
        try {
          validatedEntry.date = new Date(entry.date || 0);
        } catch (error) {
          console.warn(
            `⚠️ Invalid date in timeline entry ${index}, using current date`
          );
          validatedEntry.date = new Date();
        }
      }

      // Ensure required fields exist
      if (!validatedEntry.action) {
        validatedEntry.action = "UNKNOWN";
      }
      if (!validatedEntry.status) {
        validatedEntry.status = leadData.status || LEAD_STATUSES.INTERESTED;
      }
      if (!validatedEntry.notes) {
        validatedEntry.notes = "";
      }

      return validatedEntry;
    });

    return {
      ...leadData,
      timeline: validatedTimeline,
    };
  }
}

module.exports = {
  LeadModel,
  STATUS_TRANSITIONS,
};
