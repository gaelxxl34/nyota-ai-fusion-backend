/**
 * Lead Service for Firestore Operations
 * Simple CRUD operations and status management
 */

const { LeadModel, QUALIFICATION_RULES } = require("../models/lead.model");
const { LEAD_STATUSES, LEAD_SOURCES } = require("../config/lead.constants");

// Import enhanced configuration
const {
  AUTO_QUALIFICATION_CONFIG,
  QUALIFICATION_SERVICE_CONFIG,
} = require("../config/autoQualification.config");
const { broadcastMessage } = require("./broadcastService");

class LeadService {
  constructor(firestore) {
    this.db = firestore;
    this.collection = "leads";
  }

  /**
   * Find leads by status
   */
  async findLeadsByStatus(status) {
    try {
      const snapshot = await this.db
        .collection(this.collection)
        .where("status", "==", status)
        .get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...this._convertTimestamps(doc.data()),
      }));
    } catch (error) {
      console.error(`Error finding leads with status ${status}:`, error);
      throw error;
    }
  }

  /**
   * Convert Firestore timestamps to JavaScript Date objects
   */
  _convertTimestamps(data) {
    const converted = { ...data };

    // List of timestamp fields that need conversion
    const timestampFields = [
      "createdAt",
      "updatedAt",
      "lastInteractionAt",
      "nextFollowUpDate",
    ];

    timestampFields.forEach((field) => {
      converted[field] = this._convertSingleTimestamp(converted[field]);
    });

    // Convert timeline timestamps if they exist
    if (converted.timeline && Array.isArray(converted.timeline)) {
      converted.timeline = converted.timeline.map((entry) => ({
        ...entry,
        date: this._convertSingleTimestamp(entry.date),
      }));
    }

    return converted;
  }

  /**
   * Convert a single timestamp value to JavaScript Date object
   * Handles various Firestore timestamp formats safely
   */
  _convertSingleTimestamp(timestamp) {
    if (!timestamp) {
      return null;
    }

    try {
      // Firestore Timestamp object with _seconds property
      if (timestamp._seconds !== undefined) {
        return new Date(timestamp._seconds * 1000);
      }

      // Firestore Timestamp object with seconds property
      if (timestamp.seconds !== undefined) {
        return new Date(timestamp.seconds * 1000);
      }

      // Already a Date object
      if (timestamp instanceof Date) {
        return isNaN(timestamp.getTime()) ? null : timestamp;
      }

      // String that can be parsed as date
      if (typeof timestamp === "string") {
        const parsed = new Date(timestamp);
        return isNaN(parsed.getTime()) ? null : parsed;
      }

      // Unix timestamp (number)
      if (typeof timestamp === "number") {
        // Handle both seconds and milliseconds
        const date =
          timestamp > 1000000000000
            ? new Date(timestamp) // milliseconds
            : new Date(timestamp * 1000); // seconds
        return isNaN(date.getTime()) ? null : date;
      }

      // ISO string format
      if (typeof timestamp === "object" && timestamp.toDate) {
        return timestamp.toDate();
      }

      console.warn(`⚠️ Unknown timestamp format:`, timestamp);
      return null;
    } catch (error) {
      console.warn(`⚠️ Error converting timestamp:`, timestamp, error);
      return null;
    }
  }

  /**
   * Create a new lead
   */
  async createLead(contactInfo, source = null, additionalData = {}) {
    try {
      const leadData = LeadModel.createLead(contactInfo, source);

      // Add any additional data
      const fullLeadData = { ...leadData, ...additionalData };

      // Validate
      const validation = LeadModel.validate(fullLeadData);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
      }

      // Save to Firestore
      const docRef = await this.db
        .collection(this.collection)
        .add(fullLeadData);

      console.log(`✅ Lead created with ID: ${docRef.id}`);

      return {
        id: docRef.id,
        ...fullLeadData,
      };
    } catch (error) {
      console.error("❌ Error creating lead:", error);
      throw error;
    }
  }

  /**
   * Get lead by ID
   */
  async getLeadById(leadId) {
    try {
      const doc = await this.db.collection(this.collection).doc(leadId).get();

      if (!doc.exists) {
        return null;
      }

      const data = this._convertTimestamps(doc.data());

      return {
        id: doc.id,
        ...data,
      };
    } catch (error) {
      console.error("❌ Error getting lead:", error);
      throw error;
    }
  }

  /**
   * Find lead by phone number (handles multiple formats)
   */
  async findLeadByPhone(phoneNumber) {
    try {
      // Create different phone number formats to search for
      const phoneFormats = [];

      if (phoneNumber) {
        // Original format
        phoneFormats.push(phoneNumber);

        // With + prefix
        if (!phoneNumber.startsWith("+")) {
          phoneFormats.push("+" + phoneNumber);
        }

        // Without + prefix
        if (phoneNumber.startsWith("+")) {
          phoneFormats.push(phoneNumber.substring(1));
        }

        // With country code variations for Uganda (256)
        const cleanNumber = phoneNumber.replace(/\D/g, "");
        if (cleanNumber.length === 9 && !cleanNumber.startsWith("256")) {
          phoneFormats.push("256" + cleanNumber);
          phoneFormats.push("+256" + cleanNumber);
        }
        if (cleanNumber.length === 12 && cleanNumber.startsWith("256")) {
          phoneFormats.push("+" + cleanNumber);
          phoneFormats.push(cleanNumber.substring(3)); // Remove country code
        }
      }

      console.log(
        `🔍 Searching for lead with phone formats: ${phoneFormats.join(", ")}`
      );

      // Use batched queries with 'in' operator to reduce number of queries
      // Firestore limits 'in' operator to 10 values, so chunk if needed
      if (phoneFormats.length > 0) {
        // Check for matches in the primary phone field
        const maxBatchSize = 10; // Firestore 'in' operator limit

        for (let i = 0; i < phoneFormats.length; i += maxBatchSize) {
          const batch = phoneFormats.slice(i, i + maxBatchSize);

          // Check primary phone field with 'in' operator
          let snapshot = await this.db
            .collection(this.collection)
            .where("phone", "in", batch)
            .limit(1)
            .get();

          if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            const data = this._convertTimestamps(doc.data());

            // Get current status from timeline
            const currentStatus = LeadModel.getCurrentStatus(data);

            console.log(
              `✅ Found lead with primary phone ${
                doc.data().phone
              }, timeline status: ${currentStatus}, stored status: ${
                data.status
              }`
            );

            return {
              id: doc.id,
              ...data,
              status: currentStatus, // Use timeline-based status
            };
          }
        }

        // Check additionalPhones field
        try {
          // Unfortunately, Firestore doesn't support 'array-contains-any' with more than 10 items
          // So we'll still need to check each format individually for additionalPhones
          for (const format of phoneFormats) {
            const snapshot = await this.db
              .collection(this.collection)
              .where("additionalPhones", "array-contains", format)
              .limit(1)
              .get();

            if (!snapshot.empty) {
              const doc = snapshot.docs[0];
              const data = this._convertTimestamps(doc.data());

              // Get current status from timeline
              const currentStatus = LeadModel.getCurrentStatus(data);

              console.log(
                `✅ Found lead with additional phone ${format}, timeline status: ${currentStatus}, stored status: ${data.status}`
              );

              return {
                id: doc.id,
                ...data,
                status: currentStatus, // Use timeline-based status
              };
            }
          }
        } catch (err) {
          // Ignore error - additionalPhones field might not exist or not be an array
          console.log(
            `⚠️ Error checking additionalPhones (probably not indexed yet): ${err.message}`
          );
        }
      }

      console.log(
        `⚠️ No lead found for any phone format: ${phoneFormats.join(", ")}`
      );
      return null;
    } catch (error) {
      console.error("❌ Error finding lead by phone:", error);
      throw error;
    }
  }

  /**
   * Find lead by email (checks both primary and additional emails)
   */
  async findLeadByEmail(email) {
    try {
      if (!email) {
        console.log("⚠️ No email provided to search");
        return null;
      }

      // Check primary email field
      let snapshot = await this.db
        .collection(this.collection)
        .where("email", "==", email)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        const data = this._convertTimestamps(doc.data());

        // Get current status from timeline
        const currentStatus = LeadModel.getCurrentStatus(data);

        console.log(`✅ Found lead with primary email ${email}`);

        return {
          id: doc.id,
          ...data,
          status: currentStatus, // Use timeline-based status
        };
      }

      // If no match in primary email, check additionalEmails array
      try {
        snapshot = await this.db
          .collection(this.collection)
          .where("additionalEmails", "array-contains", email)
          .limit(1)
          .get();

        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const data = this._convertTimestamps(doc.data());

          // Get current status from timeline
          const currentStatus = LeadModel.getCurrentStatus(data);

          console.log(`✅ Found lead with additional email ${email}`);

          return {
            id: doc.id,
            ...data,
            status: currentStatus, // Use timeline-based status
          };
        }
      } catch (err) {
        // Ignore error - additionalEmails field might not exist or not be an array
        console.log(
          `⚠️ Error checking additionalEmails (probably not indexed yet): ${err.message}`
        );
      }

      console.log(`⚠️ No lead found with email: ${email}`);
      return null;
    } catch (error) {
      console.error("❌ Error finding lead by email:", error);
      throw error;
    }
  }

  /**
   * Update lead status
   */
  async updateLeadStatus(
    leadId,
    newStatus,
    notes = "",
    updatedBy = null,
    forceUpdate = false
  ) {
    try {
      const lead = await this.getLeadById(leadId);
      if (!lead) {
        throw new Error("Lead not found");
      }

      let updatedLead;

      if (forceUpdate) {
        // Admin force update - bypass transition rules
        console.log(
          `⚠️ Force updating lead ${leadId} status from ${lead.status} to ${newStatus}`
        );

        // Create timeline entry manually
        const timelineEntry = {
          type: "STATUS_CHANGE",
          status: newStatus,
          notes:
            notes || `Status force-updated from ${lead.status} to ${newStatus}`,
          metadata: {
            previousStatus: lead.status,
            updatedBy: updatedBy || "system",
            forceUpdate: true,
          },
          timestamp: new Date(),
        };

        const timeline = [...(lead.timeline || []), timelineEntry];

        // Only update the fields we need to change
        await this.db.collection(this.collection).doc(leadId).update({
          status: newStatus,
          timeline,
          updatedAt: new Date(),
        });

        // Return the updated lead
        updatedLead = await this.getLeadById(leadId);
      } else {
        // Normal update with transition validation
        updatedLead = LeadModel.updateStatus(lead, newStatus, notes, updatedBy);

        await this.db
          .collection(this.collection)
          .doc(leadId)
          .update(updatedLead);
      }

      console.log(`✅ Lead ${leadId} status updated to ${newStatus}`);

      // Sync lead status with conversation
      if (lead.phoneNumber || lead.phone) {
        try {
          const ConversationService = require("./conversationService");
          const conversationService = new ConversationService();
          await conversationService.updateConversationLeadStatus(
            lead.phoneNumber || lead.phone,
            leadId,
            newStatus
          );
        } catch (syncError) {
          console.warn(
            "⚠️ Failed to sync lead status with conversation:",
            syncError.message
          );
        }
      }

      // Broadcast lead status update to all connected clients
      broadcastMessage(
        {
          leadId: leadId,
          phone: lead.phone,
          oldStatus: lead.status,
          newStatus: newStatus,
          notes: notes,
          updatedBy: updatedBy,
        },
        "lead_status_update"
      );

      return {
        id: leadId,
        ...updatedLead,
      };
    } catch (error) {
      console.error("❌ Error updating lead status:", error);
      throw error;
    }
  }

  /**
   * Update lead information
   */
  async updateLead(leadId, updateData) {
    try {
      const updatePayload = {
        ...updateData,
        updatedAt: new Date(),
      };

      await this.db
        .collection(this.collection)
        .doc(leadId)
        .update(updatePayload);

      console.log(`✅ Lead ${leadId} updated`);

      // Sync lead status with conversation if status changed
      if (updateData.status) {
        try {
          const lead = await this.getLeadById(leadId);
          if (lead && (lead.phoneNumber || lead.phone)) {
            const ConversationService = require("./conversationService");
            const conversationService = new ConversationService();
            await conversationService.updateConversationLeadStatus(
              lead.phoneNumber || lead.phone,
              leadId,
              updateData.status
            );
          }
        } catch (syncError) {
          console.warn(
            "⚠️ Failed to sync lead status with conversation:",
            syncError.message
          );
        }
      }

      // Return updated lead
      return await this.getLeadById(leadId);
    } catch (error) {
      console.error("❌ Error updating lead:", error);
      throw error;
    }
  }

  /**
   * Delete a lead
   */
  async deleteLead(leadId) {
    try {
      // Get the lead first to clean up any related data
      const lead = await this.getLeadById(leadId);
      if (!lead) {
        throw new Error("Lead not found");
      }

      // Delete any related conversations
      if (lead.phoneNumber || lead.phone) {
        try {
          const ConversationService = require("./conversationService");
          const conversationService = new ConversationService();
          // Find and delete conversations associated with this lead
          const conversations =
            await conversationService.findConversationsByPhone(
              lead.phoneNumber || lead.phone
            );
          for (const conversation of conversations) {
            if (conversation.leadId === leadId) {
              await conversationService.deleteConversation(conversation.id);
            }
          }
        } catch (cleanupError) {
          console.warn(
            "⚠️ Failed to clean up lead conversations:",
            cleanupError.message
          );
        }
      }

      // Delete the lead document
      await this.db.collection(this.collection).doc(leadId).delete();

      console.log(`✅ Lead ${leadId} deleted successfully`);

      // Broadcast lead deletion to all connected clients
      broadcastMessage(
        {
          leadId: leadId,
          phone: lead.phone,
          email: lead.email,
          deletedAt: new Date(),
        },
        "lead_deleted"
      );

      return true;
    } catch (error) {
      console.error("❌ Error deleting lead:", error);
      throw error;
    }
  }

  /**
   * Get leads by status
   */
  async getLeadsByStatus(status, limit = 50) {
    try {
      const snapshot = await this.db
        .collection(this.collection)
        .where("status", "==", status)
        .limit(limit)
        .get();

      const leads = [];
      snapshot.forEach((doc) => {
        const data = this._convertTimestamps(doc.data());
        leads.push({
          id: doc.id,
          ...data,
        });
      });

      return leads;
    } catch (error) {
      console.error("❌ Error getting leads by status:", error);
      throw error;
    }
  }

  /**
   * Get all leads with optimized pagination and filtering
   */
  async getAllLeads(options = {}) {
    try {
      const {
        limit = 25, // Reduced default limit from 50 to 25
        offset = 0,
        status,
        source,
        search,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = options;

      console.log(`📋 Fetching leads with options:`, {
        limit,
        offset,
        status,
        source,
        search,
        sortBy,
        sortOrder,
      });

      // Build optimized query
      let query = this.db.collection(this.collection);

      // Add status filter if provided
      if (status) {
        query = query.where("status", "==", status);
      }

      // Add source filter if provided
      if (source) {
        query = query.where("source", "==", source);
      }

      // Add ordering (ensure index exists)
      const validSortFields = [
        "createdAt",
        "updatedAt",
        "lastInteractionAt",
        "status",
      ];
      const sortField = validSortFields.includes(sortBy) ? sortBy : "createdAt";
      const sortDirection = sortOrder.toLowerCase() === "asc" ? "asc" : "desc";

      query = query.orderBy(sortField, sortDirection);

      // Add pagination
      if (offset > 0) {
        // Get offset document for cursor pagination
        const offsetQuery = await this.db
          .collection(this.collection)
          .orderBy(sortField, sortDirection)
          .limit(offset)
          .get();

        if (!offsetQuery.empty) {
          const lastDoc = offsetQuery.docs[offsetQuery.docs.length - 1];
          query = query.startAfter(lastDoc);
        }
      }

      query = query.limit(limit);

      const snapshot = await query.get();

      console.log(`📊 Raw leads fetched: ${snapshot.docs.length}`);

      // Convert to objects with timestamp conversion
      let leads = snapshot.docs.map((doc) => {
        const data = this._convertTimestamps(doc.data());
        return {
          id: doc.id,
          ...data,
        };
      });

      // Apply text search filter if provided (since Firestore doesn't support text search)
      if (search && search.trim()) {
        const searchTerm = search.toLowerCase().trim();
        leads = leads.filter(
          (lead) =>
            (lead.name && lead.name.toLowerCase().includes(searchTerm)) ||
            (lead.email && lead.email.toLowerCase().includes(searchTerm)) ||
            (lead.phone && lead.phone.toLowerCase().includes(searchTerm)) ||
            (lead.program && lead.program.toLowerCase().includes(searchTerm)) ||
            (lead.source && lead.source.toLowerCase().includes(searchTerm))
        );
      }

      const hasMore = snapshot.docs.length === limit;

      console.log(
        `✅ Returning ${leads.length} leads with hasMore: ${hasMore}`
      );

      return {
        leads,
        hasMore,
        pagination: {
          limit,
          offset,
          hasMore,
          count: leads.length,
        },
      };
    } catch (error) {
      console.error("❌ Error getting all leads:", error);
      return {
        leads: [],
        hasMore: false,
        pagination: {
          limit: options.limit || 25,
          offset: options.offset || 0,
          hasMore: false,
          count: 0,
        },
      };
    }
  }

  /**
   * Add interaction to lead
   */
  async addInteraction(leadId, interactionData) {
    try {
      const lead = await this.getLeadById(leadId);
      if (!lead) {
        throw new Error("Lead not found");
      }

      const interaction = {
        date: interactionData.timestamp
          ? new Date(interactionData.timestamp)
          : new Date(),
        type: interactionData.type || "NOTE",
        content: interactionData.content || "",
        channel: interactionData.channel || "SYSTEM",
        automated: interactionData.automated || false,
        direction: interactionData.direction || "outgoing",
        messageId: interactionData.messageId || null,
        metadata: {
          ...interactionData.metadata,
          messageType: interactionData.metadata?.messageType || "text",
          isBusinessMessage:
            interactionData.metadata?.isBusinessMessage || false,
        },
      };

      // Add to timeline with enhanced metadata
      const timeline = LeadModel.addTimelineEntry(
        lead.timeline || [],
        "INTERACTION",
        lead.status,
        interaction.content,
        interaction
      );

      // Prepare update data with message counting
      const updateData = {
        timeline,
        totalInteractions: (lead.totalInteractions || 0) + 1,
        lastInteractionAt: new Date(),
        updatedAt: new Date(),
      };

      // Track WhatsApp specific counters
      if (interaction.type === "WHATSAPP") {
        updateData.whatsappMessageCount = (lead.whatsappMessageCount || 0) + 1;
        if (interaction.direction === "incoming") {
          updateData.whatsappIncomingCount =
            (lead.whatsappIncomingCount || 0) + 1;
          // Check for auto-qualification after incoming message
          if (updateData.whatsappIncomingCount >= 3) {
            await this.checkAutoQualification(leadId);
          }
        }
      }

      await this.db.collection(this.collection).doc(leadId).update(updateData);

      console.log(`✅ Interaction added to lead ${leadId}`);

      // Get updated lead data and process auto-qualification
      const finalLead = await this._processAutoQualificationAfterInteraction(
        leadId
      );

      return finalLead;
    } catch (error) {
      console.error("❌ Error adding interaction:", error);
      throw error;
    }
  }

  /**
   * Get leads due for follow-up
   */
  async getLeadsDueForFollowUp() {
    try {
      const now = new Date();

      // Simple query without complex indexing
      const snapshot = await this.db
        .collection(this.collection)
        .where("nextFollowUpDate", "<=", now)
        .get();

      const leads = [];
      snapshot.forEach((doc) => {
        const rawData = doc.data();
        const data = this._convertTimestamps(rawData);

        // Filter in memory to avoid complex indexing
        if (
          [
            LEAD_STATUSES.FOLLOW_UP,
            LEAD_STATUSES.PRE_QUALIFIED,
            LEAD_STATUSES.NURTURE,
          ].includes(data.status)
        ) {
          leads.push({
            id: doc.id,
            ...data,
          });
        }
      });

      return leads;
    } catch (error) {
      console.error("❌ Error getting leads due for follow-up:", error);
      throw error;
    }
  }

  /**
   * Set follow-up date for lead
   */
  async setFollowUpDate(leadId, followUpDate) {
    try {
      await this.db.collection(this.collection).doc(leadId).update({
        nextFollowUpDate: followUpDate,
        updatedAt: new Date(),
      });

      console.log(`✅ Follow-up date set for lead ${leadId}`);

      return await this.getLeadById(leadId);
    } catch (error) {
      console.error("❌ Error setting follow-up date:", error);
      throw error;
    }
  }

  /**
   * Get lead statistics
   */
  async getLeadStats() {
    try {
      const snapshot = await this.db.collection(this.collection).get();

      const stats = {
        total: snapshot.size,
        byStatus: {},
        bySource: {},
      };

      snapshot.forEach((doc) => {
        const data = doc.data();

        // Count by status
        stats.byStatus[data.status] = (stats.byStatus[data.status] || 0) + 1;

        // Count by source
        if (data.source) {
          stats.bySource[data.source] = (stats.bySource[data.source] || 0) + 1;
        }
      });

      return stats;
    } catch (error) {
      console.error("❌ Error getting lead stats:", error);
      throw error;
    }
  }

  /**
   * Process auto-qualification after interaction (private method)
   * Follows single responsibility principle and improves testability
   */
  async _processAutoQualificationAfterInteraction(leadId) {
    try {
      // Get updated lead data once
      const updatedLead = await this.getLeadById(leadId);

      // Check qualification eligibility
      const qualificationResult = await this._checkAutoQualificationEligibility(
        updatedLead
      );

      if (!qualificationResult.shouldQualify) {
        console.log(
          `📊 Lead ${leadId} qualification status: ${qualificationResult.reason}`
        );
        return updatedLead;
      }

      // Attempt auto-qualification
      const qualifiedLead = await this._executeAutoQualification(
        leadId,
        qualificationResult
      );

      return qualifiedLead || updatedLead; // Fallback to original if qualification fails
    } catch (error) {
      console.error(
        `❌ Error processing auto-qualification for lead ${leadId}:`,
        error
      );
      // Return original lead data on error
      return await this.getLeadById(leadId);
    }
  }

  /**
   * Check if lead is eligible for auto-qualification (private method)
   * Separates business logic from execution logic
   */
  async _checkAutoQualificationEligibility(leadData) {
    return LeadModel.shouldAutoQualify(leadData);
  }

  /**
   * Execute the auto-qualification process (private method)
   * Handles the actual status update with proper error handling
   */
  async _executeAutoQualification(leadId, qualificationResult) {
    const { qualifyingInteractions, threshold } = qualificationResult;

    console.log(
      `🎯 Auto-qualifying lead ${leadId}: ${qualificationResult.reason}`
    );

    try {
      // Use configurable values instead of hard-coded ones
      const autoQualificationConfig = this._getAutoQualificationConfig();

      await this.updateLeadStatus(
        leadId,
        autoQualificationConfig.targetStatus,
        autoQualificationConfig.generateNotes(qualifyingInteractions),
        autoQualificationConfig.systemUser
      );

      console.log(
        `✅ Lead ${leadId} auto-qualified to ${autoQualificationConfig.targetStatus}`
      );

      // Broadcast auto-qualification event for analytics/notifications
      await this._notifyAutoQualification(leadId, qualificationResult);

      return await this.getLeadById(leadId);
    } catch (error) {
      console.error(
        `❌ Error executing auto-qualification for lead ${leadId}:`,
        error
      );
      throw error; // Re-throw to be handled by calling method
    }
  }

  /**
   * Get auto-qualification configuration (private method)
   * Now uses centralized configuration system
   */
  _getAutoQualificationConfig() {
    const config = AUTO_QUALIFICATION_CONFIG;

    return {
      targetStatus: config.TARGET_STATUSES.BASIC_QUALIFICATION,
      systemUser: config.SYSTEM_USERS.AUTO_QUALIFICATION,
      generateNotes: (interactionCount) =>
        config.NOTE_TEMPLATES.PRE_QUALIFIED(interactionCount),

      // Additional configuration options
      retryConfig: QUALIFICATION_SERVICE_CONFIG.RETRY,
      notifications: QUALIFICATION_SERVICE_CONFIG.NOTIFICATIONS,
    };
  }

  /**
   * Notify about auto-qualification event (private method)
   * Separates notification logic for better maintainability
   */
  async _notifyAutoQualification(leadId, qualificationResult) {
    try {
      // Broadcast real-time update
      if (this.broadcastService) {
        await this.broadcastService.broadcastToAll("lead_auto_qualified", {
          leadId,
          qualificationData: qualificationResult,
          timestamp: new Date(),
        });
      }
    } catch (error) {
      console.warn(
        `⚠️ Failed to notify auto-qualification for lead ${leadId}:`,
        error
      );
      // Don't throw - notification failures shouldn't break the main flow
    }
  }
}

module.exports = LeadService;
