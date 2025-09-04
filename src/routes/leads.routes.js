/**
 * Lead Management Routes
 * Simple API endpoints for lead operations
 */

const express = require("express");
const LeadService = require("../services/leadService");
const WhatsAppMessageService = require("../services/whatsappMessageService");
const ConversationService = require("../services/conversationService");
const { getFirestore } = require("firebase-admin/firestore");
const { LEAD_STATUSES, LEAD_SOURCES } = require("../config/lead.constants");
const { authenticateUser } = require("../middleware/auth.middleware");

const router = express.Router();

// Initialize services for conversation creation
const db = getFirestore();
const conversationService = new ConversationService(db);
const whatsappMessageService = new WhatsAppMessageService(
  db,
  null,
  conversationService
);

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
// Function to initialize the lead service with Firestore instance
const initLeadService = (firestore) => {
  leadService = new LeadService(firestore);
  // Update the WhatsAppMessageService with the initialized leadService
  whatsappMessageService.leadService = leadService;
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

    // Create the lead
    const lead = await leadService.createLead(contactInfo, source, leadData);

    // If this lead has a phone number and was created from a WhatsApp validation,
    // create a conversation and link it to the lead
    if (lead && contactInfo.phone && req.body.whatsappValidationMessageId) {
      try {
        console.log(
          `Creating conversation for validated lead ${lead.id} with message ID ${req.body.whatsappValidationMessageId}`
        );

        // Create the conversation from the validation message
        const conversationResult =
          await whatsappMessageService.createConversationForValidatedNumber(
            req.body.whatsappValidationMessageId,
            {
              leadId: lead.id,
              contactName: contactInfo.name || contactInfo.firstName || null,
            }
          );

        if (conversationResult.success) {
          console.log(
            `✅ Created conversation ${conversationResult.conversationId} for lead ${lead.id}`
          );
          // Add conversation ID to the lead response
          lead.conversationId = conversationResult.conversationId;
        } else {
          console.error(
            `❌ Failed to create conversation for lead ${lead.id}: ${conversationResult.error}`
          );
        }
      } catch (convError) {
        console.error(
          `❌ Error creating conversation for lead ${lead.id}: ${convError.message}`
        );
        // Continue with lead creation even if conversation linking fails
      }
    }

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
      limit = 50,
      offset = 0,
      status,
      source,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    console.log(`📋 API: Fetching leads with query params:`, req.query);

    // Validate limit - Allow higher limits for analytics (max 5000), regular queries (max 100)
    const requestedLimit = parseInt(limit) || 50;
    const parsedLimit =
      requestedLimit > 1000
        ? Math.min(requestedLimit, 5000)
        : Math.min(requestedLimit, 100);
    const parsedOffset = parseInt(offset) || 0;

    console.log(
      `📋 API: Using limit ${parsedLimit} (requested: ${requestedLimit})`
    );

    let result;

    if (status && !search && !source) {
      // Optimized path for status-only queries with consistent sorting
      const leads = await leadService.getLeadsByStatus(status, parsedLimit, {
        sortBy,
        sortOrder,
        offset: parsedOffset,
      });
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
        limit: parseInt(req.query.limit) || 50,
        offset: parseInt(req.query.offset) || 0,
        count: 0,
      },
    });
  }
});

/**
 * Get leads submitted by current user (for "For You" tab)
 * GET /api/leads/my-submissions
 */
