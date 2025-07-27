/**
 * Validation Queue Service
 * Manages pending validations before lead creation
 */

const admin = require("firebase-admin");

class ValidationQueueService {
  constructor() {
    this.db = admin.firestore();
    this.collectionName = "whatsapp_validation_queue";
  }

  /**
   * Create a validation queue entry
   */
  async createValidationEntry(formData, validationResult) {
    try {
      const entry = {
        // Form data
        firstName: formData.firstName,
        lastName: formData.lastName,
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        message: formData.message,
        source: formData.source || "WEBSITE",

        // Validation data
        validatedPhone: validationResult.normalizedNumber,
        validationMessageId: validationResult.messageId,
        validationStatus: "PENDING",
        validationType: validationResult.validationType,

        // Timestamps
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes

        // Flags
        leadCreated: false,
        processed: false,
      };

      const docRef = await this.db.collection(this.collectionName).add(entry);
      console.log(`📝 Created validation queue entry: ${docRef.id}`);

      return {
        id: docRef.id,
        ...entry,
      };
    } catch (error) {
      console.error("❌ Error creating validation entry:", error);
      throw error;
    }
  }

  /**
   * Update validation status based on WhatsApp delivery status
   */
  async updateValidationStatus(
    phoneNumber,
    messageId,
    status,
    errorCode = null
  ) {
    try {
      // Normalize phone number to handle different formats
      const normalizedPhone = phoneNumber.replace(/^\+/, "").replace(/\D/g, "");

      // Find the validation entry by message ID first
      let snapshot = await this.db
        .collection(this.collectionName)
        .where("validationMessageId", "==", messageId)
        .limit(1)
        .get();

      if (snapshot.empty) {
        // Try finding by both message ID and phone number
        snapshot = await this.db
          .collection(this.collectionName)
          .where("validationMessageId", "==", messageId)
          .where("validatedPhone", "==", normalizedPhone)
          .limit(1)
          .get();
      }

      if (snapshot.empty) {
        console.log(
          `⚠️ No validation entry found for message ${messageId} and phone ${normalizedPhone}`
        );
        return null;
      }

      const doc = snapshot.docs[0];
      const updateData = {
        validationStatus: status,
        validationUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (status === "FAILED" && errorCode) {
        // Handle specific error codes with user-friendly messages
        let errorMessage = "";
        switch (errorCode) {
          case 131026:
            errorMessage =
              "This phone number is not registered on WhatsApp. Please provide a valid WhatsApp number.";
            break;
          case 131047:
            errorMessage =
              "This WhatsApp number exists but cannot receive messages at this time. Please ensure the number is active.";
            break;
          case 131051:
            errorMessage =
              "Invalid phone number format. Please check the number and try again.";
            break;
          case 131052:
            errorMessage = "Phone number not registered on WhatsApp.";
            break;
          default:
            errorMessage = `WhatsApp validation failed (Error ${errorCode}). Please check your phone number.`;
        }

        updateData.validationError = errorMessage;
        updateData.validationErrorCode = errorCode;
      }

      await doc.ref.update(updateData);
      console.log(
        `✅ Updated validation status to ${status} for entry ${doc.id}`
      );

      // If validation succeeded, trigger lead creation
      if (status === "VALID" && !doc.data().leadCreated) {
        await this.createLeadFromValidation(doc.id);
      }

      return { id: doc.id, ...doc.data(), ...updateData };
    } catch (error) {
      console.error("❌ Error updating validation status:", error);
      throw error;
    }
  }

  /**
   * Create lead from validated entry
   */
  async createLeadFromValidation(validationId) {
    try {
      const doc = await this.db
        .collection(this.collectionName)
        .doc(validationId)
        .get();

      if (!doc.exists) {
        throw new Error("Validation entry not found");
      }

      const validation = doc.data();

      // Check if already processed
      if (validation.leadCreated) {
        console.log(`⚠️ Lead already created for validation ${validationId}`);
        return validation.leadId;
      }

      // Only create lead if validation is successful
      if (validation.validationStatus !== "VALID") {
        console.log(
          `⚠️ Cannot create lead - validation status is ${validation.validationStatus}`
        );
        return null;
      }

      // Create the lead
      const LeadService = require("./leadService");
      const leadService = new LeadService(this.db);

      const leadData = {
        firstName: validation.firstName,
        lastName: validation.lastName,
        name: validation.name,
        email: validation.email,
        phone: validation.validatedPhone,
        message: validation.message,
        status: "INQUIRY",
        whatsappValidated: true,
        whatsappValidationStatus: "VALID",
        whatsappValidationDate: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const leadResult = await leadService.createLead(
        leadData,
        validation.source
      );

      // Update validation entry
      await doc.ref.update({
        leadCreated: true,
        leadId: leadResult.id,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(
        `✅ Lead ${leadResult.id} created from validation ${validationId}`
      );

      // Send welcome message after lead creation
      const whatsappMessageService = require("./whatsappMessageService");
      const welcomeMessage = `Hello ${validation.name}! 👋\n\nThank you for your interest in IUEA! 🎓\n\nYour WhatsApp number has been verified and your inquiry has been received. Our admissions team will contact you soon.\n\nBest regards,\nIUEA Admissions Team`;

      await whatsappMessageService.sendMessage(
        validation.validatedPhone,
        welcomeMessage,
        "text",
        {
          source: "validation_success",
          leadId: leadResult.id,
          messageType: "welcome",
        }
      );

      return leadResult.id;
    } catch (error) {
      console.error("❌ Error creating lead from validation:", error);
      throw error;
    }
  }

  /**
   * Check validation status by phone
   */
  async checkValidationStatus(phone) {
    try {
      const snapshot = await this.db
        .collection(this.collectionName)
        .where("phone", "==", phone)
        .where("processed", "==", false)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get()
        .catch((error) => {
          if (
            error.code === 9 &&
            error.details?.includes("requires an index")
          ) {
            console.warn(
              "⚠️ Firestore index not yet created for validation status query. Please create the index using the link in the error message."
            );
            return { empty: true };
          }
          throw error;
        });

      if (snapshot.empty) {
        return null;
      }

      const doc = snapshot.docs[0];
      const data = doc.data();

      return {
        id: doc.id,
        status: data.validationStatus,
        leadCreated: data.leadCreated,
        leadId: data.leadId,
        error: data.validationError,
      };
    } catch (error) {
      console.error("❌ Error checking validation status:", error);
      throw error;
    }
  }

  /**
   * Process timeout for pending validations
   */
  async processTimeouts() {
    try {
      const now = new Date();
      const timeoutThreshold = new Date(now.getTime() - 30 * 1000); // 30 seconds timeout

      const snapshot = await this.db
        .collection(this.collectionName)
        .where("validationStatus", "==", "PENDING")
        .where("createdAt", "<=", timeoutThreshold)
        .get()
        .catch((error) => {
          if (
            error.code === 9 &&
            error.details?.includes("requires an index")
          ) {
            console.warn(
              "⚠️ Firestore index not yet created for validation timeout query. Please create the index using the link in the error message."
            );
            return { empty: true, docs: [] };
          }
          throw error;
        });

      const batch = this.db.batch();
      let timeoutCount = 0;

      snapshot.forEach((doc) => {
        batch.update(doc.ref, {
          validationStatus: "TIMEOUT",
          validationError:
            "WhatsApp validation timed out. The number may not be on WhatsApp or is unreachable.",
          validationUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        timeoutCount++;
      });

      if (timeoutCount > 0) {
        await batch.commit();
        console.log(`⏱️ Timed out ${timeoutCount} pending validations`);
      }

      return timeoutCount;
    } catch (error) {
      console.error("❌ Error processing validation timeouts:", error);
      throw error;
    }
  }

  /**
   * Clean up expired entries
   */
  async cleanupExpiredEntries() {
    try {
      // First process timeouts
      await this.processTimeouts();

      const now = new Date();
      const snapshot = await this.db
        .collection(this.collectionName)
        .where("expiresAt", "<", now)
        .where("processed", "==", false)
        .limit(100)
        .get();

      if (snapshot.empty) {
        return 0;
      }

      const batch = this.db.batch();
      snapshot.docs.forEach((doc) => {
        batch.update(doc.ref, {
          processed: true,
          validationStatus: "TIMEOUT",
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      await batch.commit();
      console.log(`🧹 Cleaned up ${snapshot.size} expired validation entries`);

      return snapshot.size;
    } catch (error) {
      console.error("❌ Error cleaning up expired entries:", error);
      throw error;
    }
  }
}

module.exports = new ValidationQueueService();
