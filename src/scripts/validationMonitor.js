/**
 * Production-Ready Validation Monitor
 * Handles pending validations, retries, and monitoring
 */

const admin = require("firebase-admin");
const path = require("path");

// Initialize Firebase Admin
const serviceAccount = require(path.join(
  __dirname,
  "../../serviceAccountKey.json"
));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

class ValidationMonitor {
  constructor() {
    this.config = {
      pendingTimeout: 5 * 60 * 1000, // 5 minutes
      retryTimeout: 15 * 60 * 1000, // 15 minutes for retry
      maxRetries: 2,
      batchSize: 100,
    };

    this.stats = {
      processed: 0,
      timedOut: 0,
      retried: 0,
      errors: 0,
    };
  }

  /**
   * Main monitoring function
   */
  async monitor() {
    console.log("🔍 Starting WhatsApp validation monitor...");

    try {
      // Process pending validations
      await this.processPendingValidations();

      // Clean up old validations
      await this.cleanupOldValidations();

      // Generate report
      this.generateReport();
    } catch (error) {
      console.error("❌ Monitor error:", error);
      this.stats.errors++;
    }
  }

  /**
   * Process pending validations
   */
  async processPendingValidations() {
    const now = Date.now();

    // Get all pending validations
    const snapshot = await db
      .collection("leads")
      .where("whatsappValidationStatus", "==", "PENDING")
      .limit(this.config.batchSize)
      .get();

    if (snapshot.empty) {
      console.log("✅ No pending validations found");
      return;
    }

    console.log(`📋 Processing ${snapshot.size} pending validations...`);

    // Process in parallel with controlled concurrency
    const batch = db.batch();
    const updates = [];

    for (const doc of snapshot.docs) {
      const lead = doc.data();
      const leadId = doc.id;

      try {
        const update = await this.processLead(lead, leadId, now);
        if (update) {
          updates.push({ ref: doc.ref, data: update });
        }
        this.stats.processed++;
      } catch (error) {
        console.error(`❌ Error processing lead ${leadId}:`, error);
        this.stats.errors++;
      }
    }

    // Batch update all changes
    if (updates.length > 0) {
      for (const { ref, data } of updates) {
        batch.update(ref, data);
      }

      await batch.commit();
      console.log(`✅ Updated ${updates.length} leads`);
    }
  }

  /**
   * Process individual lead
   */
  async processLead(lead, leadId, now) {
    const createdAt = lead.createdAt?.toMillis() || 0;
    const timePending = now - createdAt;

    // Check if we have a validation record
    const validationRecord = await this.getValidationRecord(
      lead.whatsappValidationMessageId
    );

    if (validationRecord) {
      // Check if validation was completed elsewhere
      if (validationRecord.status === "delivered") {
        console.log(`✅ Lead ${leadId} validation confirmed via record`);
        return {
          whatsappValidationStatus: "VALID",
          whatsappValidated: true,
          whatsappValidationDate: admin.firestore.FieldValue.serverTimestamp(),
        };
      } else if (validationRecord.status === "failed") {
        console.log(`❌ Lead ${leadId} validation failed via record`);
        return {
          whatsappValidationStatus: "INVALID",
          whatsappValidated: false,
          whatsappValidationError:
            validationRecord.error || "Message delivery failed",
          whatsappValidationDate: admin.firestore.FieldValue.serverTimestamp(),
        };
      }
    }

    // Check timeout
    if (timePending > this.config.pendingTimeout) {
      console.log(
        `⏰ Lead ${leadId} validation timeout (${(timePending / 60000).toFixed(
          1
        )} minutes)`
      );

      // Check if we should retry
      const retryCount = lead.whatsappValidationRetries || 0;

      if (
        retryCount < this.config.maxRetries &&
        timePending < this.config.retryTimeout
      ) {
        // Mark for retry
        this.stats.retried++;
        return {
          whatsappValidationStatus: "RETRY_NEEDED",
          whatsappValidationRetries: retryCount + 1,
          whatsappValidationLastRetry:
            admin.firestore.FieldValue.serverTimestamp(),
        };
      } else {
        // Final timeout
        this.stats.timedOut++;
        return {
          whatsappValidationStatus: "TIMEOUT",
          whatsappValidated: false,
          whatsappValidationError:
            "Validation timeout - no delivery confirmation received",
          whatsappValidationDate: admin.firestore.FieldValue.serverTimestamp(),
        };
      }
    }

    // Still pending within timeout
    console.log(
      `⏳ Lead ${leadId} still pending (${(timePending / 60000).toFixed(
        1
      )} minutes)`
    );
    return null;
  }