router.get(
  "/my-submissions",
  authenticateUser,
  ensureLeadService,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 50,
        status,
        sortBy = "createdAt",
        sortOrder = "desc",
        all = false,
      } = req.query;
      const numericLimit = parseInt(limit);
      const offset = (page - 1) * numericLimit;

      // Get user info from request (set by auth middleware)
      const userEmail = req.user?.email;
      if (!userEmail) {
        return res.status(401).json({
          success: false,
          error: "User authentication required",
        });
      }

      console.log(
        `🔍 Getting leads for user ${userEmail} (submitted by AND updated by) with sorting: ${sortBy} ${sortOrder} all=${all}`
      );

      let leads;
      if (all === "true") {
        // Fetch all leads up to a safe maximum (to avoid unbounded memory usage)
        const MAX_ALL_LIMIT = 10000; // safety cap
        leads = await leadService.getLeadsForUser(userEmail, {
          limit: MAX_ALL_LIMIT,
          offset: 0,
          status,
          sortBy,
          sortOrder,
        });
      } else {
        // Paginated fetch
        leads = await leadService.getLeadsForUser(userEmail, {
          limit: numericLimit,
          offset,
          status,
          sortBy,
          sortOrder,
        });
      }

      res.json({
        success: true,
        data: leads,
        pagination:
          all === "true"
            ? {
                total: leads.length,
                limit: leads.length,
                offset: 0,
                hasMore: false,
              }
            : undefined,
      });
    } catch (error) {
      console.error("❌ Error getting user's submitted leads:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

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
router.put(
  "/:id/status",
  authenticateUser,
  ensureLeadService,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, notes, updatedBy, forceUpdate = false } = req.body;

      if (!status) {
        return res.status(400).json({ error: "Status is required" });
      }

      if (!Object.values(LEAD_STATUSES).includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      // Use authenticated user info if updatedBy is not provided or is generic
      let finalUpdatedBy = updatedBy;
      if (req.user && (!updatedBy || updatedBy === "frontend_user")) {
        finalUpdatedBy =
          req.user.displayName ||
          req.user.name ||
          req.user.email ||
          "Unknown User";
      }

      const lead = await leadService.updateLeadStatus(
        id,
        status,
        notes,
        finalUpdatedBy,
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
  }
);

/**
 * Update lead information
 * PUT /api/leads/:id
 */
router.put("/:id", authenticateUser, ensureLeadService, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove fields that shouldn't be updated directly
    delete updateData.id;
    delete updateData.createdAt;
    delete updateData.timeline;

    // Add user information for tracking updates
    if (req.user) {
      updateData.lastUpdatedBy = {
        email: req.user.email || "unknown@system.com",
        name:
          req.user.displayName ||
          req.user.name ||
          req.user.email ||
          "Unknown User",
        role: req.user.role || "unknown",
        uid: req.user.uid,
        updatedAt: new Date().toISOString(),
      };
    }

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

/**
 * Export leads to CSV
 * GET /api/leads/export
 */
router.get("/export", ensureLeadService, async (req, res) => {
  try {
    const {
      status = "INTERESTED", // Default to interested people
      format = "csv",
      includeAll = false,
    } = req.query;

    console.log(`📋 Exporting leads with status: ${status || "ALL"}`);

    let leads = [];

    if (includeAll === "true" || !status) {
      // Export all leads
      const result = await leadService.getAllLeads({ limit: 10000 });
      leads = result.leads;
    } else {
      // Export leads by specific status
      if (!Object.values(LEAD_STATUSES).includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status. Valid statuses: ${Object.values(
            LEAD_STATUSES
          ).join(", ")}`,
        });
      }
      leads = await leadService.getLeadsByStatus(status, 10000);
    }

    console.log(`📊 Found ${leads.length} leads to export`);

    if (format === "csv") {
      // Helper functions for CSV generation
      const csvEscape = (value) => {
        if (value === null || value === undefined) return "";
        const str = String(value);
        if (str.includes(",") || str.includes("\n") || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const formatDate = (date) => {
        if (!date) return "";
        try {
          if (date._seconds) {
            date = new Date(date._seconds * 1000);
          } else if (typeof date === "string") {
            date = new Date(date);
          }
          if (date instanceof Date && !isNaN(date)) {
            return date.toISOString().split("T")[0];
          }
        } catch (error) {
          console.warn("Error formatting date:", error);
        }
        return "";
      };

      const formatProgram = (program) => {
        if (!program) return "";
        if (typeof program === "string") return program;
        if (typeof program === "object") {
          return program.name || program.code || program.title || "";
        }
        return String(program);
      };

      const getSubmittedBy = (lead) => {
        if (!lead.submittedBy) return "";
        if (typeof lead.submittedBy === "string") return lead.submittedBy;
        if (typeof lead.submittedBy === "object") {
          return (
            lead.submittedBy.name ||
            lead.submittedBy.email ||
            lead.submittedBy.uid ||
            ""
          );
        }
        return "";
      };

      const getLatestStatus = (lead) => {
        if (!lead.timeline || !Array.isArray(lead.timeline)) {
          return lead.status || "UNKNOWN";
        }
        const sortedTimeline = [...lead.timeline].sort((a, b) => {
          const dateA = a.date
            ? new Date(a.date._seconds ? a.date._seconds * 1000 : a.date)
            : new Date(0);
          const dateB = b.date
            ? new Date(b.date._seconds ? b.date._seconds * 1000 : b.date)
            : new Date(0);
          return dateB - dateA;
        });
        const latestEntry = sortedTimeline.find((entry) => entry.status);
        return latestEntry ? latestEntry.status : lead.status || "UNKNOWN";
      };

      // Define CSV headers
      const headers = [
        "ID",
        "Name",
        "Email",
        "Phone",
        "WhatsApp Number",
        "Status",
        "Source",
        "Program of Interest",
        "Priority",
        "Created Date",
        "Last Updated",
        "Last Interaction",
        "Total Interactions",
        "Submitted By",
        "Assigned To",
        "Next Follow Up",
        "Notes",
        "Tags",
      ];

      // Create CSV content
      let csvContent = headers.map(csvEscape).join(",") + "\n";

      // Process each lead
      for (const lead of leads) {
        const currentStatus = getLatestStatus(lead);

        const row = [
          csvEscape(lead.id),
          csvEscape(lead.name || ""),
          csvEscape(lead.email || ""),
          csvEscape(lead.phone || ""),
          csvEscape(lead.whatsappNumber || lead.phone || ""),
          csvEscape(currentStatus),
          csvEscape(lead.source || ""),
          csvEscape(
            formatProgram(lead.program || lead.programOfInterest || "")
          ),
          csvEscape(lead.priority || ""),
          csvEscape(formatDate(lead.createdAt)),
          csvEscape(formatDate(lead.updatedAt)),
          csvEscape(formatDate(lead.lastInteractionAt)),
          csvEscape(lead.totalInteractions || 0),
          csvEscape(getSubmittedBy(lead)),
          csvEscape(lead.assignedTo || ""),
          csvEscape(formatDate(lead.nextFollowUpDate)),
          csvEscape(lead.notes || ""),
          csvEscape(
            Array.isArray(lead.tags) ? lead.tags.join("; ") : lead.tags || ""
          ),
        ];

        csvContent += row.join(",") + "\n";
      }

      // Set headers for file download
      const filename =
        status && !includeAll
          ? `${status.toLowerCase()}-leads-${
              new Date().toISOString().split("T")[0]
            }.csv`
          : `all-leads-${new Date().toISOString().split("T")[0]}.csv`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );

      res.send(csvContent);
    } else {
      // JSON format
      res.json({
        success: true,
        data: leads,
        count: leads.length,
        exportedAt: new Date().toISOString(),
        filters: {
          status: status || "ALL",
          format,
        },
      });
    }
  } catch (error) {
    console.error("❌ Error exporting leads:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
module.exports.initLeadService = initLeadService;
