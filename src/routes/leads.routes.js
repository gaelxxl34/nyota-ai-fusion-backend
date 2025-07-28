/**
 * Lead Management Routes
 * Simple API endpoints for lead operations
 */

const express = require("express");
const LeadService = require("../services/leadService");
const { LEAD_STATUSES, LEAD_SOURCES } = require("../config/lead.constants");

const router = express.Router();

// Initialize lead service (will be injected with Firestore instance)
let leadService = null;

// Middleware to ensure lead service is initialized
const ensureLeadService = (req, res, next) => {
  if (!leadService) {
    return res.status(500).json({ error: "Lead service not initialized" });
  }
  next();
};

// Initialize lead service with Firestore
const initializeLeadService = (firestore) => {
  leadService = new LeadService(firestore);
  console.log("✅ Lead service initialized");
};

/**
 * Create a new lead
 * POST /api/leads
 */
router.post("/", ensureLeadService, async (req, res) => {
  try {
    const { contactInfo, source, submittedBy, ...additionalData } = req.body;

    if (!contactInfo) {
      return res.status(400).json({ error: "Contact information is required" });
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

    const leadData = {
      ...additionalData,
      submittedBy: submitterInfo,
    };

    const lead = await leadService.createLead(contactInfo, source, leadData);

    res.status(201).json({
      success: true,
      data: lead,
    });
  } catch (error) {
    console.error("❌ Error creating lead:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get available statuses and sources
 * GET /api/leads/config
 */
router.get("/config", (req, res) => {
  res.json({
    success: true,
    data: {
      statuses: Object.values(LEAD_STATUSES),
      sources: Object.values(LEAD_SOURCES),
    },
  });
});

/**
 * Get lead statistics
 * GET /api/leads/stats
 */
router.get("/stats", ensureLeadService, async (req, res) => {
  try {
    const stats = await leadService.getLeadStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("❌ Error getting lead stats:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get leads due for follow-up
 * GET /api/leads/follow-up/due
 */
router.get("/follow-up/due", ensureLeadService, async (req, res) => {
  try {
    const leads = await leadService.getLeadsDueForFollowUp();

    res.json({
      success: true,
      data: leads,
    });
  } catch (error) {
    console.error("❌ Error getting leads due for follow-up:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Find lead by phone number
 * GET /api/leads/phone/:phoneNumber
 */
router.get("/phone/:phoneNumber", ensureLeadService, async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const lead = await leadService.findLeadByPhone(phoneNumber);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: "Lead not found",
      });
    }

    res.json({
      success: true,
      data: lead,
    });
  } catch (error) {
    console.error("❌ Error finding lead by phone:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Find lead by email
 * GET /api/leads/email/:email
 */
router.get("/email/:email", ensureLeadService, async (req, res) => {
  try {
    const { email } = req.params;
    const lead = await leadService.findLeadByEmail(email);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: "Lead not found",
      });
    }

    res.json({
      success: true,
      data: lead,
    });
  } catch (error) {
    console.error("❌ Error finding lead by email:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get all leads with optimized pagination and filtering
 * GET /api/leads
 */
router.get("/", ensureLeadService, async (req, res) => {
  try {
    const {
      limit = 25,
      offset = 0,
      status,
      source,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    console.log(`📋 API: Fetching leads with query params:`, req.query);

    // Validate limit (max 100)
    const parsedLimit = Math.min(parseInt(limit) || 25, 100);
    const parsedOffset = parseInt(offset) || 0;

    let result;

    if (status && !search && !source) {
      // Optimized path for status-only queries
      const leads = await leadService.getLeadsByStatus(status, parsedLimit);
      result = {
        leads,
        hasMore: leads.length === parsedLimit,
        pagination: {
          limit: parsedLimit,
          offset: parsedOffset,
          hasMore: leads.length === parsedLimit,
          count: leads.length,
        },
      };
    } else {
      // Use the new optimized getAllLeads method
      result = await leadService.getAllLeads({
        limit: parsedLimit,
        offset: parsedOffset,
        status,
        source,
        search,
        sortBy,
        sortOrder,
      });
    }

    console.log(`✅ API: Returning ${result.leads.length} leads`);

    res.json({
      success: true,
      data: result.leads,
      pagination: result.pagination || {
        hasMore: result.hasMore || false,
        limit: parsedLimit,
        offset: parsedOffset,
        count: result.leads.length,
      },
    });
  } catch (error) {
    console.error("❌ Error getting leads:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      data: [],
      pagination: {
        hasMore: false,
        limit: parseInt(req.query.limit) || 25,
        offset: parseInt(req.query.offset) || 0,
        count: 0,
      },
    });
  }
});

/**
 * Get lead by ID
 * GET /api/leads/:id
 */
router.get("/:id", ensureLeadService, async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await leadService.getLeadById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: "Lead not found",
      });
    }

    res.json({
      success: true,
      data: lead,
    });
  } catch (error) {
    console.error("❌ Error getting lead:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Update lead status
 * PUT /api/leads/:id/status
 */
router.put("/:id/status", ensureLeadService, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, updatedBy, forceUpdate = false } = req.body;

    if (!status) {
      return res.status(400).json({ error: "Status is required" });
    }

    if (!Object.values(LEAD_STATUSES).includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const lead = await leadService.updateLeadStatus(
      id,
      status,
      notes,
      updatedBy,
      forceUpdate // Pass the force update flag
    );

    res.json({
      success: true,
      data: lead,
    });
  } catch (error) {
    console.error("❌ Error updating lead status:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Update lead information
 * PUT /api/leads/:id
 */
router.put("/:id", ensureLeadService, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove fields that shouldn't be updated directly
    delete updateData.id;
    delete updateData.createdAt;
    delete updateData.timeline;

    const lead = await leadService.updateLead(id, updateData);

    res.json({
      success: true,
      data: lead,
    });
  } catch (error) {
    console.error("❌ Error updating lead:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Add interaction to lead
 * POST /api/leads/:id/interactions
 */
router.post("/:id/interactions", ensureLeadService, async (req, res) => {
  try {
    const { id } = req.params;
    const interactionData = req.body;

    const lead = await leadService.addInteraction(id, interactionData);

    res.json({
      success: true,
      data: lead,
    });
  } catch (error) {
    console.error("❌ Error adding interaction:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Set follow-up date
 * PUT /api/leads/:id/follow-up
 */
router.put("/:id/follow-up", ensureLeadService, async (req, res) => {
  try {
    const { id } = req.params;
    const { followUpDate } = req.body;

    if (!followUpDate) {
      return res.status(400).json({ error: "Follow-up date is required" });
    }

    const lead = await leadService.setFollowUpDate(id, new Date(followUpDate));

    res.json({
      success: true,
      data: lead,
    });
  } catch (error) {
    console.error("❌ Error setting follow-up date:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Delete a lead
 * DELETE /api/leads/:id
 */
router.delete("/:id", ensureLeadService, async (req, res) => {
  try {
    const { id } = req.params;

    // Get the lead first to ensure it exists
    const lead = await leadService.getLeadById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: "Lead not found",
      });
    }

    // Delete the lead
    await leadService.deleteLead(id);

    res.json({
      success: true,
      message: "Lead deleted successfully",
      data: { id },
    });
  } catch (error) {
    console.error("❌ Error deleting lead:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = {
  router,
  initializeLeadService,
};
