/**
 * Application Routes
 * RESTful API endpoints for application management
 */

const express = require("express");
const ApplicationService = require("../services/applicationService");
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
  whatsappMessageService
) => {
  applicationService = new ApplicationService(
    firestore,
    leadService,
    whatsappMessageService
  );
  console.log("✅ Application service initialized");
};

/**
 * Submit a new application
 * POST /api/applications/submit
 */
router.post("/submit", ensureApplicationService, async (req, res) => {
  try {
    const { submittedBy, ...applicationData } = req.body;

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
    const { submittedBy, ...applicationData } = req.body;

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
 * Get application by email
 * GET /api/applications/email/:email
 */
router.get("/email/:email", ensureApplicationService, async (req, res) => {
  try {
    const { email } = req.params;
    const applications = await applicationService.getApplicationsByEmail(email);

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

module.exports = {
  router,
  initializeApplicationService,
};
