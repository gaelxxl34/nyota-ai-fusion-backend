/**
 * Application Service for Firestore Operations
 * Handles application submissions, lead integration, and WhatsApp messaging
 */

const {
  ApplicationModel,
  APPLICATION_STATUSES,
  PROGRAMS,
} = require("../models/application.model");

const { LEAD_STATUSES } = require("../config/lead.constants");

class ApplicationService {
  constructor(firestore, leadService, whatsappMessageService, storageService) {
    this.db = firestore;
    this.leadService = leadService;
    this.whatsappService = whatsappMessageService;
    this.collection = "applications";
    this.storageService = storageService;
    this.storageBasePath = "applications"; // Base path for application files in storage

    if (!this.storageService) {
      throw new Error("StorageService is required for ApplicationService");
    }
  }

  /**
   * Delete old document from Firebase Storage when updating
   * This ensures we don't accumulate old files and waste storage space
   * @param {string} applicationId - Application ID
   * @param {string} documentType - Document type (passportPhoto, academicDocuments, identificationDocument)
   */
  async deleteOldDocument(applicationId, documentType) {
    try {
      // Get current application data to find existing document URL
      const application = await this.getApplicationById(applicationId);

      if (!application) {
        console.log(
          `⚠️ Application ${applicationId} not found, skipping old document deletion`
        );
        return;
      }

      const existingUrl = application[documentType];

      if (!existingUrl || existingUrl === "" || existingUrl === null) {
        console.log(
          `ℹ️ No existing ${documentType} found for application ${applicationId}`
        );
        return;
      }

      // Skip base64 data (legacy data that doesn't need storage cleanup)
      if (typeof existingUrl === "string" && existingUrl.startsWith("data:")) {
        console.log(
          `ℹ️ Existing ${documentType} is base64 data, no storage cleanup needed`
        );
        return;
      }

      // Handle Firebase Storage URLs
      if (
        typeof existingUrl === "string" &&
        (existingUrl.includes("storage.googleapis.com") ||
          existingUrl.includes("firebasestorage.googleapis.com"))
      ) {
        try {
          // Extract storage path from different possible Firebase Storage URL formats
          let storagePath = null;

          // Format 1: https://storage.googleapis.com/{bucket}/{path}
          if (existingUrl.includes("storage.googleapis.com")) {
            const urlParts = existingUrl.split("storage.googleapis.com/")[1];
            if (urlParts) {
              // Remove bucket name to get the file path
              storagePath = urlParts.split("/").slice(1).join("/");
            }
          }
          // Format 2: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?alt=media&token={token}
          else if (existingUrl.includes("firebasestorage.googleapis.com")) {
            const urlParts = existingUrl.split("/o/")[1]?.split("?")[0];
            if (urlParts) {
              storagePath = decodeURIComponent(urlParts);
            }
          }

          if (!storagePath) {
            console.warn(
              `⚠️ Could not parse storage path from URL: ${existingUrl}`
            );
            return;
          }

          console.log(
            `🗑️ Deleting old ${documentType} from path: ${storagePath}`
          );

          // Delete the old file from Firebase Storage
          await this.storageService.deleteFile(storagePath);
          console.log(`✅ Successfully deleted old ${documentType}`);
        } catch (parseError) {
          console.warn(
            `⚠️ Error parsing or deleting ${documentType} from storage:`,
            parseError
          );
          return;
        }
      }

      console.log(
        `✅ Old ${documentType} cleanup completed for application ${applicationId}`
      );
    } catch (error) {
      // Don't throw error if old file deletion fails - proceed with new upload
      if (error && error.code === 404) {
        console.log(
          `ℹ️ Old ${documentType} file not found in storage (may have been deleted already)`
        );
      } else {
        console.warn(`⚠️ Failed to delete old ${documentType}:`, error);
      }
    }
  }

  /**
   * Upload a file to Firebase Storage and get public URL
   * @param {string|Object} file - File path or buffer or base64 string
   * @param {string} storagePath - Storage path
   * @returns {Promise<string>} - Public download URL
   */
  /**
   * Upload a file directly to Firebase Storage (like student portal)
   * @param {Object} file - File object from express-fileupload
   * @param {string} storagePath - Firebase Storage path
   * @returns {Promise<string>} - Public download URL
   */
  async uploadFile(file, storagePath) {
    try {
      console.log("📤 Uploading file directly to Firebase Storage...", {
        storagePath,
        hasFile: !!file,
        fileSize: file?.size,
        fileName: file?.name,
        mimeType: file?.mimetype,
        fileType: typeof file,
        isBuffer: Buffer.isBuffer(file),
        hasNumericKeys:
          file &&
          typeof file === "object" &&
          Object.keys(file).every((key) => !isNaN(key)),
      });

      // Handle file object from express-fileupload
      if (file && file.data && file.data.length > 0) {
        // Direct upload using storageService with file buffer
        const mimeType = file.mimetype || "application/octet-stream";
        const publicUrl = await this.storageService.storeFile(
          file.data, // Buffer from express-fileupload
          storagePath,
          mimeType
        );
        console.log(`✅ File uploaded successfully: ${publicUrl}`);
        return publicUrl;
      }

      // Handle file object with temp file path
      if (file && file.tempFilePath) {
        console.log(`📁 Reading file from temp path: ${file.tempFilePath}`);
        const fs = require("fs");
        const fileData = fs.readFileSync(file.tempFilePath);
        const mimeType =
          file.mimetype || this._getMimeTypeFromFileName(file.name);

        const publicUrl = await this.storageService.storeFile(
          fileData,
          storagePath,
          mimeType
        );

        // Clean up temp file
        try {
          fs.unlinkSync(file.tempFilePath);
          console.log(`🗑️ Cleaned up temp file: ${file.tempFilePath}`);
        } catch (cleanupError) {
          console.warn(
            `⚠️ Failed to cleanup temp file: ${cleanupError.message}`
          );
        }

        console.log(`✅ File uploaded successfully: ${publicUrl}`);
        return publicUrl;
      }

      // Handle direct buffer
      if (Buffer.isBuffer(file)) {
        const publicUrl = await this.storageService.storeFile(
          file,
          storagePath,
          "application/octet-stream"
        );
        console.log(`✅ Buffer uploaded successfully: ${publicUrl}`);
        return publicUrl;
      }

      // Handle buffer-like object with numeric keys (from frontend)
      if (
        file &&
        typeof file === "object" &&
        !file.data &&
        !file.tempFilePath &&
        Object.keys(file).length > 0 &&
        Object.keys(file).every((key) => !isNaN(key) && key !== "length")
      ) {
        console.log("🔄 Converting numeric-keyed object to buffer...");
        // Convert object with numeric keys to Buffer
        const keys = Object.keys(file)
          .map(Number)
          .sort((a, b) => a - b);
        const bufferArray = keys.map((key) => file[key]);
        const buffer = Buffer.from(bufferArray);

        const publicUrl = await this.storageService.storeFile(
          buffer,
          storagePath,
          "application/octet-stream"
        );
        console.log(`✅ Converted object uploaded successfully: ${publicUrl}`);
        return publicUrl;
      }

      // Handle base64 data strings
      if (typeof file === "string" && file.startsWith("data:")) {
        console.log("🔄 Converting base64 data to buffer...");
        const [header, data] = file.split(",");
        const mimeType = header.split(":")[1].split(";")[0];
        const buffer = Buffer.from(data, "base64");

        const publicUrl = await this.storageService.storeFile(
          buffer,
          storagePath,
          mimeType
        );
        console.log(`✅ Base64 data uploaded successfully: ${publicUrl}`);
        return publicUrl;
      }

      console.error("❌ Unsupported file format. File object:", {
        hasData: !!file?.data,
        hasTempFilePath: !!file?.tempFilePath,
        hasName: !!file?.name,
        hasSize: !!file?.size,
        isBuffer: Buffer.isBuffer(file),
        type: typeof file,
        keys: file ? Object.keys(file).slice(0, 10) : [], // Only show first 10 keys
        totalKeys: file ? Object.keys(file).length : 0,
      });
      throw new Error(
        "Unsupported file format - expected express-fileupload file object, Buffer, or base64 string"
      );
    } catch (error) {
      console.error("❌ Error uploading file to Firebase Storage:", error);
      throw error;
    }
  }

