/**
 * Lead Service for Firestore Operations
 * Simple CRUD operations and status management
 */

const { LeadModel } = require("../models/lead.model");
const { LEAD_STATUSES, LEAD_SOURCES } = require("../config/lead.constants");
const { broadcastMessage } = require("./broadcastService");
const redisCache = require("./redisCache.service");

class LeadService {
  constructor(firestore) {
    this.db = firestore;
    this.collection = "leads";
    this.cache = redisCache;

    // Cache TTL for leads data (5 minutes for conversion leads)
    this.CACHE_TTL = {
      LEADS_BY_STATUS: 300, // 5 minutes
      LEAD_STATS: 600, // 10 minutes
      CONVERSION_LEADS: 300, // 5 minutes for conversion plan data
    };
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

      return snapshot.docs.map((doc) =>
        this._normalizeLead(doc.id, doc.data())
      );
    } catch (error) {
      console.error(`Error finding leads with status ${status}:`, error);
      throw error;
    }
  }

  /**
   * Convert timestamps in lead data
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
   * Normalize lead data to ensure consistent status from timeline
   */
  _normalizeLead(docId, data) {
    try {
      let convertedData = this._convertTimestamps(data);

      // Use the new validation methods from LeadModel
      convertedData = LeadModel.validateAndFixTimeline(convertedData);
      convertedData = LeadModel.verifyStatusConsistency(convertedData);

      // Legacy warning for invalid timeline format (now handled by validateAndFixTimeline)
      if (data.timeline && !Array.isArray(data.timeline)) {
        console.error(
          `❌ Lead ${docId} has invalid timeline format. Converting to array.`
        );
      }

      const currentStatus = LeadModel.getCurrentStatus(convertedData);

      return {
        id: docId,
        ...convertedData,
        status: currentStatus, // Always use timeline-based status
      };
    } catch (error) {
      console.error(`❌ Error normalizing lead ${docId}:`, error);
      // Return a safe fallback version
      return {
        id: docId,
        ...data,
        status: data.status || "INTERESTED",
        timeline: Array.isArray(data.timeline) ? data.timeline : [],
      };
    }
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

      // Handle initialTimeline if provided in additionalData
      if (
        additionalData.initialTimeline &&
        Array.isArray(additionalData.initialTimeline)
      ) {
        console.log("ℹ️ Using provided initialTimeline for lead");
        fullLeadData.timeline = additionalData.initialTimeline;
        delete fullLeadData.initialTimeline; // Remove this field as it's been processed
      }

      // Ensure timeline is always a valid array
      if (!fullLeadData.timeline || !Array.isArray(fullLeadData.timeline)) {
        console.log("⚠️ Initializing lead timeline as empty array");
        fullLeadData.timeline = [];

        // Add the initial status entry if timeline was invalid
        fullLeadData.timeline.push({
          date: new Date(),
          action: "CREATED",
          status: fullLeadData.status || LEAD_STATUSES.INTERESTED,
          notes: `Lead created from ${source || "unknown source"}`,
        });
      }

      // If submittedBy info is provided, only use it in timeline for transparency
      // but don't duplicate at the top level (kept only in the application document)
      if (
        additionalData.submittedBy &&
        Array.isArray(fullLeadData.timeline) &&
        fullLeadData.timeline.length > 0
      ) {
        // Only update timeline notes to reflect who created it
        fullLeadData.timeline[0] = {
          ...fullLeadData.timeline[0],
          notes: `Lead created from ${source || "unknown source"} by ${
            additionalData.submittedBy.name ||
            additionalData.submittedBy.email ||
            additionalData.submittedBy.uid
          } (${additionalData.submittedBy.role})`,
          // Only include minimal reference to who created it for historical tracking
          createdBy: {
            uid: additionalData.submittedBy.uid || null,
            role: additionalData.submittedBy.role || null,
          },
        };
      }

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

      return this._normalizeLead(doc.id, doc.data());
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
            const lead = this._normalizeLead(doc.id, doc.data());

            console.log(
              `✅ Found lead with primary phone ${
                doc.data().phone
              }, timeline status: ${lead.status}, stored status: ${
                doc.data().status
              }`
            );

            return lead;
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
              const lead = this._normalizeLead(doc.id, doc.data());

              console.log(
                `✅ Found lead with additional phone ${format}, timeline status: ${
                  lead.status
                }, stored status: ${doc.data().status}`
              );

              return lead;
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
        const lead = this._normalizeLead(doc.id, doc.data());

        console.log(`✅ Found lead with primary email ${email}`);

        return lead;
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
          const lead = this._normalizeLead(doc.id, doc.data());

          console.log(`✅ Found lead with additional email ${email}`);

          return lead;
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

  // Core implementation for updating lead status (used internally and by cache-wrapping method)
  async _updateLeadStatusCore(
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
        console.log(
          `⚠️ Force updating lead ${leadId} status from ${lead.status} to ${newStatus}`
        );

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

        const updateData = {
          status: newStatus,
          timeline,
          updatedAt: new Date(),
        };

        if (updatedBy) {
          updateData.lastUpdatedBy = updatedBy;
        }

        await this.db
          .collection(this.collection)
          .doc(leadId)
          .update(updateData);
        updatedLead = await this.getLeadById(leadId);
      } else {
        console.log(
          `📊 Updating lead ${leadId} status: stored status=${
            lead.status
          }, timeline status=${LeadModel.getCurrentStatus(
            lead
          )}, new status=${newStatus}`
        );

        updatedLead = LeadModel.updateStatus(lead, newStatus, notes, updatedBy);
        if (updatedBy) {
          updatedLead.lastUpdatedBy = updatedBy;
        }

        await this.db
          .collection(this.collection)
          .doc(leadId)
          .update(updatedLead);
      }

      console.log(`✅ Lead ${leadId} status updated to ${newStatus}`);

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
   * Delete a lead and all associated data
   */
  async deleteLead(leadId) {
    try {
      // Get the lead first to clean up any related data
      const lead = await this.getLeadById(leadId);
      if (!lead) {
        throw new Error("Lead not found");
      }

      console.log(
        `🗑️ Starting comprehensive deletion of lead ${leadId} (${
          lead.name || "Unknown"
        })`
      );

      let cleanupResults = {
        conversations: 0,
        messages: 0,
        applications: 0,
        storageFiles: 0,
        errors: [],
      };

      // 1. Delete related conversations and messages
      if (lead.phoneNumber || lead.phone) {
        try {
          const ConversationService = require("./conversationService");
          const conversationService = new ConversationService();

          const phoneToSearch = lead.phoneNumber || lead.phone;
          console.log(
            `📞 Looking for conversations with phone: ${phoneToSearch}`
          );

          // Find conversation by phone number
          const conversationId =
            await conversationService.findConversationByPhone(phoneToSearch);

          if (conversationId) {
            console.log(
              `💬 Found conversation ${conversationId} for lead ${leadId}`
            );

            // Get conversation details to check if it belongs to this lead
            const conversationDoc = await this.db
              .collection("conversations")
              .doc(conversationId)
              .get();

            if (conversationDoc.exists) {
              const conversationData = conversationDoc.data();

              // Delete conversation if it belongs to this lead OR if leadId matches OR if phone matches
              // (conversations might not have leadId set but still belong to this lead)
              const shouldDelete =
                !conversationData.leadId ||
                conversationData.leadId === leadId ||
                conversationData.phoneNumber === phoneToSearch;

              if (shouldDelete) {
                const deleteResult =
                  await conversationService.deleteConversation(conversationId);
                cleanupResults.conversations += 1;
                cleanupResults.messages += deleteResult.deletedMessages || 0;
                console.log(
                  `✅ Deleted conversation ${conversationId} with ${
                    deleteResult.deletedMessages || 0
                  } messages`
                );
              } else {
                console.log(
                  `⚠️ Conversation ${conversationId} belongs to different lead (${conversationData.leadId}), skipping`
                );
              }
            }
          } else {
            console.log(`ℹ️ No conversation found for phone ${phoneToSearch}`);
          }

          // Also search for conversations by leadId directly
          try {
            const conversationsByLeadQuery = await this.db
              .collection("conversations")
              .where("leadId", "==", leadId)
              .get();

            for (const conversationDoc of conversationsByLeadQuery.docs) {
              const conversationId = conversationDoc.id;
              console.log(
                `💬 Found additional conversation ${conversationId} with leadId ${leadId}`
              );

              const deleteResult = await conversationService.deleteConversation(
                conversationId
              );
              cleanupResults.conversations += 1;
              cleanupResults.messages += deleteResult.deletedMessages || 0;
              console.log(
                `✅ Deleted conversation ${conversationId} with ${
                  deleteResult.deletedMessages || 0
                } messages`
              );
            }
          } catch (leadIdSearchError) {
            console.warn(
              `⚠️ Could not search conversations by leadId: ${leadIdSearchError.message}`
            );
            cleanupResults.errors.push(
              `Conversation search by leadId failed: ${leadIdSearchError.message}`
            );
          }
        } catch (conversationCleanupError) {
          console.warn(
            "⚠️ Failed to clean up lead conversations:",
            conversationCleanupError.message
          );
          cleanupResults.errors.push(
            `Conversation cleanup failed: ${conversationCleanupError.message}`
          );
        }
      }

      // 2. Delete related applications and their Firebase Storage documents
      if (lead.email) {
        try {
          console.log(`📋 Looking for applications with email: ${lead.email}`);

          // Initialize storage cleanup tracking
          cleanupResults.storageFiles = 0;

          // Find applications by email
          const applicationsQuery = await this.db
            .collection("applications")
            .where("email", "==", lead.email.toLowerCase())
            .get();

          for (const applicationDoc of applicationsQuery.docs) {
            const applicationData = applicationDoc.data();

            // Delete application if it belongs to this lead or if leadId matches
            const shouldDelete =
              !applicationData.leadId || applicationData.leadId === leadId;

            if (shouldDelete) {
              // Clean up Firebase Storage documents for this application
              try {
                const ApplicationService = require("./applicationService");
                const StorageService = require("./storageService");

                // Create temporary instances for cleanup
                const storageService = new StorageService();
                const applicationService = new ApplicationService(
                  this.db,
                  this,
                  null,
                  storageService
                );

                console.log(
                  `🗑️ Cleaning up storage documents for application ${applicationDoc.id}`
                );

                const storageCleanupResult =
                  await applicationService.deleteAllApplicationDocuments(
                    applicationDoc.id
                  );

                if (storageCleanupResult.success) {
                  cleanupResults.storageFiles +=
                    storageCleanupResult.deletedCount;
                  console.log(
                    `✅ Deleted ${storageCleanupResult.deletedCount} storage files for application ${applicationDoc.id}`
                  );
                }
              } catch (storageCleanupError) {
                console.warn(
                  `⚠️ Failed to cleanup storage for application ${applicationDoc.id}:`,
                  storageCleanupError.message
                );
                cleanupResults.errors.push(
                  `Storage cleanup failed for application ${applicationDoc.id}: ${storageCleanupError.message}`
                );
              }

              // Delete the application document
              await this.db
                .collection("applications")
                .doc(applicationDoc.id)
                .delete();
              cleanupResults.applications += 1;
              console.log(`✅ Deleted application ${applicationDoc.id}`);
            } else {
              console.log(
                `⚠️ Application ${applicationDoc.id} belongs to different lead (${applicationData.leadId}), skipping`
              );
            }
          }

          // Also search for applications by leadId directly
          try {
            const applicationsByLeadQuery = await this.db
              .collection("applications")
              .where("leadId", "==", leadId)
              .get();

            for (const applicationDoc of applicationsByLeadQuery.docs) {
              // Clean up Firebase Storage documents for this application
              try {
                const ApplicationService = require("./applicationService");
                const StorageService = require("./storageService");

                // Create temporary instances for cleanup
                const storageService = new StorageService();
                const applicationService = new ApplicationService(
                  this.db,
                  this,
                  null,
                  storageService
                );

                console.log(
                  `🗑️ Cleaning up storage documents for application ${applicationDoc.id}`
                );

                const storageCleanupResult =
                  await applicationService.deleteAllApplicationDocuments(
                    applicationDoc.id
                  );

                if (storageCleanupResult.success) {
                  cleanupResults.storageFiles +=
                    storageCleanupResult.deletedCount;
                  console.log(
                    `✅ Deleted ${storageCleanupResult.deletedCount} storage files for application ${applicationDoc.id}`
                  );
                }
              } catch (storageCleanupError) {
                console.warn(
                  `⚠️ Failed to cleanup storage for application ${applicationDoc.id}:`,
                  storageCleanupError.message
                );
                cleanupResults.errors.push(
                  `Storage cleanup failed for application ${applicationDoc.id}: ${storageCleanupError.message}`
                );
              }

              await this.db
                .collection("applications")
                .doc(applicationDoc.id)
                .delete();
              cleanupResults.applications += 1;
              console.log(
                `✅ Deleted application ${applicationDoc.id} with leadId ${leadId}`
              );
            }
          } catch (leadIdSearchError) {
            console.warn(
              `⚠️ Could not search applications by leadId: ${leadIdSearchError.message}`
            );
            cleanupResults.errors.push(
              `Application search by leadId failed: ${leadIdSearchError.message}`
            );
          }
        } catch (applicationCleanupError) {
          console.warn(
            "⚠️ Failed to clean up lead applications:",
            applicationCleanupError.message
          );
          cleanupResults.errors.push(
            `Application cleanup failed: ${applicationCleanupError.message}`
          );
        }
      }

      // 3. Delete any orphaned messages that might reference this lead
      try {
        console.log(
          `🔍 Looking for orphaned messages referencing lead ${leadId}`
        );

        const orphanedMessagesQuery = await this.db
          .collection("messages")
          .where("leadId", "==", leadId)
          .get();

        if (!orphanedMessagesQuery.empty) {
          const batch = this.db.batch();
          orphanedMessagesQuery.docs.forEach((doc) => {
            batch.delete(doc.ref);
          });
          await batch.commit();

          console.log(
            `✅ Cleaned up ${orphanedMessagesQuery.size} orphaned messages`
          );
          cleanupResults.messages += orphanedMessagesQuery.size;
        }
      } catch (messageCleanupError) {
        console.warn(
          "⚠️ Failed to clean up orphaned messages:",
          messageCleanupError.message
        );
        cleanupResults.errors.push(
          `Orphaned message cleanup failed: ${messageCleanupError.message}`
        );
      }

      // 4. Delete the lead document itself
      await this.db.collection(this.collection).doc(leadId).delete();

      // 5. Log comprehensive cleanup results
      console.log(
        `✅ Lead ${leadId} deleted successfully with cleanup results:`
      );
      console.log(
        `   📞 Conversations deleted: ${cleanupResults.conversations}`
      );
      console.log(`   💬 Messages deleted: ${cleanupResults.messages}`);
      console.log(`   📋 Applications deleted: ${cleanupResults.applications}`);
      console.log(
        `   📁 Storage files deleted: ${cleanupResults.storageFiles || 0}`
      );

      if (cleanupResults.errors.length > 0) {
        console.log(`   ⚠️ Cleanup errors: ${cleanupResults.errors.length}`);
        cleanupResults.errors.forEach((error) =>
          console.log(`     - ${error}`)
        );
      }

      // 6. Broadcast lead deletion to all connected clients
      broadcastMessage(
        {
          leadId: leadId,
          phone: lead.phone,
          email: lead.email,
          deletedAt: new Date(),
          cleanupResults: {
            conversations: cleanupResults.conversations,
            messages: cleanupResults.messages,
            applications: cleanupResults.applications,
            storageFiles: cleanupResults.storageFiles || 0,
            errors: cleanupResults.errors.length,
          },
        },
        "lead_deleted"
      );

      return {
        success: true,
        leadId: leadId,
        cleanupResults: cleanupResults,
      };
    } catch (error) {
      console.error("❌ Error deleting lead:", error);
      throw error;
    }
  }

  /**
   * Get leads by status with caching
   */
  async getLeadsByStatus(status, limit = 50, options = {}) {
    try {
      const {
        sortBy = "createdAt",
        sortOrder = "desc",
        offset = 0,
        useCache = true,
      } = options;

      // Generate cache key
      const cacheKey = `leads_by_status:${status}:${limit}:${offset}:${sortBy}:${sortOrder}`;

      // Try to get from cache first if caching is enabled
      if (useCache) {
        const cachedLeads = await this.cache.get(cacheKey);
        if (cachedLeads) {
          console.log(
            `⚡ Retrieved ${cachedLeads.length} leads from cache for status: ${status}`
          );
          return cachedLeads;
        }
      }

      console.log(
        `📋 Fetching leads by status: ${status} with limit: ${limit}, sorting: ${sortBy} ${sortOrder}`
      );

      // Cap the limit to prevent excessive loads, but allow higher limits for analytics
      const numericLimit = parseInt(limit, 10);
      const maxLimit = Math.min(numericLimit, 10000);

      console.log(
        `🔍 DEBUG: Original limit: ${limit} (${typeof limit}), numericLimit: ${numericLimit}, maxLimit: ${maxLimit}`
      );

      let query = this.db
        .collection(this.collection)
        .where("status", "==", status);

      // Add ordering to ensure consistent results
      const validSortFields = [
        "createdAt",
        "updatedAt",
        "lastInteractionAt",
        "status",
      ];
      const sortField = validSortFields.includes(sortBy) ? sortBy : "createdAt";
      const sortDirection = sortOrder.toLowerCase() === "asc" ? "asc" : "desc";

      query = query.orderBy(sortField, sortDirection);

      // Add pagination if offset is provided
      if (offset > 0) {
        // For consistency with getAllLeads, use similar offset logic
        if (offset <= 2000) {
          const totalLimit = offset + maxLimit;
          query = query.limit(totalLimit);

          const snapshot = await query.get();
          const allLeads = snapshot.docs.map((doc) =>
            this._normalizeLead(doc.id, doc.data())
          );

          const leads = allLeads.slice(offset, offset + maxLimit);

          // Cache the results if caching is enabled
          if (useCache) {
            await this.cache.set(
              cacheKey,
              leads,
              this.CACHE_TTL.LEADS_BY_STATUS
            );
            console.log(
              `💾 Cached ${leads.length} leads for status: ${status}`
            );
          }

          console.log(
            `✅ Returning ${leads.length} leads by status (offset-based)`
          );
          return leads;
        } else {
          // Cursor pagination for larger offsets
          const offsetQuery = await this.db
            .collection(this.collection)
            .where("status", "==", status)
            .orderBy(sortField, sortDirection)
            .limit(offset)
            .get();

          if (!offsetQuery.empty) {
            const lastDoc = offsetQuery.docs[offsetQuery.docs.length - 1];
            query = query.startAfter(lastDoc);
          }
        }
      }

      query = query.limit(maxLimit);
      const snapshot = await query.get();

      const leads = snapshot.docs.map((doc) =>
        this._normalizeLead(doc.id, doc.data())
      );

      // Cache the results if caching is enabled
      if (useCache) {
        await this.cache.set(cacheKey, leads, this.CACHE_TTL.LEADS_BY_STATUS);
        console.log(`💾 Cached ${leads.length} leads for status: ${status}`);
      }

      console.log(`✅ Returning ${leads.length} leads by status: ${status}`);
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
        limit = 50, // Increased default limit from 25 to 50
        offset = 0,
        status,
        source,
        search,
        name,
        email,
        phone,
        program,
        dateRange,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = options;

      console.log(`📋 Fetching leads with options:`, {
        limit,
        offset,
        status,
        source,
        search,
        name,
        email,
        phone,
        program,
        dateRange,
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

      // For better consistency, use simple offset-based pagination for small offsets
      // and fall back to cursor pagination for larger offsets
      if (offset > 0 && offset <= 2000) {
        // For small offsets, use simple limit/skip approach by fetching more and slicing
        const totalLimit = offset + limit;
        query = query.limit(totalLimit);

        const snapshot = await query.get();
        console.log(
          `📊 Raw leads fetched: ${snapshot.docs.length} (for offset: ${offset})`
        );

        // Convert to objects with timestamp conversion
        let allLeads = snapshot.docs.map((doc) =>
          this._normalizeLead(doc.id, doc.data())
        );

        // Apply text search filter if provided (since Firestore doesn't support text search)
        if (search && search.trim()) {
          const searchTerm = search.toLowerCase().trim();
          allLeads = allLeads.filter(
            (lead) =>
              (lead.name && lead.name.toLowerCase().includes(searchTerm)) ||
              (lead.email && lead.email.toLowerCase().includes(searchTerm)) ||
              (lead.phone && lead.phone.toLowerCase().includes(searchTerm)) ||
              (lead.program &&
                lead.program.toLowerCase().includes(searchTerm)) ||
              (lead.source && lead.source.toLowerCase().includes(searchTerm))
          );
        }

        // Apply advanced search filters for individual fields
        if (name && name.trim()) {
          const nameTerm = name.toLowerCase().trim();
          allLeads = allLeads.filter(
            (lead) => lead.name && lead.name.toLowerCase().includes(nameTerm)
          );
        }

        if (email && email.trim()) {
          const emailTerm = email.toLowerCase().trim();
          allLeads = allLeads.filter(
            (lead) => lead.email && lead.email.toLowerCase().includes(emailTerm)
          );
        }

        if (phone && phone.trim()) {
          const phoneTerm = phone.toLowerCase().trim();
          allLeads = allLeads.filter(
            (lead) => lead.phone && lead.phone.toLowerCase().includes(phoneTerm)
          );
        }

        if (program && program.trim()) {
          const programTerm = program.toLowerCase().trim();
          allLeads = allLeads.filter(
            (lead) =>
              lead.program && lead.program.toLowerCase().includes(programTerm)
          );
        }

        // Apply offset and limit
        const leads = allLeads.slice(offset, offset + limit);
        const hasMore = allLeads.length > offset + limit;

        console.log(
          `✅ Returning ${leads.length} leads with hasMore: ${hasMore} (offset-based)`
        );

        return {
          leads,
          hasMore,
          pagination: {
            limit,
            offset,
            hasMore,
            count: leads.length,
            totalAvailable: allLeads.length,
          },
        };
      } else if (offset > 2000) {
        // For larger offsets, use cursor pagination
        const offsetQuery = await this.db
          .collection(this.collection)
          .orderBy(sortField, sortDirection)
          .limit(offset)
          .get();

        if (!offsetQuery.empty) {
          const lastDoc = offsetQuery.docs[offsetQuery.docs.length - 1];
          query = query.startAfter(lastDoc);
        }

        query = query.limit(limit);
        const snapshot = await query.get();

        console.log(
          `📊 Raw leads fetched: ${snapshot.docs.length} (cursor-based)`
        );

        // Convert to objects with timestamp conversion
        let leads = snapshot.docs.map((doc) =>
          this._normalizeLead(doc.id, doc.data())
        );

        // Apply text search filter if provided
        if (search && search.trim()) {
          const searchTerm = search.toLowerCase().trim();
          leads = leads.filter(
            (lead) =>
              (lead.name && lead.name.toLowerCase().includes(searchTerm)) ||
              (lead.email && lead.email.toLowerCase().includes(searchTerm)) ||
              (lead.phone && lead.phone.toLowerCase().includes(searchTerm)) ||
              (lead.program &&
                lead.program.toLowerCase().includes(searchTerm)) ||
              (lead.source && lead.source.toLowerCase().includes(searchTerm))
          );
        }

        // Apply advanced search filters for individual fields
        if (name && name.trim()) {
          const nameTerm = name.toLowerCase().trim();
          leads = leads.filter(
            (lead) => lead.name && lead.name.toLowerCase().includes(nameTerm)
          );
        }

        if (email && email.trim()) {
          const emailTerm = email.toLowerCase().trim();
          leads = leads.filter(
            (lead) => lead.email && lead.email.toLowerCase().includes(emailTerm)
          );
        }

        if (phone && phone.trim()) {
          const phoneTerm = phone.toLowerCase().trim();
          leads = leads.filter(
            (lead) => lead.phone && lead.phone.toLowerCase().includes(phoneTerm)
          );
        }

        if (program && program.trim()) {
          const programTerm = program.toLowerCase().trim();
          leads = leads.filter(
            (lead) =>
              lead.program && lead.program.toLowerCase().includes(programTerm)
          );
        }

        const hasMore = snapshot.docs.length === limit;

        console.log(
          `✅ Returning ${leads.length} leads with hasMore: ${hasMore} (cursor-based)`
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
      } else {
        // For zero offset, simple query
        query = query.limit(limit);
        const snapshot = await query.get();

        console.log(`📊 Raw leads fetched: ${snapshot.docs.length} (simple)`);

        // Convert to objects with timestamp conversion
        let leads = snapshot.docs.map((doc) =>
          this._normalizeLead(doc.id, doc.data())
        );

        // Apply text search filter if provided
        if (search && search.trim()) {
          const searchTerm = search.toLowerCase().trim();
          leads = leads.filter(
            (lead) =>
              (lead.name && lead.name.toLowerCase().includes(searchTerm)) ||
              (lead.email && lead.email.toLowerCase().includes(searchTerm)) ||
              (lead.phone && lead.phone.toLowerCase().includes(searchTerm)) ||
              (lead.program &&
                lead.program.toLowerCase().includes(searchTerm)) ||
              (lead.source && lead.source.toLowerCase().includes(searchTerm))
          );
        }

        // Apply advanced search filters for individual fields
        if (name && name.trim()) {
          const nameTerm = name.toLowerCase().trim();
          leads = leads.filter(
            (lead) => lead.name && lead.name.toLowerCase().includes(nameTerm)
          );
        }

        if (email && email.trim()) {
          const emailTerm = email.toLowerCase().trim();
          leads = leads.filter(
            (lead) => lead.email && lead.email.toLowerCase().includes(emailTerm)
          );
        }

        if (phone && phone.trim()) {
          const phoneTerm = phone.toLowerCase().trim();
          leads = leads.filter(
            (lead) => lead.phone && lead.phone.toLowerCase().includes(phoneTerm)
          );
        }

        if (program && program.trim()) {
          const programTerm = program.toLowerCase().trim();
          leads = leads.filter(
            (lead) =>
              lead.program && lead.program.toLowerCase().includes(programTerm)
          );
        }

        const hasMore = snapshot.docs.length === limit;

        console.log(
          `✅ Returning ${leads.length} leads with hasMore: ${hasMore} (simple)`
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
      }
    } catch (error) {
      console.error("❌ Error getting all leads:", error);
      return {
        leads: [],
        hasMore: false,
        pagination: {
          limit: options.limit || 50,
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

      console.log(`📝 Adding enhanced interaction to lead ${leadId}:`, {
        type: interactionData.type,
        outcome: interactionData.outcome,
        agent: interactionData.agent,
        hasNotes: !!interactionData.notes,
      });

      // Get current user/agent information if available
      const agent = interactionData.agentInfo || {
        name: interactionData.agent || "Unknown",
        uid: interactionData.agentId || null,
        email: interactionData.agentEmail || null,
      };

      // Use enhanced interaction entry method
      const { timeline, interaction } = LeadModel.addInteractionEntry(
        lead.timeline || [],
        interactionData,
        lead.status,
        agent
      );

      // Update interaction summary
      const updatedInteractionSummary = LeadModel.updateInteractionSummary(
        lead,
        interaction
      );

      // Prepare update data
      const updateData = {
        timeline,
        interactionSummary: updatedInteractionSummary,

        // Update legacy fields for backwards compatibility
        totalInteractions: updatedInteractionSummary.totalInteractions,
        lastInteractionAt: interaction.createdAt,
        nextFollowUpDate: interaction.nextActionDate || lead.nextFollowUpDate,

        // Update main lead fields
        updatedAt: new Date(),
      };

      // Update WhatsApp specific counters (legacy compatibility)
      if (
        interaction.type === "WHATSAPP_MESSAGE" ||
        interaction.type === "WHATSAPP_CALL"
      ) {
        updateData.whatsappMessageCount =
          updatedInteractionSummary.whatsappMessageCount +
          updatedInteractionSummary.whatsappCallCount;
        if (interactionData.direction === "incoming") {
          updateData.whatsappIncomingCount =
            (lead.whatsappIncomingCount || 0) + 1;
        }
      }

      await this.db.collection(this.collection).doc(leadId).update(updateData);

      console.log(`✅ Enhanced interaction added to lead ${leadId}:`, {
        interactionId: interaction.id,
        type: interaction.type,
        outcome: interaction.outcome,
        conversionImpact: interaction.conversionImpact,
      });

      // Get updated lead data
      const finalLead = await this.getLeadById(leadId);
      return finalLead;
    } catch (error) {
      console.error("❌ Error adding enhanced interaction:", error);
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
        const lead = this._normalizeLead(doc.id, doc.data());

        // Filter in memory to avoid complex indexing
        if (
          [LEAD_STATUSES.PRE_QUALIFIED, LEAD_STATUSES.NURTURE].includes(
            lead.status
          )
        ) {
          leads.push(lead);
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
   * Get leads submitted by a specific user (for "For You" tab)
   * This includes both direct lead submissions and leads associated with applications submitted by the user
   * Enhanced to handle multiple submittedBy formats (email, name, displayName, username)
   */
  async getLeadsBySubmitter(userEmail, options = {}) {
    try {
      const {
        limit = 50,
        offset = 0,
        status,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = options;

      console.log(`🔍 Fetching leads submitted by: ${userEmail}`);

      // Step 1: Get user information to build multiple identifier queries
      let userInfo = null;
      try {
        const userSnapshot = await this.db
          .collection("users")
          .where("email", "==", userEmail)
          .limit(1)
          .get();

        if (!userSnapshot.empty) {
          userInfo = userSnapshot.docs[0].data();
        }
      } catch (error) {
        console.warn(
          `⚠️ Could not fetch user info for ${userEmail}:`,
          error.message
        );
      }

      // Step 2: Build list of possible submittedBy identifiers for this user
      const possibleIdentifiers = new Set([userEmail]); // Always include email

      if (userInfo) {
        // Add various name formats
        if (userInfo.name) possibleIdentifiers.add(userInfo.name);
        if (userInfo.displayName) possibleIdentifiers.add(userInfo.displayName);
        if (userInfo.email) {
          possibleIdentifiers.add(userInfo.email.split("@")[0]); // username part
        }
      }

      // Add role-based identifiers (common patterns from DataCenter)
      const commonRoles = [
        "marketingAgent",
        "admissionAgent",
        "admin",
        "admissionAdmin",
      ];
      commonRoles.forEach((role) => {
        possibleIdentifiers.add(`${role}-staff`);
      });

      console.log(
        `🔍 Searching for leads with submittedBy identifiers:`,
        Array.from(possibleIdentifiers)
      );

      // Step 3: Get leads directly submitted by the user using multiple queries
      const directLeads = [];
      const seenLeadIds = new Set(); // To avoid duplicates

      // Query 1: Legacy format - submittedBy.email
      try {
        let emailQuery = this.db
          .collection(this.collection)
          .where("submittedBy.email", "==", userEmail);

        if (status) {
          emailQuery = emailQuery.where("status", "==", status);
        }

        const emailSnapshot = await emailQuery.get();
        emailSnapshot.forEach((doc) => {
          if (!seenLeadIds.has(doc.id)) {
            const lead = this._normalizeLead(doc.id, doc.data());
            directLeads.push(lead);
            seenLeadIds.add(doc.id);
          }
        });

        console.log(
          `📋 Found ${emailSnapshot.size} leads with submittedBy.email = ${userEmail}`
        );
      } catch (error) {
        console.warn(`⚠️ Error querying by submittedBy.email:`, error.message);
      }

      // Query 2: New format - submittedBy as string
      for (const identifier of possibleIdentifiers) {
        try {
          let stringQuery = this.db
            .collection(this.collection)
            .where("submittedBy", "==", identifier);

          if (status) {
            stringQuery = stringQuery.where("status", "==", status);
          }

          const stringSnapshot = await stringQuery.get();
          stringSnapshot.forEach((doc) => {
            if (!seenLeadIds.has(doc.id)) {
              const lead = this._normalizeLead(doc.id, doc.data());
              directLeads.push(lead);
              seenLeadIds.add(doc.id);
            }
          });

          if (stringSnapshot.size > 0) {
            console.log(
              `📋 Found ${stringSnapshot.size} leads with submittedBy = "${identifier}"`
            );
          }
        } catch (error) {
          console.warn(
            `⚠️ Error querying by submittedBy = "${identifier}":`,
            error.message
          );
        }
      }

      console.log(`📋 Total direct leads found: ${directLeads.length}`);

      // Step 4: Get applications submitted by the user that have associated leadId
      const applicationQuery = this.db
        .collection("applications")
        .where("submittedBy.email", "==", userEmail)
        .where("leadId", "!=", null);

      const applicationSnapshot = await applicationQuery.get();
      const leadIdsFromApplications = [];
      applicationSnapshot.forEach((doc) => {
        const appData = doc.data();
        if (appData.leadId) {
          leadIdsFromApplications.push(appData.leadId);
        }
      });

      console.log(
        `📋 Found ${leadIdsFromApplications.length} applications with leadIds submitted by ${userEmail}`
      );

      // Step 5: Get leads associated with these applications
      const applicationLinkedLeads = [];
      if (leadIdsFromApplications.length > 0) {
        // Get each lead by ID
        for (const leadId of leadIdsFromApplications) {
          try {
            const leadDoc = await this.db
              .collection(this.collection)
              .doc(leadId)
              .get();
            if (leadDoc.exists) {
              const lead = this._normalizeLead(leadDoc.id, leadDoc.data());

              // Apply status filter if provided
              if (!status || lead.status === status) {
                // Only add if not already in direct leads (avoid duplicates)
                if (!seenLeadIds.has(lead.id)) {
                  applicationLinkedLeads.push(lead);
                  seenLeadIds.add(lead.id);
                }
              }
            }
          } catch (docError) {
            console.warn(
              `⚠️ Could not fetch lead ${leadId}: ${docError.message}`
            );
          }
        }
      }

      console.log(
        `📋 Found ${applicationLinkedLeads.length} additional leads from applications submitted by ${userEmail}`
      );

      // Step 6: Combine and sort all leads
      const allLeads = [...directLeads, ...applicationLinkedLeads];

      // Sort by the specified field and direction
      const validSortFields = [
        "createdAt",
        "updatedAt",
        "lastInteractionAt",
        "status",
      ];
      const sortField = validSortFields.includes(sortBy) ? sortBy : "createdAt";
      const sortDirection = sortOrder.toLowerCase() === "asc" ? "asc" : "desc";

      allLeads.sort((a, b) => {
        let valueA, valueB;

        if (sortField === "createdAt" || sortField === "updatedAt") {
          valueA =
            a[sortField] instanceof Date
              ? a[sortField]
              : new Date(a[sortField]);
          valueB =
            b[sortField] instanceof Date
              ? b[sortField]
              : new Date(b[sortField]);
        } else {
          valueA = a[sortField] || "";
          valueB = b[sortField] || "";
        }

        if (sortDirection === "desc") {
          return valueB > valueA ? 1 : valueB < valueA ? -1 : 0;
        } else {
          return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
        }
      });

      // Apply pagination after combining and sorting
      const startIndex = offset;
      const endIndex = offset + limit;
      const paginatedLeads = allLeads.slice(startIndex, endIndex);

      console.log(
        `✅ Total found: ${allLeads.length} leads, returning ${paginatedLeads.length} after pagination (sorted by ${sortField} ${sortDirection})`
      );

      return paginatedLeads;
    } catch (error) {
      console.error(
        `❌ Error fetching leads by submitter ${userEmail}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get leads for user (based on applications submitted by and updated by the user)
   * This method finds leads that are associated with applications that were either submitted by or updated by the user
   */
  async getLeadsForUser(userEmail, options = {}) {
    try {
      const {
        limit = 50,
        offset = 0,
        status,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = options;

      console.log(
        `🔍 Fetching leads for user: ${userEmail} (based on applications submitted by AND updated by)`
      );

      const allLeads = [];
      const seenLeadIds = new Set(); // To avoid duplicates
      const applicationUpdatedByMap = new Map(); // Track which apps were updated by user

      // Step 1: Get applications submitted by the user that have associated leadId
      console.log(`� Step 1: Finding applications submitted by ${userEmail}`);

      const submittedApplicationsQuery = this.db
        .collection("applications")
        .where("submittedBy.email", "==", userEmail)
        .where("leadId", "!=", null);

      const submittedApplicationsSnapshot =
        await submittedApplicationsQuery.get();

      submittedApplicationsSnapshot.forEach((doc) => {
        const appData = doc.data();
        if (appData.leadId) {
          // Track that this app was submitted by user
          if (!applicationUpdatedByMap.has(appData.leadId)) {
            applicationUpdatedByMap.set(appData.leadId, {
              submittedBy: appData.submittedBy,
              lastUpdatedBy: appData.lastUpdatedBy || appData.submittedBy,
              applicationId: doc.id,
            });
          }
        }
      });

      console.log(
        `📋 Found ${submittedApplicationsSnapshot.size} applications submitted by ${userEmail}`
      );

      // Step 2: Get applications updated by the user (lastUpdatedBy.email)
      console.log(`� Step 2: Finding applications updated by ${userEmail}`);

      const updatedApplicationsQuery = this.db
        .collection("applications")
        .where("lastUpdatedBy.email", "==", userEmail)
        .where("leadId", "!=", null);

      const updatedApplicationsSnapshot = await updatedApplicationsQuery.get();

      updatedApplicationsSnapshot.forEach((doc) => {
        const appData = doc.data();
        if (appData.leadId) {
          // Track that this app was updated by user
          applicationUpdatedByMap.set(appData.leadId, {
            submittedBy: appData.submittedBy,
            lastUpdatedBy: appData.lastUpdatedBy,
            applicationId: doc.id,
          });
        }
      });

      console.log(
        `📋 Found ${updatedApplicationsSnapshot.size} applications updated by ${userEmail}`
      );

      // Step 3: Get applications updated by the user in timeline
      console.log(
        `� Step 3: Finding applications with timeline updates by ${userEmail}`
      );

      try {
        const timelineApplicationsQuery = this.db
          .collection("applications")
          .where("leadId", "!=", null);

        const timelineApplicationsSnapshot =
          await timelineApplicationsQuery.get();
        let timelineMatchCount = 0;

        timelineApplicationsSnapshot.forEach((doc) => {
          const appData = doc.data();
          if (
            appData.leadId &&
            appData.timeline &&
            Array.isArray(appData.timeline)
          ) {
            // Check if this application's timeline contains updates by the user
            const hasUserUpdate = appData.timeline.some((entry) => {
              // Check if updatedBy matches user email
              if (
                entry.updatedBy &&
                typeof entry.updatedBy === "object" &&
                entry.updatedBy.email === userEmail
              ) {
                return true;
              }
              if (
                entry.updatedBy &&
                typeof entry.updatedBy === "string" &&
                entry.updatedBy === userEmail
              ) {
                return true;
              }
              return false;
            });

            if (hasUserUpdate) {
              // Track that this app was updated by user
              applicationUpdatedByMap.set(appData.leadId, {
                submittedBy: appData.submittedBy,
                lastUpdatedBy: appData.lastUpdatedBy,
                applicationId: doc.id,
              });
              timelineMatchCount++;
            }
          }
        });

        console.log(
          `📋 Found ${timelineMatchCount} applications with timeline updates by ${userEmail}`
        );
      } catch (error) {
        console.warn(
          `⚠️ Error searching application timeline updates:`,
          error.message
        );
      }

      // Step 4: Get the actual leads and attach application update information
      console.log(
        `📋 Step 4: Fetching ${applicationUpdatedByMap.size} leads and attaching application info`
      );

      for (const [leadId, appInfo] of applicationUpdatedByMap.entries()) {
        try {
          const leadDoc = await this.db
            .collection(this.collection)
            .doc(leadId)
            .get();

          if (leadDoc.exists) {
            const lead = this._normalizeLead(leadDoc.id, leadDoc.data());

            // Apply status filter if provided
            if (!status || lead.status === status) {
              // Only add if not already in leads (avoid duplicates)
              if (!seenLeadIds.has(lead.id)) {
                // Attach application update information to the lead
                lead.applicationUpdatedBy = appInfo.lastUpdatedBy;
                lead.applicationSubmittedBy = appInfo.submittedBy;
                lead.applicationId = appInfo.applicationId;

                allLeads.push(lead);
                seenLeadIds.add(lead.id);
              }
            }
          }
        } catch (docError) {
          console.warn(
            `⚠️ Could not fetch lead ${leadId}: ${docError.message}`
          );
        }
      }

      // Step 5: Sort all leads
      const validSortFields = [
        "createdAt",
        "updatedAt",
        "lastInteractionAt",
        "status",
      ];
      const sortField = validSortFields.includes(sortBy) ? sortBy : "createdAt";
      const sortDirection = sortOrder.toLowerCase() === "asc" ? "asc" : "desc";

      allLeads.sort((a, b) => {
        let valueA, valueB;

        if (sortField === "createdAt" || sortField === "updatedAt") {
          valueA =
            a[sortField] instanceof Date
              ? a[sortField]
              : new Date(a[sortField]);
          valueB =
            b[sortField] instanceof Date
              ? b[sortField]
              : new Date(b[sortField]);
        } else {
          valueA = a[sortField] || "";
          valueB = b[sortField] || "";
        }

        if (sortDirection === "desc") {
          return valueB > valueA ? 1 : valueB < valueA ? -1 : 0;
        } else {
          return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
        }
      });

      // Apply pagination after combining and sorting
      const startIndex = offset;
      const endIndex = offset + limit;
      const paginatedLeads = allLeads.slice(startIndex, endIndex);

      console.log(
        `✅ Total found: ${allLeads.length} leads for user ${userEmail}, returning ${paginatedLeads.length} after pagination (sorted by ${sortField} ${sortDirection})`
      );

      return paginatedLeads;
    } catch (error) {
      console.error(`❌ Error fetching leads for user ${userEmail}:`, error);
      throw error;
    }
  }

  /**
   * Get leads by email
   */
  async getLeadsByEmail(email) {
    try {
      console.log(`🔍 Searching for leads with email: ${email}`);

      const snapshot = await this.db
        .collection(this.collection)
        .where("email", "==", email.toLowerCase())
        .get();

      const leads = [];
      snapshot.forEach((doc) => {
        leads.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      console.log(`🔍 Found ${leads.length} leads with email: ${email}`);
      return leads;
    } catch (error) {
      console.error(`❌ Error fetching leads by email ${email}:`, error);
      throw error;
    }
  }

  /**
   * Get leads by phone number
   */
  async getLeadsByPhone(phone) {
    try {
      console.log(`🔍 Searching for leads with phone: ${phone}`);

      const snapshot = await this.db
        .collection(this.collection)
        .where("phone", "==", phone)
        .get();

      const leads = [];
      snapshot.forEach((doc) => {
        leads.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      console.log(`🔍 Found ${leads.length} leads with phone: ${phone}`);
      return leads;
    } catch (error) {
      console.error(`❌ Error fetching leads by phone ${phone}:`, error);
      throw error;
    }
  }

  /**
   * Cache management methods
   */

  /**
   * Invalidate leads cache by status
   */
  async invalidateLeadsCache(status = null) {
    try {
      if (status) {
        // Invalidate cache for specific status
        const pattern = `leads_by_status:${status}:*`;
        const keys = await this.cache.keys(pattern);
        for (const key of keys) {
          await this.cache.del(key);
        }
        console.log(
          `🗑️ Invalidated ${keys.length} cache entries for status: ${status}`
        );
      } else {
        // Invalidate all leads cache
        const patterns = [
          "leads_by_status:*",
          "conversion_leads:*",
          "lead_stats:*",
        ];

        let totalInvalidated = 0;
        for (const pattern of patterns) {
          const keys = await this.cache.keys(pattern);
          for (const key of keys) {
            await this.cache.del(key);
          }
          totalInvalidated += keys.length;
        }
        console.log(`🗑️ Invalidated ${totalInvalidated} leads cache entries`);
      }
    } catch (error) {
      console.error("❌ Error invalidating leads cache:", error);
    }
  }

  /**
   * Cache conversion leads data specifically for ConversionPlan
   */
  async cacheConversionLeads(data) {
    try {
      const cacheKey = "conversion_leads:contacted_and_interested";
      await this.cache.set(cacheKey, data, this.CACHE_TTL.CONVERSION_LEADS);
      console.log(`💾 Cached conversion leads data (${data.length} leads)`);
      return true;
    } catch (error) {
      console.error("❌ Error caching conversion leads:", error);
      return false;
    }
  }

  /**
   * Get cached conversion leads data
   */
  async getCachedConversionLeads() {
    try {
      const cacheKey = "conversion_leads:contacted_and_interested";
      const cachedData = await this.cache.get(cacheKey);
      if (cachedData) {
        console.log(
          `⚡ Retrieved ${cachedData.length} conversion leads from cache`
        );
      }
      return cachedData;
    } catch (error) {
      console.error("❌ Error getting cached conversion leads:", error);
      return null;
    }
  }

  /**
   * Override status update methods to invalidate cache
   */
  async updateLeadStatus(
    leadId,
    status,
    notes = "",
    updatedBy = "system",
    forceUpdate = false
  ) {
    // Delegate to core method and then invalidate cache
    const result = await this._updateLeadStatusCore(
      leadId,
      status,
      notes,
      updatedBy,
      forceUpdate
    );
    await this.invalidateLeadsCache();
    return result;
  }
}

module.exports = LeadService;
