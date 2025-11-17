/**
 * Suzy Sheets Routes
 * Routes for managing admitted leads for payment follow-up
 */

const express = require("express");
const router = express.Router();
const suzySheetsService = require("../services/suzySheets.service");
const { authenticate } = require("../middleware/auth.middleware");

/**
 * @route GET /api/suzy-sheets/admitted-leads
 * @desc Get all admitted leads with caching
 * @access Private (admissionAdmin, admissionAgent, admin, superAdmin)
 */
router.get("/admitted-leads", authenticate, async (req, res) => {
  try {
    // Check user role
    const allowedRoles = [
      "superAdmin",
      "admin",
      "admissionAdmin",
      "admissionAgent",
    ];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions.",
      });
    }

    const result = await suzySheetsService.getAdmittedLeads();

    res.json({
      success: true,
      data: result.data,
      cached: result.cached,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error in GET /admitted-leads:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch admitted leads",
      error: error.message,
    });
  }
});

/**
 * @route GET /api/suzy-sheets/lead/:leadId
 * @desc Get a single lead detail
 * @access Private
 */
router.get("/lead/:leadId", authenticate, async (req, res) => {
  try {
    const { leadId } = req.params;

    // Check user role
    const allowedRoles = [
      "superAdmin",
      "admin",
      "admissionAdmin",
      "admissionAgent",
    ];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions.",
      });
    }

    const result = await suzySheetsService.getLeadDetail(leadId);

    res.json({
      success: true,
      data: result.data,
      cached: result.cached,
    });
  } catch (error) {
    console.error(`❌ Error in GET /lead/${req.params.leadId}:`, error);

    if (error.message === "Lead not found") {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to fetch lead detail",
      error: error.message,
    });
  }
});

/**
 * @route PATCH /api/suzy-sheets/lead/:leadId/status
 * @desc Update lead status (ENROLLED, DEFERRED, EXPIRED)
 * @access Private
 */
router.patch("/lead/:leadId/status", authenticate, async (req, res) => {
  try {
    const { leadId } = req.params;
    const { status } = req.body;

    // Check user role
    const allowedRoles = [
      "superAdmin",
      "admin",
      "admissionAdmin",
      "admissionAgent",
    ];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions.",
      });
    }

    // Validate status
    const validStatuses = ["ENROLLED", "DEFERRED", "EXPIRED"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const result = await suzySheetsService.updateLeadStatus(
      leadId,
      status,
      req.user.uid
    );

    res.json({
      success: true,
      message: result.message,
      data: {
        leadId: result.leadId,
        newStatus: result.newStatus,
      },
    });
  } catch (error) {
    console.error(
      `❌ Error in PATCH /lead/${req.params.leadId}/status:`,
      error
    );

    if (error.message === "Lead not found") {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update lead status",
      error: error.message,
    });
  }
});

/**
 * @route PATCH /api/suzy-sheets/lead/:leadId/notes
 * @desc Update Suzy's notes for a lead
 * @access Private
 */
router.patch("/lead/:leadId/notes", authenticate, async (req, res) => {
  try {
    const { leadId } = req.params;
    const { notes } = req.body;

    // Check user role
    const allowedRoles = [
      "superAdmin",
      "admin",
      "admissionAdmin",
      "admissionAgent",
    ];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions.",
      });
    }

    // Validate notes
    if (notes === undefined || notes === null) {
      return res.status(400).json({
        success: false,
        message: "Notes field is required",
      });
    }

    const result = await suzySheetsService.updateLeadNotes(
      leadId,
      notes,
      req.user.uid
    );

    res.json({
      success: true,
      message: result.message,
      data: {
        leadId: result.leadId,
      },
    });
  } catch (error) {
    console.error(`❌ Error in PATCH /lead/${req.params.leadId}/notes:`, error);

    if (error.message === "Lead not found") {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update lead notes",
      error: error.message,
    });
  }
});

/**
 * @route POST /api/suzy-sheets/refresh-cache
 * @desc Force refresh the admitted leads cache
 * @access Private (admin only)
 */
router.post("/refresh-cache", authenticate, async (req, res) => {
  try {
    // Check user role - only admins can force refresh
    const allowedRoles = ["superAdmin", "admin", "admissionAdmin"];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions.",
      });
    }

    const result = await suzySheetsService.refreshAdmittedLeadsCache();

    res.json({
      success: true,
      message: "Cache refreshed successfully",
      data: {
        leadsCount: result.data.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("❌ Error in POST /refresh-cache:", error);
    res.status(500).json({
      success: false,
      message: "Failed to refresh cache",
      error: error.message,
    });
  }
});

/**
 * @route GET /api/suzy-sheets/cache-stats
 * @desc Get cache statistics
 * @access Private (admin only)
 */
router.get("/cache-stats", authenticate, async (req, res) => {
  try {
    // Check user role
    const allowedRoles = ["superAdmin", "admin"];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions.",
      });
    }

    const stats = await suzySheetsService.getCacheStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("❌ Error in GET /cache-stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get cache stats",
      error: error.message,
    });
  }
});

module.exports = router;