  /**
   * Upload application document to Firebase Storage and get public URL
   * Automatically deletes previous document to save storage space
   * @param {string} applicationId - Application ID
   * @param {string} documentType - Document type (passportPhoto, academicDocuments, identificationDocument)
   * @param {string|Object} fileData - File data (base64 string or file object)
   * @returns {Promise<string>} - Public download URL from Firebase Storage
   */
  /**
   * Generate a unique application ID
   * @returns {string} - Unique application ID
   */
  generateApplicationId() {
    return `app_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Upload a single document to Firebase Storage and return its public URL
   * Following student portal pattern with proper file naming
   * @param {string} applicationId - Application ID for organizing files
   * @param {string} documentType - Type of document (passportPhoto, academicDocuments, identificationDocument)
   * @param {Object} fileData - File object from express-fileupload
   * @param {string} userEmail - User email for file naming (optional)
   * @returns {Promise<string>} - Public URL of uploaded document
   */
  async uploadApplicationDocument(
    applicationId,
    documentType,
    fileData,
    userEmail = "webadmin_iuea_ac_ug"
  ) {
    // Check if documentType is valid
    const validDocumentTypes = [
      "passportPhoto",
      "academicDocuments",
      "identificationDocument",
      "idDocument",
    ];

    if (!validDocumentTypes.includes(documentType)) {
      throw new Error(
        `Invalid document type: ${documentType}. Valid types are: ${validDocumentTypes.join(
          ", "
        )}`
      );
    }

    console.log(
      `📤 Uploading ${documentType} to Firebase Storage for application ${applicationId}...`
    );

    // 1. Delete old document first to save storage space (like student portal)
    await this.deleteOldDocument(applicationId, documentType);

    // 2. Validate file data
    if (!fileData) {
      throw new Error("No file data provided for document upload");
    }

    // File size validation (max 10MB like student portal)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (fileData.size && fileData.size > maxSize) {
      throw new Error(
        `File size must be less than 10MB. Current size: ${Math.round(
          fileData.size / (1024 * 1024)
        )}MB`
      );
    }

    // File type validation
    const allowedTypes = {
      passportPhoto: ["image/jpeg", "image/jpg", "image/png"],
      academicDocuments: [
        "application/pdf",
        "image/jpeg",
        "image/jpg",
        "image/png",
      ],
      identificationDocument: [
        "application/pdf",
        "image/jpeg",
        "image/jpg",
        "image/png",
      ],
      idDocument: ["application/pdf", "image/jpeg", "image/jpg", "image/png"],
    };

    // Check file type
    if (fileData && fileData.mimetype) {
      const mimeType = fileData.mimetype;
      if (!allowedTypes[documentType].includes(mimeType)) {
        throw new Error(
          `Invalid file type for ${documentType}. Allowed: ${allowedTypes[
            documentType
          ].join(", ")}. Received: ${mimeType}`
        );
      }
    }
    // Check file type by file extension if no MIME type available
    else if (fileData && fileData.name) {
      const extension = fileData.name.split(".").pop().toLowerCase();
      const extensionMimeMap = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        pdf: "application/pdf",
      };
      const inferredMimeType = extensionMimeMap[extension];
      if (
        inferredMimeType &&
        !allowedTypes[documentType].includes(inferredMimeType)
      ) {
        throw new Error(
          `Invalid file type for ${documentType}. Allowed: ${allowedTypes[
            documentType
          ].join(", ")}. File extension: .${extension}`
        );
      }
    }

    // 3. Generate filename following student portal pattern
    // Example: academicDocuments_app_1754992394106_oo61a43dg_webadmin_iuea_ac_ug_1754992397058.pdf
    const timestamp = Date.now();
    const fileExtension = this._getFileExtension(fileData);
    const sanitizedEmail = userEmail.replace(/[^a-zA-Z0-9]/g, "_");
    const fileName = `${documentType}_${applicationId}_${sanitizedEmail}_${timestamp}.${fileExtension}`;
    const storagePath = `${this.storageBasePath}/${applicationId}/documents/${fileName}`;

    console.log(`📁 Storage path: ${storagePath}`);
    console.log(`📄 Generated filename: ${fileName}`);

    // 4. Upload to Firebase Storage
    try {
      const publicUrl = await this.uploadFile(fileData, storagePath);
      console.log(
        `✅ ${documentType} uploaded successfully to Firebase Storage: ${publicUrl}`
      );
      return publicUrl;
    } catch (error) {
      console.error(
        `❌ Error uploading ${documentType} to Firebase Storage:`,
        error
      );
      throw error;
    }
  }

  /**
   * Delete all documents for an application (useful when deleting entire application)
   * @param {string} applicationId - Application ID
   * @returns {Promise<Object>} - Cleanup result with success status and count
   */
  async deleteAllApplicationDocuments(applicationId) {
    const documentTypes = [
      "passportPhoto",
      "academicDocuments",
      "identificationDocument",
    ];
    let deletedCount = 0;

    console.log(
      `🗑️ Cleaning up all documents for application ${applicationId}`
    );

    for (const docType of documentTypes) {
      try {
        await this.deleteOldDocument(applicationId, docType);
        deletedCount++;
      } catch (error) {
        console.warn(
          `⚠️ Failed to delete ${docType} for application ${applicationId}:`,
          error
        );
      }
    }

    console.log(
      `✅ Cleaned up ${deletedCount}/${documentTypes.length} document types for application ${applicationId}`
    );

    return {
      success: deletedCount > 0,
      deletedCount,
    };
  }

  /**
   * Get file extension from file data
   * @private
   * @param {string|Object} fileData - File data
   * @returns {string} - File extension
   */
  _getFileExtension(fileData) {
    // For base64 data, extract from MIME type
    if (typeof fileData === "string" && fileData.startsWith("data:")) {
      const mimeType = fileData.split(";")[0].split(":")[1];
      const extensionMap = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "application/pdf": "pdf",
        "application/msword": "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
          "docx",
      };
      return extensionMap[mimeType] || "unknown";
    }

    // For file objects
    if (fileData && fileData.name) {
      return fileData.name.split(".").pop().toLowerCase();
    }

    return "unknown";
  }

  /**
   * Get MIME type from file name
   * @private
   * @param {string} fileName - File name
   * @returns {string} - MIME type
   */
  _getMimeTypeFromFileName(fileName) {
    const extension = fileName.split(".").pop().toLowerCase();
    const mimeTypes = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };

    return mimeTypes[extension] || "application/octet-stream";
  }

  /**
   * Submit a new application
   * This is the main method that handles the complete application flow
   */
  async submitApplication(applicationData) {
    try {
      // 1. Validate application data
      const validation = ApplicationModel.validate(applicationData);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
      }

      // 2. Create application document
      const applicationDoc =
        ApplicationModel.createApplication(applicationData);

      // Add formatted program name for better display
      if (applicationData.preferredProgram) {
        applicationDoc.programName = this._getProgramName(
          applicationData.preferredProgram
        );
      }

      console.log(`📋 Creating application for ${applicationData.name}...`);

      // If submittedBy info is provided, add it to the application document
      if (applicationData.submittedBy) {
        // Fetch proper user name from database if available
        let userName = applicationData.submittedBy.name;

        if (!userName && applicationData.submittedBy.email) {
          userName = await this._getUserNameByEmail(
            applicationData.submittedBy.email
          );
        }

        // Store submittedBy at top level without uid
        applicationDoc.submittedBy = {
          email: applicationData.submittedBy.email || null,
          name: userName || applicationData.submittedBy.email || "Unknown User",
          role: applicationData.submittedBy.role || null,
          timestamp: new Date(),
        };

        // Update status note instead of timeline
        applicationDoc.statusNote = `Application submitted through online form by ${applicationDoc.submittedBy.name} (${applicationData.submittedBy.role})`;

        // We have submittedBy field already, no need for additional metadata
      } else {
        // Ensure submittedBy is explicitly set to null when no submission context is available
        applicationDoc.submittedBy = null;
      }

      // 3. Save application to database first
      // Sanitize any arrays to make sure they're valid for Firestore
      this._sanitizeForFirestore(applicationDoc);

      // Check document size after sanitization
      const documentSize = JSON.stringify(applicationDoc).length;
      const MAX_FIRESTORE_DOC_SIZE = 1000000; // ~1MB with safety margin

      if (documentSize > MAX_FIRESTORE_DOC_SIZE) {
        console.error(
          `❌ Document size (${documentSize} bytes) exceeds Firestore limit (${MAX_FIRESTORE_DOC_SIZE} bytes)`
        );

        // Emergency measure: Remove large fields to prevent Firestore errors
        if (applicationDoc.passportPhoto) {
          console.log(`⚠️ Removing passportPhoto to reduce document size`);
          applicationDoc.passportPhoto = "TOO_LARGE_REMOVED";
        }

        if (applicationDoc.academicDocuments) {
          console.log(`⚠️ Removing academicDocuments to reduce document size`);
          applicationDoc.academicDocuments = "TOO_LARGE_REMOVED";
        }

        if (applicationDoc.identificationDocument) {
          console.log(
            `⚠️ Removing identificationDocument to reduce document size`
          );
          applicationDoc.identificationDocument = "TOO_LARGE_REMOVED";
        }

        // Recheck size after removing large fields
        const newSize = JSON.stringify(applicationDoc).length;
        console.log(
          `📏 Document size reduced from ${documentSize} to ${newSize} bytes`
        );

        if (newSize > MAX_FIRESTORE_DOC_SIZE) {
          throw new Error(
            `Document size (${newSize} bytes) still exceeds Firestore limit after removing large fields`
          );
        }
      }

      console.log(
        `🔍 About to save application with fields:`,
        Object.keys(applicationDoc).join(", ")
      );

      // Save the application first - this is the main record
      const docRef = await this.db
        .collection(this.collection)
        .add(applicationDoc);

      console.log(`✅ Application created with ID: ${docRef.id}`);

      const savedApplication = {
        id: docRef.id,
        ...applicationDoc,
      };

      // 4. Now check if lead exists (by phone or email)
      let existingLead = null;

      // First check by phone number
      if (applicationData.phoneNumber) {
        existingLead = await this.leadService.findLeadByPhone(
          applicationData.phoneNumber
        );
      }

      // If no lead found by phone, check by email
      if (!existingLead && applicationData.email) {
        existingLead = await this.leadService.findLeadByEmail(
          applicationData.email
        );
      }

      let lead = null;

      if (existingLead) {
        // 5a. Update existing lead status to APPLIED
        console.log(
          `📞 Updating existing lead ${existingLead.id} to APPLIED status...`
        );

        lead = await this.leadService.updateLeadStatus(
          existingLead.id,
          LEAD_STATUSES.APPLIED,
          `Application submitted for ${this._getProgramName(
            applicationData.preferredProgram
          )}`,
          "SYSTEM"
        );

        // Update the application with the lead ID
        await this.db
          .collection(this.collection)
          .doc(docRef.id)
          .update({ leadId: existingLead.id });

        // Update saved application with lead ID
        savedApplication.leadId = existingLead.id;
      } else {
        // 5b. Create new lead with APPLIED status
        console.log(`🆕 Creating new lead with APPLIED status...`);

        const contactInfo = {
          name: applicationData.name,
          phone: applicationData.phoneNumber,
          email: applicationData.email,
        };

        const additionalData = {
          // Store both the code and display name for the program
          program: {
            code: applicationData.preferredProgram,
            name: this._getProgramName(applicationData.preferredProgram),
          },
          modeOfStudy: applicationData.modeOfStudy,
          preferredIntake: applicationData.preferredIntake,
          countryOfBirth: applicationData.countryOfBirth,
          gender: applicationData.gender,
          // Add reference to the application
          applicationId: docRef.id,
        };

        // Create lead directly with APPLIED status
        // Explicitly set status to ensure it's handled correctly
        contactInfo.status = LEAD_STATUSES.APPLIED; // Set initial status to APPLIED

        // Add explicit timeline entry for the application submission
        const timelineEntry = {
          date: new Date(),
          action: "APPLICATION_SUBMITTED",
          status: LEAD_STATUSES.APPLIED,
          notes: `Application submitted for ${this._getProgramName(
            applicationData.preferredProgram
          )}`,
        };

        additionalData.initialTimeline = [timelineEntry]; // Provide explicit initial timeline

        lead = await this.leadService.createLead(
          contactInfo,
          "APPLICATION_FORM", // source
          additionalData
        );

        // Update the application with the lead ID
        await this.db
          .collection(this.collection)
          .doc(docRef.id)
          .update({ leadId: lead.id });

        // Update saved application with lead ID
        savedApplication.leadId = lead.id;
      }

      console.log(
        `✅ Application created and lead linked successfully with ID: ${docRef.id}`
      );

      // 6. Send WhatsApp thank you message (if not skipped)
      let whatsappResult = null;
      try {
        // Skip WhatsApp message if specified in application data
        if (applicationData.skipWhatsappMessage) {
          console.log("🔇 Skipping WhatsApp message as requested");
          whatsappResult = { skipped: true };
          return { application: savedApplication, lead, whatsappResult };
        }

        // IMPORTANT: Make sure we have a valid lead object before sending the message
        if (!lead || !lead.id) {
          console.error("❌ Cannot send WhatsApp message - missing lead ID");
          throw new Error("Missing lead ID for WhatsApp message");
        }

        console.log(`📱 Preparing to send confirmation for lead: ${lead.id}`);

        // Use the application_received template for application confirmation
        const templatePayload = {
          messaging_product: "whatsapp",
          to: applicationData.phoneNumber,
          type: "template",
          template: {
            name: "application_received", // Specific template for application confirmations
            language: { code: "en_US" },
          },
        };

        // Enhanced metadata for better conversation tracking
        const messageMetadata = {
          leadId: lead.id, // Make sure lead ID is properly passed
          applicationId: docRef.id,
          messageType: "application_confirmation",
          contactName: applicationData.name,
          program: applicationData.preferredProgram,
          source: "APPLICATION_FORM",
        };

        // Send template message and save it to conversation history
        whatsappResult = await this.whatsappService.sendTemplateMessage(
          applicationData.phoneNumber,
          templatePayload,
          messageMetadata
        );

        if (whatsappResult.success) {
          console.log(
            `📱 WhatsApp confirmation sent to ${applicationData.phoneNumber}`
          );

          // Update application to mark WhatsApp message as sent
          await this.db.collection(this.collection).doc(docRef.id).update({
            whatsappMessageSent: true,
            updatedAt: new Date(),
          });
        }
      } catch (whatsappError) {
        console.error(
          "❌ Failed to send WhatsApp template message:",
          whatsappError
        );

        // Fallback to sending a regular text message if template fails
        try {
          console.log(
            `📱 Attempting to send fallback text message to ${applicationData.phoneNumber}`
          );
          const fallbackMessage = `Thank you for your application to ${this._getProgramName(
            applicationData.preferredProgram
          )}. Your application has been received and is being processed. We will contact you with further information.`;

          whatsappResult = await this.whatsappService.sendMessage(
            applicationData.phoneNumber,
            fallbackMessage,
            "text",
            {
              leadId: lead.id,
              applicationId: docRef.id,
              contactName: applicationData.name,
            }
          );

          if (whatsappResult.success) {
            console.log(
              `📱 Fallback WhatsApp message sent successfully to ${applicationData.phoneNumber}`
            );
            // Update application to mark WhatsApp message as sent
            await this.db.collection(this.collection).doc(docRef.id).update({
              whatsappMessageSent: true,
              updatedAt: new Date(),
            });
          }
        } catch (fallbackError) {
          console.error(
            "❌ Fallback WhatsApp message also failed:",
            fallbackError
          );
          // Don't fail the entire application process if WhatsApp fails
        }
      }

      return {
        success: true,
        application: savedApplication,
        lead: lead,
        whatsappMessage: whatsappResult,
      };
    } catch (error) {
      console.error("❌ Error submitting application:", error);
      throw error;
    }
  }

  /**
   * Generate thank you message for WhatsApp
   * @deprecated No longer in use - replaced by application_received template
   */
  generateThankYouMessage(applicationData) {
    const programName = this._getProgramName(applicationData.preferredProgram);
    const intakeName =
      applicationData.preferredIntake.charAt(0).toUpperCase() +
      applicationData.preferredIntake.slice(1);

    return `🎉 Thank you ${
      applicationData.name
    } for applying to our ${programName} program!

We're excited about your interest in joining our academic community. Here's what happens next:

📋 **Application Status**: Submitted Successfully
📚 **Program**: ${programName}
📅 **Intake**: ${intakeName}
💻 **Mode**: ${
      applicationData.modeOfStudy === "on_campus" ? "On Campus" : "Online"
    }

**Next Steps:**
1. Our admissions team will review your application within 3-5 business days
2. You may be contacted for additional documents or an interview
3. We'll keep you updated on your application progress

**Questions?** Feel free to reply to this message or call our admissions office.

Welcome to the journey towards your academic success! 🎓

Best regards,
IUEA Admissions Team`;
  }

  /**
   * Get application by ID
   */
  async getApplicationById(applicationId) {
    try {
      const doc = await this.db
        .collection(this.collection)
        .doc(applicationId)
        .get();

      if (!doc.exists) {
        console.log(`❌ No application found with ID: ${applicationId}`);
        return null;
      }

      return {
        id: doc.id,
        ...doc.data(),
      };
    } catch (error) {
      console.error(`❌ Error getting application by ID: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get application by Lead ID
   */
  async getApplicationByLeadId(leadId) {
    try {
      const snapshot = await this.db
        .collection(this.collection)
        .where("leadId", "==", leadId)
        .limit(1)
        .get();

      if (snapshot.empty) {
        console.log(`❌ No application found for lead ID: ${leadId}`);
        return null;
      }

      const doc = snapshot.docs[0];
      return {
        id: doc.id,
        ...doc.data(),
      };
    } catch (error) {
      console.error(
        `❌ Error getting application by lead ID: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Get applications by email
   */
  async getApplicationsByEmail(email) {
    try {
      console.log(
        `🔍 ApplicationService: Getting applications for email: ${email}`
      );
      console.log(
        `🔍 ApplicationService: Email toLowerCase: ${email.toLowerCase()}`
      );

      const snapshot = await this.db
        .collection(this.collection)
        .where("email", "==", email.toLowerCase())
        .orderBy("submittedAt", "desc")
        .get();

      console.log(
        `📊 ApplicationService: Query returned ${snapshot.size} documents`
      );

      const applications = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        console.log(
          `📋 ApplicationService: Found application ${doc.id} with email ${data.email}`
        );
        applications.push({
          id: doc.id,
          ...data,
        });
      });

      console.log(
        `✅ ApplicationService: Returning ${applications.length} applications`
      );
      return applications;
    } catch (error) {
      console.error(
        "❌ ApplicationService: Error getting applications by email:",
        error
      );
      throw error;
    }
  }

  /**
   * Get applications by phone number
   */
  async getApplicationsByPhone(phoneNumber) {
    try {
      const snapshot = await this.db
        .collection(this.collection)
        .where("phoneNumber", "==", phoneNumber)
        .orderBy("submittedAt", "desc")
        .get();

      const applications = [];
      snapshot.forEach((doc) => {
        applications.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      return applications;
    } catch (error) {
      console.error("❌ Error getting applications by phone:", error);
      throw error;
    }
  }

  /**
   * Update application by email and synchronize with corresponding lead
   */
  async updateApplicationByEmail(email, updateData) {
    try {
      console.log(
        `🔍 ApplicationService: Updating application for email: ${email}`
      );
      console.log(
        `🔍 ApplicationService: Update data keys:`,
        Object.keys(updateData)
      );
      console.log(
        `🔍 ApplicationService: Update data values:`,
        Object.keys(updateData).map(
          (key) => `${key}: ${typeof updateData[key]} = ${updateData[key]}`
        )
      );

      // First, get the applications by email to find the most recent one
      const applications = await this.getApplicationsByEmail(email);

      if (applications.length === 0) {
        throw new Error("No applications found for the provided email");
      }

      // Use the most recent application (first in the sorted list)
      const latestApplication = applications[0];

      // Prepare update data - only include defined values to avoid Firestore errors
      const applicationUpdate = {};

      // Add fields only if they are defined and not undefined
      if (updateData.name !== undefined && updateData.name !== null) {
        applicationUpdate.name = updateData.name;
      }
      if (updateData.email !== undefined && updateData.email !== null) {
        applicationUpdate.email = updateData.email;
      }
      if (
        updateData.phoneNumber !== undefined &&
        updateData.phoneNumber !== null
      ) {
        applicationUpdate.phoneNumber = updateData.phoneNumber;
      }
      if (
        updateData.countryOfBirth !== undefined &&
        updateData.countryOfBirth !== null
      ) {
        applicationUpdate.countryOfBirth = updateData.countryOfBirth;
      }
      if (updateData.gender !== undefined && updateData.gender !== null) {
        applicationUpdate.gender = updateData.gender;
      }
      if (updateData.postalAddress !== undefined) {
        applicationUpdate.postalAddress = updateData.postalAddress || null;
      }
      if (
        updateData.preferredProgram !== undefined &&
        updateData.preferredProgram !== null
      ) {
        applicationUpdate.preferredProgram = updateData.preferredProgram;
      }
      if (
        updateData.modeOfStudy !== undefined &&
        updateData.modeOfStudy !== null
      ) {
        applicationUpdate.modeOfStudy = updateData.modeOfStudy;
      }
      if (
        updateData.preferredIntake !== undefined &&
        updateData.preferredIntake !== null
      ) {
        applicationUpdate.preferredIntake = updateData.preferredIntake;
      }

      // Handle optional fields - only set if explicitly provided
      if (updateData.sponsorTelephone !== undefined) {
        applicationUpdate.sponsorTelephone =
          updateData.sponsorTelephone || null;
      }
      if (updateData.sponsorEmail !== undefined) {
        applicationUpdate.sponsorEmail = updateData.sponsorEmail || null;
      }
      if (updateData.howDidYouHear !== undefined) {
        applicationUpdate.howDidYouHear = updateData.howDidYouHear || null;
      }
      if (updateData.additionalNotes !== undefined) {
        applicationUpdate.additionalNotes = updateData.additionalNotes || null;
      }

      // Always update timestamp
      applicationUpdate.updatedAt = new Date().toISOString();

      // Handle status update and other management fields
      if (updateData.status) {
        applicationUpdate.status = updateData.status;
      }
      if (updateData.statusNote) {
        applicationUpdate.statusNote = updateData.statusNote;
      }
      if (updateData.notes) {
        applicationUpdate.notes = updateData.notes;
      }

      // Handle document updates if provided - upload to Firebase Storage first
      if (
        updateData.passportPhoto &&
        updateData.passportPhoto !== latestApplication.passportPhoto
      ) {
        console.log("📤 Uploading new passport photo to Firebase Storage...");
        applicationUpdate.passportPhoto = await this.uploadApplicationDocument(
          latestApplication.id,
          "passportPhoto",
          updateData.passportPhoto,
          latestApplication.email
        );
      }
      if (
        updateData.academicDocuments &&
        updateData.academicDocuments !== latestApplication.academicDocuments
      ) {
        console.log(
          "📤 Uploading new academic documents to Firebase Storage..."
        );
        applicationUpdate.academicDocuments =
          await this.uploadApplicationDocument(
            latestApplication.id,
            "academicDocuments",
            updateData.academicDocuments,
            latestApplication.email
          );
      }
      if (
        updateData.identificationDocument &&
        updateData.identificationDocument !==
          latestApplication.identificationDocument
      ) {
        console.log(
          "📤 Uploading new identification document to Firebase Storage..."
        );
        applicationUpdate.identificationDocument =
          await this.uploadApplicationDocument(
            latestApplication.id,
            "identificationDocument",
            updateData.identificationDocument,
            latestApplication.email
          );
      }

      // Parse updatedBy field if it's a JSON string
      let parsedUpdatedBy = null;
      if (updateData.updatedBy) {
        try {
          // If it's a string, try to parse it as JSON
          if (typeof updateData.updatedBy === "string") {
            parsedUpdatedBy = JSON.parse(updateData.updatedBy);
          } else if (typeof updateData.updatedBy === "object") {
            // If it's already an object, use it directly
            parsedUpdatedBy = updateData.updatedBy;
          }

          // Ensure parsedUpdatedBy has the correct structure
          if (parsedUpdatedBy && typeof parsedUpdatedBy === "object") {
            // Clean structure to match student portal format
            parsedUpdatedBy = {
              email: parsedUpdatedBy.email || null,
              name:
                parsedUpdatedBy.name || parsedUpdatedBy.email || "Unknown User",
              role: parsedUpdatedBy.role || null,
              // Don't include uid to match student portal structure
            };
          }
        } catch (parseError) {
          console.warn("❌ Failed to parse updatedBy field:", parseError);
          parsedUpdatedBy = null;
        }
      }

      // Handle timeline tracking for updates
      let hasStatusChange = false;
      let hasGeneralUpdate = false;

      if (updateData.status && updateData.status !== latestApplication.status) {
        hasStatusChange = true;
        console.log(
          `📝 Status change detected: ${latestApplication.status} → ${updateData.status}`
        );
      }

      // Check if other important fields have changed
      const importantFields = [
        "name",
        "email",
        "phoneNumber",
        "preferredProgram",
        "modeOfStudy",
      ];
      for (const field of importantFields) {
        if (
          updateData[field] &&
          updateData[field] !== latestApplication[field]
        ) {
          hasGeneralUpdate = true;
          break;
        }
      }

      // Add timeline entry based on what changed
      const currentTimeline = latestApplication.timeline || [];
      const now = new Date();

      if (hasStatusChange) {
        // Status change timeline entry
        const statusTimelineEntry = {
          date: now,
          action: "STATUS_UPDATED",
          status: updateData.status,
          notes:
            updateData.statusNote ||
            `Status changed from ${latestApplication.status} to ${updateData.status}`,
          updatedBy: parsedUpdatedBy,
          previousStatus: latestApplication.status,
        };
        applicationUpdate.timeline = [...currentTimeline, statusTimelineEntry];
        applicationUpdate.lastUpdatedBy = parsedUpdatedBy;
      } else if (hasGeneralUpdate) {
        // General update timeline entry
        const updateTimelineEntry = {
          date: now,
          action: "APPLICATION_UPDATED",
          status: latestApplication.status,
          notes: "Application information updated",
          updatedBy: parsedUpdatedBy,
        };
        applicationUpdate.timeline = [...currentTimeline, updateTimelineEntry];
        applicationUpdate.lastUpdatedBy = parsedUpdatedBy;
      }

      // Debug: Log the final update object
      console.log(
        `🔍 Final applicationUpdate object:`,
        JSON.stringify(applicationUpdate, null, 2)
      );
      console.log(`🔍 ApplicationUpdate keys:`, Object.keys(applicationUpdate));
      console.log(
        `🔍 Checking for undefined values:`,
        Object.keys(applicationUpdate).filter(
          (key) => applicationUpdate[key] === undefined
        )
      );

      // Update the application document
      await this.db
        .collection(this.collection)
        .doc(latestApplication.id)
        .update(applicationUpdate);

      console.log(
        `✅ ApplicationService: Successfully updated application ${latestApplication.id} for email: ${email}`
      );

      // Synchronize lead if status was updated and leadId exists
      if (updateData.status && latestApplication.leadId) {
        try {
          console.log(
            `🔄 Synchronizing lead ${latestApplication.leadId} status to match application status: ${updateData.status}`
          );

          // Also sync shared fields like name, email, phone, program
          const leadUpdateData = {
            status: updateData.status,
          };

          // Sync shared fields
          if (updateData.name) {
            leadUpdateData.name = updateData.name;
          }
          if (updateData.email) {
            leadUpdateData.email = updateData.email;
          }
          if (updateData.phoneNumber) {
            leadUpdateData.phone = updateData.phoneNumber;
            leadUpdateData.whatsappNumber = updateData.phoneNumber;
          }
          if (updateData.preferredProgram) {
            leadUpdateData.program = {
              code: updateData.preferredProgram,
              name: this._getProgramName(updateData.preferredProgram),
            };
          }

          // Update lead status and shared fields
          await this.leadService.updateLeadStatus(
            latestApplication.leadId,
            updateData.status,
            updateData.statusNote ||
              `Application status updated to ${updateData.status}`,
            "APPLICATION_SERVICE"
          );

          // Update additional lead fields if any changed
          if (Object.keys(leadUpdateData).length > 1) {
            // More than just status
            await this.leadService.updateLead(
              latestApplication.leadId,
              leadUpdateData
            );
          }

          console.log(
            `✅ Lead ${latestApplication.leadId} synchronized with application ${latestApplication.id}`
          );
        } catch (leadError) {
          console.error(
            `⚠️ Failed to synchronize lead for application ${latestApplication.id}:`,
            leadError
          );
          // Don't throw error here as application update was successful
        }
      }

      // Return the updated application
      return {
        id: latestApplication.id,
        ...latestApplication,
        ...applicationUpdate,
      };
    } catch (error) {
      console.error(
        "❌ ApplicationService: Error updating application by email:",
        error
      );
      throw error;
    }
  }

  /**
   * Get application document by email and document type
   */
  async getApplicationDocumentByEmail(email, documentType) {
    try {
      console.log(
        `🔍 ApplicationService: Getting ${documentType} document for email: ${email}`
      );

      // First, get the applications by email
      const applications = await this.getApplicationsByEmail(email);

      if (applications.length === 0) {
        throw new Error("No applications found for the provided email");
      }

      // Use the most recent application (first in the sorted list)
      const latestApplication = applications[0];

      // Map document types to application fields
      const documentFields = {
        passportPhoto: "passportPhoto",
        academicDocuments: "academicDocuments",
        identificationDocument: "identificationDocument",
        idDocument: "identificationDocument", // Alternative name
      };

      const fieldName = documentFields[documentType];
      if (!fieldName) {
        throw new Error(`Invalid document type: ${documentType}`);
      }

      const documentData = latestApplication[fieldName];
      if (!documentData) {
        throw new Error(`No ${documentType} found for this application`);
      }

      console.log(
        `✅ ApplicationService: Found ${documentType} document for email: ${email}`
      );

      return {
        documentType,
        data: documentData,
        applicationId: latestApplication.id,
        email: latestApplication.email,
        name: latestApplication.name,
      };
    } catch (error) {
      console.error(
        `❌ ApplicationService: Error getting ${documentType} document by email:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get all applications with pagination and filters
   */
  async getApplications(limit = 50, filters = {}) {
    try {
      let query = this.db
        .collection(this.collection)
        .orderBy("submittedAt", "desc");

      // Apply filters
      if (filters.status) {
        query = query.where("status", "==", filters.status);
      }

      if (filters.program) {
        query = query.where("preferredProgram", "==", filters.program);
      }

      if (filters.intake) {
        query = query.where("preferredIntake", "==", filters.intake);
      }

      // Apply limit
      query = query.limit(limit);

      const snapshot = await query.get();

      const applications = [];
      snapshot.forEach((doc) => {
        applications.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      return {
        applications,
        hasMore: snapshot.docs.length === limit,
      };
    } catch (error) {
      console.error("❌ Error getting applications:", error);
      throw error;
    }
  }

  /**
   * Update application status and synchronize with corresponding lead
   */
  async updateApplicationStatus(
    applicationId,
    newStatus,
    notes = "",
    updatedBy = null
  ) {
    try {
      const application = await this.getApplicationById(applicationId);
      if (!application) {
        throw new Error("Application not found");
      }

      // Parse updatedBy field if it's a JSON string
      let parsedUpdatedBy = null;
      if (updatedBy) {
        try {
          // If it's a string, try to parse it as JSON
          if (typeof updatedBy === "string") {
            parsedUpdatedBy = JSON.parse(updatedBy);
          } else if (typeof updatedBy === "object") {
            // If it's already an object, use it directly
            parsedUpdatedBy = updatedBy;
          }

          // Ensure parsedUpdatedBy has the correct structure
          if (parsedUpdatedBy && typeof parsedUpdatedBy === "object") {
            // Clean structure to match student portal format
            parsedUpdatedBy = {
              email: parsedUpdatedBy.email || null,
              name:
                parsedUpdatedBy.name || parsedUpdatedBy.email || "Unknown User",
              role: parsedUpdatedBy.role || null,
              // Don't include uid to match student portal structure
            };
          }
        } catch (parseError) {
          console.warn(
            "❌ Failed to parse updatedBy field in updateApplicationStatus:",
            parseError
          );
          parsedUpdatedBy = null;
        }
      }

      const updatedApplication = ApplicationModel.updateStatus(
        application,
        newStatus,
        notes,
        parsedUpdatedBy
      );

      // Update application in database
      await this.db
        .collection(this.collection)
        .doc(applicationId)
        .update(updatedApplication);

      console.log(
        `✅ Application ${applicationId} status updated to ${newStatus}`
      );

      // Synchronize lead status if leadId exists
      if (application.leadId) {
        try {
          console.log(
            `🔄 Synchronizing lead ${application.leadId} status to match application status: ${newStatus}`
          );

          // Update the corresponding lead status to match the application status
          await this.leadService.updateLeadStatus(
            application.leadId,
            newStatus,
            notes || `Application status updated to ${newStatus}`,
            updatedBy || "APPLICATION_SERVICE"
          );

          console.log(
            `✅ Lead ${application.leadId} status synchronized with application ${applicationId}`
          );
        } catch (leadError) {
          console.error(
            `⚠️ Failed to synchronize lead status for application ${applicationId}:`,
            leadError
          );
          // Don't throw error here as application update was successful
          // We just log the warning that lead sync failed
        }
      } else {
        console.log(
          `⚠️ No leadId found for application ${applicationId}, skipping lead status synchronization`
        );
      }

      return {
        id: applicationId,
        ...updatedApplication,
      };
    } catch (error) {
      console.error("❌ Error updating application status:", error);
      throw error;
    }
  }

  /**
   * Get application statistics
   */
  async getApplicationStats() {
    try {
      const snapshot = await this.db.collection(this.collection).get();

      const stats = {
        total: snapshot.size,
        byStatus: {},
        byProgram: {},
        byIntake: {},
        byModeOfStudy: {},
      };

      snapshot.forEach((doc) => {
        const data = doc.data();

        // Count by status
        stats.byStatus[data.status] = (stats.byStatus[data.status] || 0) + 1;

        // Count by program
        if (data.preferredProgram) {
          stats.byProgram[data.preferredProgram] =
            (stats.byProgram[data.preferredProgram] || 0) + 1;
        }

        // Count by intake
        if (data.preferredIntake) {
          stats.byIntake[data.preferredIntake] =
            (stats.byIntake[data.preferredIntake] || 0) + 1;
        }

        // Count by mode of study
        if (data.modeOfStudy) {
          stats.byModeOfStudy[data.modeOfStudy] =
            (stats.byModeOfStudy[data.modeOfStudy] || 0) + 1;
        }
      });

      return stats;
    } catch (error) {
      console.error("❌ Error getting application stats:", error);
      throw error;
    }
  }

  /**
   * Get a user-friendly program name from program code
   */
  _getProgramName(programCode) {
    if (!programCode) return "Program Not Selected";

    // Expanded list with more program options
    const programNames = {
      bachelor_information_technology: "Bachelor of Information Technology",
      bachelor_business_administration: "Bachelor of Business Administration",
      bachelor_commerce: "Bachelor of Commerce",
      bachelor_software_engineering: "Bachelor of Software Engineering",
      bachelor_computer_science: "Bachelor of Computer Science",
      bachelor_accounting: "Bachelor of Accounting",
      bachelor_marketing: "Bachelor of Marketing",
      master_information_technology: "Master of Information Technology",
      master_business_administration: "Master of Business Administration",
      master_computer_science: "Master of Computer Science",
      master_data_science: "Master of Data Science",
      diploma_information_technology: "Diploma in Information Technology",
      diploma_business_administration: "Diploma in Business Administration",
      diploma_software_engineering: "Diploma in Software Engineering",
      certificate_programming: "Certificate in Programming",
      certificate_web_development: "Certificate in Web Development",
    };

    // If it's not in our mapping, try to format it from the code
    if (!programNames[programCode]) {
      // Convert snake_case to Title Case with proper formatting
      return programCode
        .split("_")
        .map((part, index) => {
          // Capitalize first letter of each word
          const capitalized = part.charAt(0).toUpperCase() + part.slice(1);

          // For first word, prefix with appropriate degree type
          if (index === 0) {
            if (part === "bachelor") return "Bachelor of";
            if (part === "master") return "Master of";
            if (part === "diploma") return "Diploma in";
            if (part === "certificate") return "Certificate in";
            return capitalized;
          }

          return capitalized;
        })
        .join(" ");
    }

    return programNames[programCode];
  }

  /**
   * Submit a manual application from the internal form
   * This is a separate flow for applications submitted via the manual form
   * It creates a lead with APPLIED status without sending a WhatsApp message
   */
  async submitManualApplication(applicationData, predefinedId = null) {
    try {
      console.log(
        `🖊️ Processing manual application for ${applicationData.name}...`
      );

      // 1. Validate application data (still needed to ensure data integrity)
      const validation = ApplicationModel.validate(applicationData);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
      }

      // 2. Create application document but mark it as manual
      const applicationDoc =
        ApplicationModel.createApplication(applicationData);
      applicationDoc.source = "MANUAL_FORM";

      // Add formatted program name for better display
      if (applicationData.preferredProgram) {
        applicationDoc.programName = this._getProgramName(
          applicationData.preferredProgram
        );
      }

      // If submittedBy info is provided, add it to the application document
      // This is the primary source of truth for who created the application
      if (applicationData.submittedBy) {
        // Fetch proper user name from database if available
        let userName = applicationData.submittedBy.name;

        if (!userName && applicationData.submittedBy.email) {
          userName = await this._getUserNameByEmail(
            applicationData.submittedBy.email
          );
        }

        // Store submittedBy at top level without uid
        applicationDoc.submittedBy = {
          email: applicationData.submittedBy.email || null,
          name: userName || applicationData.submittedBy.email || "Unknown User",
          role: applicationData.submittedBy.role || null,
          timestamp: new Date(),
        };

        // Update status note instead of timeline
        applicationDoc.statusNote = `Application submitted through manual form by ${applicationDoc.submittedBy.name} (${applicationData.submittedBy.role})`;

        // We have submittedBy field already, no need for additional metadata
      } else {
        // Ensure submittedBy is explicitly set to null when no submission context is available
        applicationDoc.submittedBy = null;
        // Update notes to indicate it's a manual submission
        applicationDoc.statusNote = "Application submitted through manual form";

        // Just set the source field, no need for additional metadata
      }

      // 3. Check if lead exists (by phone or email)
      let existingLead = null;

      // First check by phone number
      if (applicationData.phoneNumber) {
        existingLead = await this.leadService.findLeadByPhone(
          applicationData.phoneNumber
        );
      }

      // If no lead found by phone, check by email
      if (!existingLead && applicationData.email) {
        existingLead = await this.leadService.findLeadByEmail(
          applicationData.email
        );
      }

      let lead = null;

      if (existingLead) {
        // 4a. Update existing lead status to APPLIED
        console.log(
          `📞 Updating existing lead ${existingLead.id} to APPLIED status from manual application...`
        );

        // Update additional fields first
        await this.db
          .collection("leads")
          .doc(existingLead.id)
          .update({
            // Store both the code and display name for the program
            program: {
              code: applicationData.preferredProgram,
              name: this._getProgramName(applicationData.preferredProgram),
            },
            modeOfStudy: applicationData.modeOfStudy,
            preferredIntake: applicationData.preferredIntake,
            countryOfBirth: applicationData.countryOfBirth,
            gender: applicationData.gender,
            postalAddress:
              applicationData.postalAddress || existingLead.postalAddress,
            applicationSubmitted: true,
            applicationDate: new Date(),
            updatedAt: new Date(),

            // Add sponsor info if available
            ...(applicationData.sponsorEmail || applicationData.sponsorTelephone
              ? {
                  sponsorInfo: {
                    sponsorEmail: applicationData.sponsorEmail || null,
                    sponsorPhone: applicationData.sponsorTelephone || null,
                  },
                }
              : {}),
          });

        // Update the status
        lead = await this.leadService.updateLeadStatus(
          existingLead.id,
          LEAD_STATUSES.APPLIED,
          `Application submitted manually for ${this._getProgramName(
            applicationData.preferredProgram
          )}`,
          "MANUAL_FORM"
        );

        // Update application with lead ID
        applicationDoc.leadId = existingLead.id;
      } else {
        // 4b. Create new lead with APPLIED status
        console.log(
          `🆕 Creating new lead with APPLIED status from manual application...`
        );

        const contactInfo = {
          name: applicationData.name,
          phone: applicationData.phoneNumber,
          email: applicationData.email,
          status: LEAD_STATUSES.APPLIED, // Explicitly set status to APPLIED
        };

        const additionalData = {
          // Store both the code and display name for the program
          program: {
            code: applicationData.preferredProgram,
            name: this._getProgramName(applicationData.preferredProgram),
          },
          modeOfStudy: applicationData.modeOfStudy,
          preferredIntake: applicationData.preferredIntake,
          countryOfBirth: applicationData.countryOfBirth,
          gender: applicationData.gender,
          postalAddress: applicationData.postalAddress || null,
          applicationSubmitted: true,
          applicationDate: new Date(),
          notes: "Application submitted through manual form",

          // We're not duplicating submittedBy in the lead document
          // This information is stored only in the application document

          // Add sponsor info if available
          ...(applicationData.sponsorEmail || applicationData.sponsorTelephone
            ? {
                sponsorInfo: {
                  sponsorEmail: applicationData.sponsorEmail || null,
                  sponsorPhone: applicationData.sponsorTelephone || null,
                },
              }
            : {}),
        };

        lead = await this.leadService.createLead(
          contactInfo,
          "MANUAL_FORM", // Clearly mark as manual form source
          additionalData
        );

        // Update application with lead ID
        applicationDoc.leadId = lead.id;
      }

      // 5. Save application to database with predefined ID if provided
      // Sanitize any arrays to make sure they're valid for Firestore
      this._sanitizeForFirestore(applicationDoc);

      console.log(
        `🔍 About to save manual application with fields:`,
        Object.keys(applicationDoc).join(", ")
      );

      let docRef;
      let applicationId;

      if (predefinedId) {
        // Use the predefined ID (ensures file organization consistency)
        applicationId = predefinedId;
        docRef = this.db.collection(this.collection).doc(predefinedId);
        await docRef.set(applicationDoc);
        console.log(
          `✅ Manual application created with predefined ID: ${applicationId}`
        );
      } else {
        // Let Firestore generate the ID
        docRef = await this.db.collection(this.collection).add(applicationDoc);
        applicationId = docRef.id;
        console.log(
          `✅ Manual application created with auto-generated ID: ${applicationId}`
        );
      }

      const savedApplication = {
        id: applicationId,
        ...applicationDoc,
      };

      // 6. Send email notification for manual application
      try {
        const applicationEmailService = require("./applicationEmailService");

        console.log(
          `📧 Sending email notification for manual application to ${applicationData.email}`
        );

        await applicationEmailService.sendStatusChangeNotification({
          applicantEmail: applicationData.email,
          applicantName: applicationData.name,
          courseName:
            this._getProgramName(applicationData.preferredProgram) ||
            "Your Application",
          status: "applied",
          additionalInfo:
            "Thank you for applying! Your application has been received and is being processed. You will receive updates on your application status via email.",
        });

        console.log(
          `✅ Email notification sent successfully to ${applicationData.email}`
        );
      } catch (emailError) {
        console.error(
          "❌ Failed to send email notification for manual application:",
          emailError
        );
        // Don't fail the application submission if email fails
      }

      // 7. No WhatsApp message for manual applications
      return {
        application: savedApplication,
        lead,
        whatsappResult: { skipped: true, reason: "Manual application" },
        emailSent: true,
      };
    } catch (error) {
      console.error("❌ Error submitting manual application:", error);
      throw error;
    }
  }
  /**
   * Fetch user's name from users collection using their email
   * Used to ensure we always get a proper name for the user
   */
  async _getUserNameByEmail(email) {
    try {
      if (!email) return null;

      const usersRef = this.db.collection("users");
      const snapshot = await usersRef
        .where("email", "==", email)
        .limit(1)
        .get();

      if (snapshot.empty) {
        console.log(`⚠️ No user found with email: ${email}`);
        return null;
      }

      // Return the user's display name or full name if available
      const userData = snapshot.docs[0].data();
      return userData.displayName || userData.fullName || userData.name || null;
    } catch (error) {
      console.error("❌ Error fetching user name:", error);
      return null;
    }
  }

  /**
   * Sanitize document object for Firestore
   * This method processes objects to ensure they can be stored in Firestore
   * - Converts File objects to strings
   * - Ensures arrays contain only valid Firestore types
   * - Removes any circular references or invalid types
   */
  _sanitizeForFirestore(obj) {
    if (!obj) return obj;

    // Check total document size before processing
    const MAX_DOCUMENT_SIZE = 1000000; // ~1MB with some buffer
    const stringSize = JSON.stringify(obj).length;

    if (stringSize > MAX_DOCUMENT_SIZE) {
      console.error(
        `⚠️ Document too large (${stringSize} bytes). Maximum allowed is ${MAX_DOCUMENT_SIZE} bytes.`
      );

      // Check for large fields (especially base64 images)
      for (const key in obj) {
        if (typeof obj[key] === "string" && obj[key].length > 100000) {
          console.error(
            `⚠️ Large field detected: ${key} (${obj[key].length} bytes)`
          );
        }
      }

      // Reduce size of large base64 fields
      if (obj.passportPhoto && obj.passportPhoto.length > 200000) {
        console.error(
          `⚠️ Passport photo too large (${obj.passportPhoto.length} bytes). Truncating to prevent Firestore error.`
        );
        obj.passportPhoto = "DATA_TOO_LARGE";
      }

      if (
        obj.academicDocuments &&
        typeof obj.academicDocuments === "string" &&
        obj.academicDocuments.length > 350000
      ) {
        console.error(
          `⚠️ Academic documents too large (${obj.academicDocuments.length} bytes). Truncating to prevent Firestore error.`
        );
        obj.academicDocuments = "DATA_TOO_LARGE";
      }

      if (
        obj.identificationDocument &&
        typeof obj.identificationDocument === "string" &&
        obj.identificationDocument.length > 300000
      ) {
        console.error(
          `⚠️ ID document too large (${obj.identificationDocument.length} bytes). Truncating to prevent Firestore error.`
        );
        obj.identificationDocument = "DATA_TOO_LARGE";
      }
    }

    // Handle arrays - a common source of Firestore errors
    for (const key in obj) {
      const value = obj[key];

      // Skip null/undefined values
      if (value == null) continue;

      // Handle array fields - the most common source of nested entity errors
      if (Array.isArray(value)) {
        console.log(
          `🔍 Checking array field: ${key} with ${value.length} items`
        );

        // Filter out any non-serializable items
        obj[key] = value.filter((item) => {
          if (item === null || item === undefined) return false;

          if (typeof item === "object") {
            // For objects, check if they're valid for Firestore
            // Convert complex objects to strings to avoid nested entity errors
            if (
              typeof item.toString === "function" &&
              item.toString !== Object.prototype.toString
            ) {
              console.log(`⚠️ Converting complex object in ${key} to string`);
              return false; // We'll filter this out and handle specially if needed
            }

            // Make sure there are no nested arrays or invalid types
            for (const subKey in item) {
              if (Array.isArray(item[subKey])) {
                console.log(
                  `⚠️ Found nested array in ${key}.${subKey} - removing`
                );
                delete item[subKey]; // Remove nested arrays to prevent errors
              }
            }
          }

          return true;
        });

        // If this is academicDocuments, ensure it's valid
        if (key === "academicDocuments" || key === "identificationDocument") {
          console.log(`🔍 Sanitizing ${key} specifically`);

          // Ensure it's an empty array if present but invalid
          if (obj[key].length === 0) {
            console.log(`⚠️ ${key} is empty, setting to null`);
            obj[key] = null;
          } else if (typeof obj[key][0] === "object" && obj[key][0] !== null) {
            // Convert any objects to simple string references if possible
            obj[key] = obj[key].map((doc) => {
              // If it's a file object with a URL, just keep the URL
              if (doc && doc.url) return doc.url;
              if (typeof doc === "string") return doc;

              // For other objects, convert to a sanitized simple object
              return {
                name: doc.name || "document",
                url: doc.url || null,
              };
            });
          }
        }
      }
      // Handle object fields (non-array)
      else if (typeof value === "object" && value !== null) {
        // Recursively sanitize nested objects
        this._sanitizeForFirestore(value);
      }
    }

    return obj;
  }

  /**
   * Check if an application with the same email or phone already exists
   * Returns existing applications and leads that match the provided information
   * @param {string} email - Email to check
   * @param {string} phoneNumber - Phone number to check
   * @returns {Object} Object containing information about existing entries
   */
  async checkExistingApplications(email, phoneNumber) {
    try {
      console.log(
        `🔍 Checking for existing applications with email=${email}, phone=${phoneNumber}`
      );

      const result = {
        hasDuplicates: false,
        applications: {
          byEmail: [],
          byPhone: [],
        },
        leads: {
          byEmail: null,
          byPhone: null,
        },
      };

      // Only proceed with checks if we have at least one contact method
      if (!email && !phoneNumber) {
        return result;
      }

      // 1. Check for existing applications with the same email
      if (email) {
        const emailApplications = await this.getApplicationsByEmail(email);
        if (emailApplications && emailApplications.length > 0) {
          result.applications.byEmail = emailApplications.map((app) => ({
            id: app.id,
            name: app.name,
            email: app.email,
            phone: app.phoneNumber,
            program: app.programName || app.preferredProgram,
            status: app.status,
            submittedAt: app.submittedAt,
          }));
          result.hasDuplicates = true;
        }
      }

      // 2. Check for existing applications with the same phone number
      if (phoneNumber) {
        const phoneApplications = await this.getApplicationsByPhone(
          phoneNumber
        );
        if (phoneApplications && phoneApplications.length > 0) {
          result.applications.byPhone = phoneApplications.map((app) => ({
            id: app.id,
            name: app.name,
            email: app.email,
            phone: app.phoneNumber,
            program: app.programName || app.preferredProgram,
            status: app.status,
            submittedAt: app.submittedAt,
          }));
          result.hasDuplicates = true;
        }
      }

      // 3. Check for existing leads with the same email
      if (email) {
        const existingEmailLead = await this.leadService.findLeadByEmail(email);
        if (existingEmailLead) {
          result.leads.byEmail = {
            id: existingEmailLead.id,
            name: existingEmailLead.name,
            email: existingEmailLead.email,
            phone: existingEmailLead.phone,
            status: existingEmailLead.status,
            createdAt: existingEmailLead.createdAt,
            // Include program info if available
            program: existingEmailLead.program
              ? existingEmailLead.program.name || existingEmailLead.program.code
              : null,
          };
          result.hasDuplicates = true;
        }
      }

      // 4. Check for existing leads with the same phone number
      if (phoneNumber) {
        const existingPhoneLead = await this.leadService.findLeadByPhone(
          phoneNumber
        );
        if (existingPhoneLead) {
          result.leads.byPhone = {
            id: existingPhoneLead.id,
            name: existingPhoneLead.name,
            email: existingPhoneLead.email,
            phone: existingPhoneLead.phone,
            status: existingPhoneLead.status,
            createdAt: existingPhoneLead.createdAt,
            // Include program info if available
            program: existingPhoneLead.program
              ? existingPhoneLead.program.name || existingPhoneLead.program.code
              : null,
          };
          result.hasDuplicates = true;
        }
      }

      // Return the results
      if (result.hasDuplicates) {
        console.log(
          `⚠️ Found ${
            result.applications.byEmail.length +
            result.applications.byPhone.length
          } matching applications and ${
            (result.leads.byEmail ? 1 : 0) + (result.leads.byPhone ? 1 : 0)
          } matching leads`
        );
      } else {
        console.log(`✅ No matching applications or leads found`);
      }

      return result;
    } catch (error) {
      console.error("❌ Error checking for existing applications:", error);
      // Return a safe response even in case of error
      return {
        hasDuplicates: false,
        error: error.message,
        applications: { byEmail: [], byPhone: [] },
        leads: { byEmail: null, byPhone: null },
      };
    }
  }
}

module.exports = ApplicationService;
