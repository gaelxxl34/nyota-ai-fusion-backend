/**
 * Lead Service for Firestore Operations
 * Simple CRUD operations and status management
 */

const { LeadModel, QUALIFICATION_RULES } = require("../models/lead.model");
const { LEAD_STATUSES, LEAD_SOURCES } = require("../config/lead.constants");

// Auto-qualification config import removed as requested
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
      const convertedData = this._convertTimestamps(data);

      // Ensure timeline is an array or null/undefined
      if (convertedData.timeline && !Array.isArray(convertedData.timeline)) {
        console.error(
          `❌ Lead ${docId} has invalid timeline format. Converting to array.`
        );
        // If timeline exists but isn't an array, convert it or set to empty array
        convertedData.timeline = Array.isArray(convertedData.timeline)
          ? convertedData.timeline
          : [];
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
        console.log(
          `📊 Updating lead ${leadId} status: stored status=${
            lead.status
          }, timeline status=${LeadModel.getCurrentStatus(
            lead
          )}, new status=${newStatus}`
        );

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
   * Get leads by status
   */
  async getLeadsByStatus(status, limit = 50) {
    try {
      const snapshot = await this.db
        .collection(this.collection)
        .where("status", "==", status)
        .limit(limit)
        .get();

      const leads = snapshot.docs.map((doc) =>
        this._normalizeLead(doc.id, doc.data())
      );

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
      let leads = snapshot.docs.map((doc) =>
        this._normalizeLead(doc.id, doc.data())
      );

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
          // Auto-qualification removed as requested
        }
      }

      // If this is a human interaction from certain channels and lead is in INTERESTED status,
      // we can leave it as INTERESTED since user has already shown interest
      const isContactChannel = [
        "WHATSAPP",
        "EMAIL",
        "PHONE",
        "MEETING",
      ].includes(interaction.channel);
      const isIncomingHumanInteraction =
        interaction.direction === "incoming" && !interaction.automated;

      // No automatic status changes - let users manually progress leads through the funnel
      // INTERESTED → APPLIED → IN_REVIEW → QUALIFIED → ADMITTED → ENROLLED

      await this.db.collection(this.collection).doc(leadId).update(updateData);

      console.log(`✅ Interaction added to lead ${leadId}`);

      // Get updated lead data (auto-qualification removed as requested)
      const finalLead = await this.getLeadById(leadId);

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
   * Process auto-qualification after interaction (private method)
   * Auto-qualification has been disabled as requested
   */
  async _processAutoQualificationAfterInteraction(leadId) {
    // Simply return the lead data as auto-qualification has been disabled
    return await this.getLeadById(leadId);
  }

  /**
   * Check if lead is eligible for auto-qualification (private method)
   * Auto-qualification has been disabled as requested
   */
  async _checkAutoQualificationEligibility(leadData) {
    return { shouldQualify: false, reason: "Auto-qualification is disabled" };
  }

  /**
   * Execute the auto-qualification process (private method)
   * Auto-qualification has been disabled as requested
   */
  async _executeAutoQualification(leadId, qualificationResult) {
    console.log(`Auto-qualification has been disabled for lead ${leadId}`);
    return await this.getLeadById(leadId);
  }

  /**
   * Get auto-qualification configuration (private method)
   * Auto-qualification has been disabled as requested
   */
  _getAutoQualificationConfig() {
    return {
      targetStatus: "INTERESTED", // Default status for new leads
      systemUser: "SYSTEM",
      generateNotes: () => "Auto-qualification is disabled",
    };
  }

  /**
   * Notify about auto-qualification event (private method)
   * Auto-qualification has been disabled as requested
   */
  async _notifyAutoQualification(leadId, qualificationResult) {
    // Auto-qualification notification disabled
    console.log("Auto-qualification notifications disabled");
  }

  /**
   * Get leads submitted by a specific user (for "For You" tab)
   * This includes both direct lead submissions and leads associated with applications submitted by the user
   */
  async getLeadsBySubmitter(userEmail, options = {}) {
    try {
      const { limit = 50, offset = 0, status } = options;

      console.log(`🔍 Fetching leads submitted by: ${userEmail}`);

      // Step 1: Get leads directly submitted by the user
      let leadQuery = this.db
        .collection(this.collection)
        .where("submittedBy.email", "==", userEmail);

      // Add status filter if provided
      if (status) {
        leadQuery = leadQuery.where("status", "==", status);
      }

      // Order by creation date (newest first)
      leadQuery = leadQuery.orderBy("createdAt", "desc");

      const leadSnapshot = await leadQuery.get();
      const directLeads = [];
      leadSnapshot.forEach((doc) => {
        const lead = this._normalizeLead(doc.id, doc.data());
        directLeads.push(lead);
      });

      console.log(
        `📋 Found ${directLeads.length} direct leads submitted by ${userEmail}`
      );

      // Step 2: Get applications submitted by the user that have associated leadId
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

      // Step 3: Get leads associated with these applications
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
                // Only add if not already in direct leads
                const alreadyExists = directLeads.find(
                  (existingLead) => existingLead.id === lead.id
                );
                if (!alreadyExists) {
                  applicationLinkedLeads.push(lead);
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

      // Step 4: Combine and sort all leads
      const allLeads = [...directLeads, ...applicationLinkedLeads];

      // Sort by creation date (newest first)
      allLeads.sort((a, b) => {
        const dateA =
          a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
        const dateB =
          b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
        return dateB - dateA;
      });

      // Apply pagination after combining and sorting
      const startIndex = offset;
      const endIndex = offset + limit;
      const paginatedLeads = allLeads.slice(startIndex, endIndex);

      console.log(
        `✅ Total found: ${allLeads.length} leads, returning ${paginatedLeads.length} after pagination`
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
}

module.exports = LeadService;
