/**
 * Optimized Bulk User Deletion Service
 * Uses parallel processing and batching for performance
 */

class BulkUserDeletionService {
  constructor(db, admin) {
    this.db = db;
    this.admin = admin;
    this.concurrencyLimit = 5; // Process 5 users simultaneously
    this.chunkSize = 10; // Process 10 leads/apps at a time within each user
  }

  /**
   * Delete a single user with all associated data (optimized)
   */
  async deleteUserWithData(userId) {
    try {
      const userRef = this.db.collection("users").doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        return {
          success: false,
          userId,
          error: "User not found",
        };
      }

      const userData = userDoc.data();
      const userEmail = userData.email;

      console.log(
        `🗑️ Processing user ${userId} (${
          userData.name || "Unknown"
        } - ${userEmail})`
      );

      const cleanupResults = {
        leads: 0,
        applications: 0,
        conversations: 0,
        messages: 0,
        storageFiles: 0,
        errors: [],
      };

      // PARALLEL QUERY: Fetch all data that needs to be deleted at once
      const [
        leadsSnapshot,
        applicationsSnapshot,
        assignedLeadsSnapshot,
        assignedAppsSnapshot,
      ] = await Promise.all([
        this.db
          .collection("leads")
          .where("submittedBy.email", "==", userEmail)
          .get(),
        this.db
          .collection("applications")
          .where("submittedBy.email", "==", userEmail)
          .get(),
        this.db.collection("leads").where("assignedTo", "==", userId).get(),
        this.db
          .collection("applications")
          .where("assignedTo", "==", userId)
          .get(),
      ]);

      // Load services
      const LeadService = require("./leadService");
      const ApplicationService = require("./applicationService");
      const StorageService = require("./storageService");

      const leadService = new LeadService(this.db);
      const storageService = new StorageService();
      const applicationService = new ApplicationService(
        this.db,
        null,
        null,
        storageService
      );

      // PARALLEL LEAD DELETION (in chunks to avoid overwhelming system)
      if (!leadsSnapshot.empty) {
        const leadDocs = leadsSnapshot.docs;
        for (let i = 0; i < leadDocs.length; i += this.chunkSize) {
          const chunk = leadDocs.slice(i, i + this.chunkSize);
          const chunkResults = await Promise.all(
            chunk.map(async (leadDoc) => {
              try {
                const deleteResult = await leadService.deleteLead(leadDoc.id);
                return {
                  success: true,
                  conversations:
                    deleteResult.cleanupResults?.conversations || 0,
                  messages: deleteResult.cleanupResults?.messages || 0,
                  applications: deleteResult.cleanupResults?.applications || 0,
                  storageFiles: deleteResult.cleanupResults?.storageFiles || 0,
                };
              } catch (error) {
                console.error(`❌ Failed to delete lead ${leadDoc.id}:`, error);
                return { success: false, error: error.message };
              }
            })
          );

          chunkResults.forEach((result) => {
            if (result.success) {
              cleanupResults.leads += 1;
              cleanupResults.conversations += result.conversations;
              cleanupResults.messages += result.messages;
              cleanupResults.applications += result.applications;
              cleanupResults.storageFiles += result.storageFiles;
            } else {
              cleanupResults.errors.push(
                `Lead deletion failed: ${result.error}`
              );
            }
          });
        }
      }

      // PARALLEL APPLICATION DELETION (in chunks)
      if (!applicationsSnapshot.empty) {
        const appDocs = applicationsSnapshot.docs;
        for (let i = 0; i < appDocs.length; i += this.chunkSize) {
          const chunk = appDocs.slice(i, i + this.chunkSize);
          const chunkResults = await Promise.all(
            chunk.map(async (appDoc) => {
              try {
                const storageCleanupResult =
                  await applicationService.deleteAllApplicationDocuments(
                    appDoc.id
                  );
                await appDoc.ref.delete();
                return {
                  success: true,
                  storageFiles: storageCleanupResult.success
                    ? storageCleanupResult.deletedCount
                    : 0,
                };
              } catch (error) {
                console.error(
                  `❌ Failed to delete application ${appDoc.id}:`,
                  error
                );
                return { success: false, error: error.message };
              }
            })
          );

          chunkResults.forEach((result) => {
            if (result.success) {
              cleanupResults.applications += 1;
              cleanupResults.storageFiles += result.storageFiles;
            } else {
              cleanupResults.errors.push(
                `Application deletion failed: ${result.error}`
              );
            }
          });
        }
      }

      // BATCH UPDATE: Remove user assignments (optimized with batching)
      const updateBatches = [];
      let currentBatch = this.db.batch();
      let operationCount = 0;

      // Update assigned leads
      assignedLeadsSnapshot.docs.forEach((doc) => {
        currentBatch.update(doc.ref, {
          assignedTo: null,
          updatedAt: this.admin.firestore.FieldValue.serverTimestamp(),
        });
        operationCount++;

        if (operationCount >= 500) {
          // Firestore batch limit
          updateBatches.push(currentBatch);
          currentBatch = this.db.batch();
          operationCount = 0;
        }
      });

      // Update assigned applications
      assignedAppsSnapshot.docs.forEach((doc) => {
        currentBatch.update(doc.ref, {
          assignedTo: null,
          updatedAt: this.admin.firestore.FieldValue.serverTimestamp(),
        });
        operationCount++;

        if (operationCount >= 500) {
          updateBatches.push(currentBatch);
          currentBatch = this.db.batch();
          operationCount = 0;
        }
      });

      if (operationCount > 0) {
        updateBatches.push(currentBatch);
      }

      // Commit all batches in parallel
      if (updateBatches.length > 0) {
        await Promise.all(updateBatches.map((batch) => batch.commit()));
      }

      // PARALLEL: Delete user document and Firebase Auth
      await Promise.all([
        userRef.delete(),
        this.admin
          .auth()
          .deleteUser(userId)
          .catch((error) => {
            console.error("❌ Error deleting user from Auth:", error);
            cleanupResults.errors.push(
              `Auth deletion failed: ${error.message}`
            );
          }),
      ]);

      console.log(
        `✅ User ${userId} deleted (Leads: ${cleanupResults.leads}, Apps: ${cleanupResults.applications})`
      );

      return {
        success: true,
        userId,
        cleanupResults,
      };
    } catch (error) {
      console.error(`❌ Error deleting user ${userId}:`, error);
      return {
        success: false,
        userId,
        error: error.message,
      };
    }
  }

  /**
   * Delete multiple users in parallel with concurrency control
   */
  async bulkDeleteUsers(userIds, currentUserId) {
    const results = {
      totalRequested: userIds.length,
      succeeded: 0,
      failed: 0,
      errors: [],
      cleanupSummary: {
        totalLeads: 0,
        totalApplications: 0,
        totalConversations: 0,
        totalMessages: 0,
        totalStorageFiles: 0,
      },
    };

    console.log(
      `🗑️ Starting optimized bulk deletion of ${userIds.length} users`
    );
    console.log(
      `⚡ Concurrency limit: ${this.concurrencyLimit} users at a time`
    );
    console.log(
      `📦 Chunk size: ${this.chunkSize} leads/apps per batch within each user`
    );

    // Filter out current user (safety check)
    const safeUserIds = userIds.filter((id) => id !== currentUserId);
    if (safeUserIds.length !== userIds.length) {
      console.log(
        `⚠️ Filtered out ${
          userIds.length - safeUserIds.length
        } user(s) (self-deletion prevented)`
      );
    }

    const startTime = Date.now();

    // Process users in parallel with concurrency limit
    const userDeletionResults = [];
    for (let i = 0; i < safeUserIds.length; i += this.concurrencyLimit) {
      const batch = safeUserIds.slice(i, i + this.concurrencyLimit);
      const batchStartTime = Date.now();

      const batchResults = await Promise.all(
        batch.map((userId) => this.deleteUserWithData(userId))
      );

      userDeletionResults.push(...batchResults);

      const batchTime = ((Date.now() - batchStartTime) / 1000).toFixed(2);
      const progress = Math.min(i + this.concurrencyLimit, safeUserIds.length);
      const percentComplete = ((progress / safeUserIds.length) * 100).toFixed(
        1
      );
      const estimatedTimeRemaining = (
        (((Date.now() - startTime) / progress) *
          (safeUserIds.length - progress)) /
        1000
      ).toFixed(0);

      console.log(
        `📊 Progress: ${progress}/${safeUserIds.length} users (${percentComplete}%) | Batch time: ${batchTime}s | ETA: ~${estimatedTimeRemaining}s`
      );
    }

    // Aggregate results
    userDeletionResults.forEach((result) => {
      if (result.success) {
        results.succeeded++;
        if (result.cleanupResults) {
          results.cleanupSummary.totalLeads += result.cleanupResults.leads;
          results.cleanupSummary.totalApplications +=
            result.cleanupResults.applications;
          results.cleanupSummary.totalConversations +=
            result.cleanupResults.conversations;
          results.cleanupSummary.totalMessages +=
            result.cleanupResults.messages;
          results.cleanupSummary.totalStorageFiles +=
            result.cleanupResults.storageFiles;
        }
      } else {
        results.failed++;
        results.errors.push({
          userId: result.userId,
          error: result.error,
        });
      }
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const avgTimePerUser = (totalTime / safeUserIds.length).toFixed(2);

    console.log(`✅ Bulk deletion completed in ${totalTime}s`);
    console.log(`   Average time per user: ${avgTimePerUser}s`);
    console.log(`   Total requested: ${results.totalRequested}`);
    console.log(`   Succeeded: ${results.succeeded}`);
    console.log(`   Failed: ${results.failed}`);
    console.log(`   Total leads deleted: ${results.cleanupSummary.totalLeads}`);
    console.log(
      `   Total applications deleted: ${results.cleanupSummary.totalApplications}`
    );

    return results;
  }
}

module.exports = BulkUserDeletionService;