  /**
   * Get validation record from separate collection
   */
  async getValidationRecord(messageId) {
    if (!messageId) return null;

    try {
      const snapshot = await db
        .collection("whatsapp_validations")
        .where("messageId", "==", messageId)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        return snapshot.docs[0].data();
      }
    } catch (error) {
      console.error("Error fetching validation record:", error);
    }

    return null;
  }

  /**
   * Clean up old validation records
   */
  async cleanupOldValidations() {
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days

    try {
      const snapshot = await db
        .collection("whatsapp_validations")
        .where("createdAt", "<", cutoffDate)
        .limit(500)
        .get();

      if (!snapshot.empty) {
        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();

        console.log(`🧹 Cleaned up ${snapshot.size} old validation records`);
      }
    } catch (error) {
      console.error("Error cleaning up old validations:", error);
    }
  }

  /**
   * Generate monitoring report
   */
  generateReport() {
    console.log("\n📊 Validation Monitor Report:");
    console.log(`   Processed: ${this.stats.processed}`);
    console.log(`   Timed Out: ${this.stats.timedOut}`);
    console.log(`   Retried: ${this.stats.retried}`);
    console.log(`   Errors: ${this.stats.errors}`);

    // Could send this to monitoring service
    if (this.stats.timedOut > 10 || this.stats.errors > 5) {
      console.warn("⚠️ High failure rate detected - investigation needed");
    }
  }

  /**
   * Get validation statistics
   */
  async getStatistics() {
    try {
      const [pending, valid, invalid, timeout] = await Promise.all([
        db
          .collection("leads")
          .where("whatsappValidationStatus", "==", "PENDING")
          .count()
          .get(),
        db
          .collection("leads")
          .where("whatsappValidationStatus", "==", "VALID")
          .count()
          .get(),
        db
          .collection("leads")
          .where("whatsappValidationStatus", "==", "INVALID")
          .count()
          .get(),
        db
          .collection("leads")
          .where("whatsappValidationStatus", "==", "TIMEOUT")
          .count()
          .get(),
      ]);

      return {
        pending: pending.data().count,
        valid: valid.data().count,
        invalid: invalid.data().count,
        timeout: timeout.data().count,
        successRate:
          (valid.data().count /
            (valid.data().count +
              invalid.data().count +
              timeout.data().count)) *
          100,
      };
    } catch (error) {
      console.error("Error getting statistics:", error);
      return null;
    }
  }
}

// Run the monitor
async function run() {
  const monitor = new ValidationMonitor();

  try {
    // Run monitoring
    await monitor.monitor();

    // Get and display statistics
    const stats = await monitor.getStatistics();
    if (stats) {
      console.log("\n📈 Overall Validation Statistics:");
      console.log(`   Pending: ${stats.pending}`);
      console.log(`   Valid: ${stats.valid}`);
      console.log(`   Invalid: ${stats.invalid}`);
      console.log(`   Timeout: ${stats.timeout}`);
      console.log(`   Success Rate: ${stats.successRate.toFixed(2)}%`);
    }
  } catch (error) {
    console.error("❌ Fatal error:", error);
  } finally {
    // Close the app
    await admin.app().delete();
  }
}

// Export for use in cron jobs
module.exports = { ValidationMonitor };

// Run if called directly
if (require.main === module) {
  run();
}
