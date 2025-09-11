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
