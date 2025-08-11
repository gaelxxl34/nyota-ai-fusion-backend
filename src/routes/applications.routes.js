/**
 * Application Routes
 * RESTful API endpoints for application management
 */

const express = require("express");
const ApplicationService = require("../services/applicationService");
const applicationEmailService = require("../services/applicationEmailService");
const { APPLICATION_STATUSES } = require("../models/application.model");

const router = express.Router();

// Application service will be initialized by the main app
let applicationService = null;

// Middleware to ensure application service is initialized
const ensureApplicationService = (req, res, next) => {
  if (!applicationService) {
    return res
      .status(500)
      .json({ error: "Application service not initialized" });
  }
  next();
};

// Initialize application service
const initializeApplicationService = (
  firestore,
  leadService,
  whatsappMessageService,
  storageService
) => {
  applicationService = new ApplicationService(
    firestore,
    leadService,
    whatsappMessageService,
    storageService
  );
  console.log("✅ Application service initialized with Firebase Storage");
};

/**
 * Submit a new application
 * POST /api/applications/submit
 */
router.post("/submit", ensureApplicationService, async (req, res) => {
  try {
    const { submittedBy, forceSubmit, ...applicationData } = req.body;

    if (!applicationData) {
      return res.status(400).json({
        success: false,
        error: "Application data is required",
      });
    }

    // If submittedBy is included in the request, use it
    // Otherwise, try to use the authenticated user info from the middleware
    const submitterInfo =
      submittedBy ||
      (req.user
        ? {
            uid: req.user.uid,
            email: req.user.email,
            role: req.user.role,
            submittedAt: new Date().toISOString(),
          }
        : null);

    // Add submittedBy to the application data
    const dataWithSubmitter = {
      ...applicationData,
      submittedBy: submitterInfo,
    };

    // Check for duplicates if forceSubmit is not true
    if (!forceSubmit) {
      // Check if there are existing applications with the same email or phone
      const existingEntries =
        await applicationService.checkExistingApplications(
          applicationData.email,
          applicationData.phoneNumber
        );

      if (existingEntries.hasDuplicates) {
        return res.status(409).json({
          success: false,
          duplicatesFound: true,
          existingData: existingEntries,
          message: "Matching records found with the same email or phone number",
        });
      }
    }

    const result = await applicationService.submitApplication(
      dataWithSubmitter
    );

    res.status(201).json({
      success: true,
      message: "Application submitted successfully",
      application: result.application,
      lead: result.lead,
      whatsappMessage: result.whatsappMessage,
    });
  } catch (error) {
    console.error("❌ Error submitting application:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Submit a manual application (internal form)
 * POST /api/applications/submit-manual
 */
router.post("/submit-manual", ensureApplicationService, async (req, res) => {
  try {
    const { submittedBy, forceSubmit, ...applicationData } = req.body;

    if (!applicationData) {
      return res.status(400).json({
        success: false,
        error: "Application data is required",
      });
    }

    // If submittedBy is included in the request, use it
    // Otherwise, try to use the authenticated user info from the middleware
    const submitterInfo =
      submittedBy ||
      (req.user
        ? {
            uid: req.user.uid,
            email: req.user.email,
            role: req.user.role,
            submittedAt: new Date().toISOString(),
          }
        : null);

    // Add submittedBy to the application data
    const dataWithSubmitter = {
      ...applicationData,
      submittedBy: submitterInfo,
    };

    // Check for duplicates if forceSubmit is not true
    if (!forceSubmit) {
      // Check if there are existing applications with the same email or phone
      const existingEntries =
        await applicationService.checkExistingApplications(
          applicationData.email,
          applicationData.phoneNumber
        );

      if (existingEntries.hasDuplicates) {
        return res.status(409).json({
          success: false,
          duplicatesFound: true,
          existingData: existingEntries,
          message: "Matching records found with the same email or phone number",
        });
      }
    }

    // Use the dedicated manual application submission method
    const result = await applicationService.submitManualApplication(
      dataWithSubmitter
    );

    res.status(201).json({
      success: true,
      message: "Manual application submitted successfully",
      application: result.application,
      lead: result.lead,
    });
  } catch (error) {
    console.error("❌ Error submitting manual application:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get available application statuses and options
 * GET /api/applications/config
 */
router.get("/config", (req, res) => {
  res.json({
    success: true,
    data: {
      statuses: Object.values(APPLICATION_STATUSES),
      programs: [
        {
          value: "bachelor_information_technology",
          label: "Bachelor of Information Technology (BIT)",
        },
        {
          value: "bachelor_business_administration",
          label: "Bachelor of Business Administration (BBA)",
        },
        { value: "bachelor_commerce", label: "Bachelor of Commerce (BCOM)" },
        {
          value: "master_information_technology",
          label: "Master of Information Technology (MIT)",
        },
        {
          value: "master_business_administration",
          label: "Master of Business Administration (MBA)",
        },
        {
          value: "diploma_information_technology",
          label: "Diploma in Information Technology",
        },
        {
          value: "diploma_business_administration",
          label: "Diploma in Business Administration",
        },
        { value: "certificate_programs", label: "Certificate Programs" },
      ],
      intakes: [
        { value: "january", label: "January" },
        { value: "may", label: "May" },
        { value: "august", label: "August" },
      ],
      studyModes: [
        { value: "on_campus", label: "On Campus" },
        { value: "online", label: "Online" },
      ],
      genders: [
        { value: "male", label: "Male" },
        { value: "female", label: "Female" },
        { value: "other", label: "Other" },
        { value: "prefer_not_to_say", label: "Prefer not to say" },
      ],
    },
  });
});

/**
 * Get application statistics
 * GET /api/applications/stats
 */
router.get("/stats", ensureApplicationService, async (req, res) => {
  try {
    const stats = await applicationService.getApplicationStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("❌ Error getting application stats:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get application document by email and document type
 * GET /api/applications/email/:email/document/:documentType
 */
router.get(
  "/email/:email/document/:documentType",
  ensureApplicationService,
  async (req, res) => {
    try {
      const { email, documentType } = req.params;
      console.log(
        `🔍 REQUEST: GET /applications/email/${email}/document/${documentType}`
      );

      // Validate document type
      if (
        ![
          "academicDocuments",
          "identificationDocument",
          "passportPhoto",
          "idDocument", // Alternative name for identificationDocument
        ].includes(documentType)
      ) {
        console.error(`❌ Invalid document type: ${documentType}`);
        return res.status(400).json({
          success: false,
          error: "Invalid document type",
          message:
            "Document type must be 'academicDocuments', 'identificationDocument', 'idDocument', or 'passportPhoto'",
        });
      }

      // Use the service method to get the document
      const documentResult =
        await applicationService.getApplicationDocumentByEmail(
          decodeURIComponent(email),
          documentType
        );

      console.log(`✅ Document found for ${documentType} - email: ${email}`);

      // Return the document data
      return res.json({
        success: true,
        url: documentResult.data,
        documentType: documentResult.documentType,
        applicationId: documentResult.applicationId,
        applicantName: documentResult.name,
        applicantEmail: documentResult.email,
      });
    } catch (error) {
      console.error("❌ Error getting document by email:", error);

      if (error.message.includes("No applications found")) {
        return res.status(404).json({
          success: false,
          error: "Application not found",
          message: error.message,
        });
      }

      if (error.message.includes("No") && error.message.includes("found")) {
        return res.status(404).json({
          success: false,
          error: "Document not found",
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * Update application by email
 * PUT /api/applications/email/:email
 */
router.put("/email/:email", ensureApplicationService, async (req, res) => {
  try {
    const { email } = req.params;
    let applicationData = req.body;

    console.log(`🔍 PUT /applications/email/${email} - Received request`);

    if (!applicationData || Object.keys(applicationData).length === 0) {
      return res.status(400).json({
        success: false,
        error: "Application data is required",
      });
    }

    // Handle file uploads if available
    const files = {};
    if (req.files) {
      console.log("Files received in update request:", Object.keys(req.files));

      // Process each uploaded file
      for (const fieldName in req.files) {
        const file = req.files[fieldName];
        console.log(
          `Processing file upload for field: ${fieldName}`,
          file.name
        );

        try {
          // Upload file to Firebase Storage using the document upload method
          const documentType =
            fieldName === "passportPhoto"
              ? "passportPhoto"
              : fieldName === "academicDocuments"
              ? "academicDocuments"
              : fieldName === "idDocument"
              ? "identificationDocument"
              : fieldName;

          // Upload to Firebase Storage and get public URL
          const publicUrl = await applicationService.uploadApplicationDocument(
            "temp", // We don't need applicationId for this operation
            documentType,
            file
          );

          console.log(
            `File uploaded successfully to Firebase Storage. Field: ${fieldName}, URL: ${publicUrl}`
          );

          // Add the public URL to application data
          files[fieldName] = publicUrl;
        } catch (fileError) {
          console.error(`Error uploading file for ${fieldName}:`, fileError);
          return res.status(500).json({
            success: false,
            error: `File upload failed for ${fieldName}: ${fileError.message}`,
          });
        }
      }

      // Merge file data with application data
      applicationData = { ...applicationData, ...files };
    }

    // Check for base64 document data in the request body
    const documentFields = [
      "passportPhoto",
      "academicDocuments",
      "idDocument",
      "identificationDocument",
    ];
    for (const field of documentFields) {
      if (
        applicationData[field] &&
        typeof applicationData[field] === "string" &&
        applicationData[field].startsWith("data:")
      ) {
        console.log(`Found base64 data for ${field} in request body`);
        // Data is already in base64 format, no need to process further
        files[field] = applicationData[field];
      }
    }

    // Add updatedBy field only if user info is available
    if (req.user) {
      applicationData.updatedBy = {
        uid: req.user.uid,
        email: req.user.email,
        name: req.user.displayName || req.user.email,
        role: req.user.role,
      };
    }

    console.log(`🔄 Updating application for email: ${email}`);

    // Get the existing application before update to detect status changes
    let existingApplication = null;
    try {
      const existingApps = await applicationService.getApplicationsByEmail(
        email
      );
      if (existingApps && existingApps.length > 0) {
        existingApplication = existingApps[0];
      }
    } catch (err) {
      console.log(
        "Could not retrieve existing application for status comparison"
      );
    }

    // Use the service method to update application by email
    const updatedApplication =
      await applicationService.updateApplicationByEmail(email, applicationData);

    // Check if status changed and send email notification
    if (
      existingApplication &&
      updatedApplication &&
      existingApplication.status !== updatedApplication.status
    ) {
      try {
        console.log(
          `📧 Status changed from ${existingApplication.status} to ${updatedApplication.status} - sending email notification`
        );

        // Map internal statuses to user-friendly status names
        const statusMapping = {
          QUALIFIED: "approved",
          APPROVED: "approved",
          REJECTED: "rejected",
          IN_REVIEW: "pending",
          PENDING: "pending",
          INTERVIEW_SCHEDULED: "interview_scheduled",
          DOCUMENTS_REQUIRED: "documents_required",
          ON_HOLD: "on_hold",
        };

        const emailStatus =
          statusMapping[updatedApplication.status] ||
          updatedApplication.status.toLowerCase();

        await applicationEmailService.sendStatusChangeNotification({
          applicantEmail: updatedApplication.email,
          applicantName: updatedApplication.name,
          courseName: updatedApplication.preferredProgram || "Your Application",
          status: emailStatus,
          additionalInfo:
            updatedApplication.statusNote ||
            "Your application status has been updated.",
        });

        console.log(
          `✅ Status change email sent successfully to ${updatedApplication.email}`
        );
      } catch (emailError) {
        console.error("❌ Failed to send status change email:", emailError);
        // Don't fail the application update if email fails
      }
    }

    console.log(`✅ Application updated successfully for email: ${email}`);

    res.json({
      success: true,
      data: updatedApplication,
      message: "Application updated successfully",
    });
  } catch (error) {
    console.error("❌ Error updating application by email:", error);

    // Check for specific Firestore errors and provide more helpful messages
    if (error.code === "invalid-argument") {
      console.error("Invalid data format in the update:", error);
      return res.status(400).json({
        success: false,
        error: "Invalid data format in the update request",
        message: error.message,
      });
    }

    if (error.message.includes("No applications found")) {
      return res.status(404).json({
        success: false,
        error: "Application not found",
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get application by email
 * GET /api/applications/email/:email
 */
router.get("/email/:email", ensureApplicationService, async (req, res) => {
  try {
    const { email } = req.params;
    console.log(`🔍 API: Getting applications for email: ${email}`);
    console.log(`🔍 Decoded email: ${decodeURIComponent(email)}`);

    const applications = await applicationService.getApplicationsByEmail(
      decodeURIComponent(email)
    );

    console.log(
      `📊 Found ${
        applications ? applications.length : 0
      } applications for email: ${decodeURIComponent(email)}`
    );

    if (applications && applications.length > 0) {
      console.log(
        `✅ Returning applications:`,
        applications.map((app) => ({
          id: app.id,
          name: app.name,
          email: app.email,
        }))
      );
    } else {
      console.log(
        `❌ No applications found for email: ${decodeURIComponent(email)}`
      );
    }

    res.json({
      success: true,
      data: applications,
    });
  } catch (error) {
    console.error("❌ Error finding applications by email:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get application by phone number
 * GET /api/applications/phone/:phoneNumber
 */
router.get(
  "/phone/:phoneNumber",
  ensureApplicationService,
  async (req, res) => {
    try {
      const { phoneNumber } = req.params;
      const applications = await applicationService.getApplicationsByPhone(
        decodeURIComponent(phoneNumber)
      );

      res.json({
        success: true,
        data: applications,
      });
    } catch (error) {
      console.error("❌ Error finding applications by phone:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * Get application by lead ID
 * GET /api/applications/lead/:leadId
 */
router.get("/lead/:leadId", ensureApplicationService, async (req, res) => {
  try {
    const { leadId } = req.params;
    console.log(`🔍 Finding application by leadId: ${leadId}`);
    const application = await applicationService.getApplicationByLeadId(leadId);

    if (!application) {
      console.log(`❌ No application found for leadId: ${leadId}`);
      return res.status(404).json({
        success: false,
        error: "No application found for this lead",
        message: "No application record exists for this lead yet",
      });
    }

    console.log(`✅ Found application for leadId ${leadId}: ${application.id}`);
    res.json({
      success: true,
      data: application,
    });
  } catch (error) {
    console.error("❌ Error finding application by lead ID:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: "An error occurred while retrieving application data",
    });
  }
});

/**
 * Get all applications with pagination and filters
 * GET /api/applications
 */
router.get("/", ensureApplicationService, async (req, res) => {
  try {
    const { limit = 50, status, program, intake } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (program) filters.program = program;
    if (intake) filters.intake = intake;

    const result = await applicationService.getApplications(
      parseInt(limit),
      filters
    );

    res.json({
      success: true,
      data: result.applications,
      pagination: {
        hasMore: result.hasMore,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("❌ Error getting applications:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get application by ID
 * GET /api/applications/:id
 */
router.get("/:id", ensureApplicationService, async (req, res) => {
  try {
    const { id } = req.params;
    const application = await applicationService.getApplicationById(id);

    if (!application) {
      return res.status(404).json({
        success: false,
        error: "Application not found",
      });
    }

    res.json({
      success: true,
      data: application,
    });
  } catch (error) {
    console.error("❌ Error getting application:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get application document by ID and document type
 * GET /api/applications/:id/document/:documentType
 */
router.get(
  "/:id/document/:documentType",
  ensureApplicationService,
  async (req, res) => {
    try {
      const { id, documentType } = req.params;
      console.log(
        `🔍 REQUEST: GET /applications/${id}/document/${documentType}`
      );
      console.log(
        `🔍 Retrieving ${documentType} document for application: ${id}`
      );
      console.log(
        `Full URL: ${req.protocol}://${req.get("host")}${req.originalUrl}`
      );
      console.log(`Request headers:`, req.headers);

      // Check if required parameters are present
      if (!id) {
        console.error("❌ Missing application ID parameter");
        return res.status(400).json({
          success: false,
          error: "Missing application ID",
          message: "Application ID is required",
        });
      }

      if (!documentType) {
        console.error("❌ Missing document type parameter");
        return res.status(400).json({
          success: false,
          error: "Missing document type",
          message: "Document type is required",
        });
      }

      // Validate document type
      console.log(`Document type received: '${documentType}'`);
      console.log(
        `Valid document types: academicDocuments, identificationDocument, passportPhoto`
      );

      if (
        ![
          "academicDocuments",
          "identificationDocument",
          "passportPhoto",
        ].includes(documentType)
      ) {
        console.error(`❌ Invalid document type: ${documentType}`);
        return res.status(400).json({
          success: false,
          error: "Invalid document type",
          message:
            "Document type must be 'academicDocuments', 'identificationDocument', or 'passportPhoto'",
        });
      }

      // Get the application
      const application = await applicationService.getApplicationById(id);

      if (!application) {
        return res.status(404).json({
          success: false,
          error: "Application not found",
          message: "Application not found with the provided ID",
        });
      }

      // Log detailed application structure for debugging
      console.log(`Application found with ID: ${id}`);
      console.log(`Full application data structure:`);
      const safeApplication = JSON.parse(JSON.stringify(application));
      console.log(
        JSON.stringify(safeApplication, null, 2).substring(0, 1000) + "..."
      );

      // Get the document URL from the application
      console.log(`Application keys:`, Object.keys(application));

      // Check for possible alternate field names
      let documentUrl = null;
      const possibleFieldNames = {
        academicDocuments: [
          "academicDocuments",
          "academicDocument",
          "academicDocs",
          "academic_documents",
          "documents",
        ],
        identificationDocument: [
          "identificationDocument",
          "idDocument",
          "identification",
          "id_document",
          "idCard",
        ],
        passportPhoto: [
          "passportPhoto",
          "passport_photo",
          "photo",
          "passportImage",
          "picture",
        ],
      };

      // Try the exact field name first
      documentUrl = application[documentType];

      // If not found, try alternative field names
      if (!documentUrl && possibleFieldNames[documentType]) {
        console.log(
          `Document not found with exact field name. Trying alternatives for ${documentType}...`
        );
        for (const altField of possibleFieldNames[documentType]) {
          if (altField !== documentType && application[altField]) {
            console.log(`Found document in alternative field: ${altField}`);
            documentUrl = application[altField];
            break;
          }
        }
      }

      // Handle array of documents (if multiple documents are stored)
      if (Array.isArray(documentUrl)) {
        console.log(
          `Document field is an array with ${documentUrl.length} items`
        );
        if (documentUrl.length > 0) {
          documentUrl = documentUrl[0]; // Use the first document in the array
          console.log(`Using first document in array: ${documentUrl}`);
        } else {
          documentUrl = null;
        }
      }

      console.log(`Looking for document type: ${documentType} in application`);
      console.log(`Document URL found: ${documentUrl ? "YES" : "NO"}`);
      console.log(`Document URL: ${documentUrl || "undefined"}`);

      if (!documentUrl) {
        console.error(`❌ Document not found for type: ${documentType}`);
        return res.status(404).json({
          success: false,
          error: "Document not found",
          message: `No ${documentType} found for this application`,
        });
      }

      // For Firebase Storage URLs, we need to get a download URL or redirect to it
      if (
        documentUrl.startsWith("https://firebasestorage.googleapis.com") ||
        documentUrl.startsWith("gs://")
      ) {
        // Return the document URL for the frontend to use
        return res.json({
          success: true,
          url: documentUrl,
          documentType: documentType,
        });
      }
      // For base64 encoded data
      else if (documentUrl.startsWith("data:")) {
        return res.json({
          success: true,
          url: documentUrl,
          documentType: documentType,
          isBase64: true,
        });
      }
      // For document IDs (assuming they're stored in another collection)
      else {
        return res.json({
          success: true,
          url: `/api/documents/${documentUrl}`,
          documentType: documentType,
        });
      }
    } catch (error) {
      console.error(`❌ Error retrieving document: ${error}`);
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Failed to retrieve document",
      });
    }
  }
);

/**
 * Update application status
 * PUT /api/applications/:id/status
 */
router.put("/:id/status", ensureApplicationService, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, updatedBy } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: "Status is required",
      });
    }

    if (!Object.values(APPLICATION_STATUSES).includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status",
      });
    }

    const application = await applicationService.updateApplicationStatus(
      id,
      status,
      notes,
      updatedBy
    );

    // Send email notification for status change
    try {
      if (application && application.email && application.name) {
        console.log(
          `📧 Sending status change email to ${application.email} for status: ${status}`
        );

        // Map internal statuses to user-friendly status names
        const statusMapping = {
          QUALIFIED: "approved",
          APPROVED: "approved",
          REJECTED: "rejected",
          IN_REVIEW: "pending",
          PENDING: "pending",
          INTERVIEW_SCHEDULED: "interview_scheduled",
          DOCUMENTS_REQUIRED: "documents_required",
          ON_HOLD: "on_hold",
        };

        const emailStatus = statusMapping[status] || status.toLowerCase();

        await applicationEmailService.sendStatusChangeNotification({
          applicantEmail: application.email,
          applicantName: application.name,
          courseName: application.preferredProgram || "Your Application",
          status: emailStatus,
          additionalInfo: notes,
        });

        console.log(
          `✅ Status change email sent successfully to ${application.email}`
        );
      }
    } catch (emailError) {
      console.error("❌ Failed to send status change email:", emailError);
      // Don't fail the status update if email fails
    }

    res.json({
      success: true,
      data: application,
    });
  } catch (error) {
    console.error("❌ Error updating application status:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Update application details
 * PUT /api/applications/:id
 */
router.put("/:id", ensureApplicationService, async (req, res) => {
  try {
    const { id } = req.params;
    let applicationData = req.body;

    // Handle file uploads if available
    const files = {};
    if (req.files) {
      console.log("Files received in update request:", Object.keys(req.files));

      // Process each uploaded file
      for (const fieldName in req.files) {
        const file = req.files[fieldName];
        console.log(
          `Processing file upload for field: ${fieldName}`,
          file.name
        );

        try {
          // Upload file to Firebase Storage using the new document upload method
          const documentType =
            fieldName === "passportPhoto"
              ? "passportPhoto"
              : fieldName === "academicDocuments"
              ? "academicDocuments"
              : fieldName === "idDocument"
              ? "identificationDocument"
              : fieldName;

          // Upload to Firebase Storage and get public URL
          const publicUrl = await applicationService.uploadApplicationDocument(
            id,
            documentType,
            file
          );

          console.log(
            `File uploaded successfully to Firebase Storage. Field: ${fieldName}, URL: ${publicUrl}`
          );

          // Add the public URL to application data
          files[fieldName] = publicUrl;
        } catch (fileError) {
          console.error(`Error uploading file for ${fieldName}:`, fileError);
          return res.status(500).json({
            success: false,
            error: `File upload failed for ${fieldName}: ${fileError.message}`,
          });
        }
      }

      // Merge file data with application data
      applicationData = { ...applicationData, ...files };
    }

    // Check for base64 document data in the request body
    const documentFields = [
      "passportPhoto",
      "academicDocuments",
      "idDocument",
      "identificationDocument",
    ];
    for (const field of documentFields) {
      if (
        applicationData[field] &&
        typeof applicationData[field] === "string" &&
        applicationData[field].startsWith("data:")
      ) {
        console.log(`Found base64 data for ${field} in request body`);
        // Data is already in base64 format, no need to process further
        files[field] = applicationData[field];
      }
    }

    if (
      !applicationData ||
      (Object.keys(applicationData).length === 0 && !req.files)
    ) {
      return res.status(400).json({
        success: false,
        error: "Application data is required",
      });
    }

    // Get existing application
    const existingApplication = await applicationService.getApplicationById(id);

    if (!existingApplication) {
      return res.status(404).json({
        success: false,
        error: "Application not found",
      });
    }

    // Update the application with new data
    const updatedApplication = {
      ...existingApplication,
      ...applicationData,
      updatedAt: new Date().toISOString(),
    };

    // Add updatedBy field only if user info is available
    if (req.user) {
      updatedApplication.updatedBy = {
        uid: req.user.uid,
        email: req.user.email,
        name: req.user.displayName || req.user.email,
        role: req.user.role,
      };
    }

    console.log("Updating application with data:", updatedApplication);

    // Helper function to recursively remove undefined values and sanitize data for Firestore
    const sanitizeForFirestore = (obj) => {
      if (!obj || typeof obj !== "object") return;

      Object.keys(obj).forEach((key) => {
        // Handle undefined values - remove them
        if (obj[key] === undefined) {
          console.log(`Removing undefined field: ${key}`);
          delete obj[key];
        }
        // Handle null values - keep them as Firestore accepts null
        else if (obj[key] === null) {
          // Firestore accepts null values, so we keep them
          console.log(`Found null field: ${key} (keeping it)`);
        }
        // Handle nested objects recursively
        else if (
          obj[key] &&
          typeof obj[key] === "object" &&
          !Array.isArray(obj[key])
        ) {
          sanitizeForFirestore(obj[key]);
          // If the nested object is empty after sanitizing, remove it
          if (Object.keys(obj[key]).length === 0) {
            console.log(`Removing empty object field: ${key}`);
            delete obj[key];
          }
        }
        // Handle arrays
        else if (Array.isArray(obj[key])) {
          // Sanitize each object in the array
          obj[key].forEach((item) => {
            if (item && typeof item === "object") {
              sanitizeForFirestore(item);
            }
          });
          // Filter out undefined values from arrays
          obj[key] = obj[key].filter((item) => item !== undefined);
        }
      });
    };

    // Sanitize the application data for Firestore
    sanitizeForFirestore(updatedApplication);

    // Create a clean update object without any problematic values
    const updateData = {};

    // Only include changed fields to minimize update size
    Object.keys(updatedApplication).forEach((key) => {
      // Skip _id or id field as they shouldn't be updated
      if (key === "_id" || key === "id") {
        return;
      }
      updateData[key] = updatedApplication[key];
    });

    console.log("Final update data:", JSON.stringify(updateData, null, 2));

    // Save the updated application
    await applicationService.db
      .collection(applicationService.collection)
      .doc(id)
      .update(updateData);

    res.json({
      success: true,
      data: updatedApplication,
      message: "Application updated successfully",
    });
  } catch (error) {
    console.error("❌ Error updating application:", error);

    // Check for specific Firestore errors and provide more helpful messages
    if (error.code === "invalid-argument") {
      console.error("Invalid data format in the update:", error);
      return res.status(400).json({
        success: false,
        error: "Invalid data format in the update request",
        message: error.message,
        details:
          "Check for undefined values or invalid data types in your request",
      });
    }

    res.status(500).json({
      success: false,
      error: error.message,
      message: "Failed to update application",
    });
  }
});

/**
 * Health check endpoint
 * GET /api/applications/health
 */
router.get("/health", (req, res) => {
  console.log("🏥 Health check request received");
  res.json({
    success: true,
    message: "Applications service is up and running",
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    fullUrl: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
  });
});

module.exports = {
  router,
  initializeApplicationService,
};
