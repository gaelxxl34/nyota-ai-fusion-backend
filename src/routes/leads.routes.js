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
const { LeadModel } = require("../models/lead.model");

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
 * Get conversion leads (CONTACTED + INTERESTED) with caching
 * GET /api/leads/conversion
 */
router.get("/conversion", ensureLeadService, async (req, res) => {
  try {
    const {
      limit = 10000,
      offset = 0,
      sortBy = "createdAt",
      sortOrder = "desc",
      useCache = true,
    } = req.query;

    console.log(`📋 API: Fetching conversion leads (CONTACTED + INTERESTED)`);

    // Check cache first if enabled
    if (useCache === "true" || useCache === true) {
      const cachedData = await leadService.getCachedConversionLeads();
      if (cachedData) {
        console.log(
          `⚡ Retrieved ${cachedData.length} conversion leads from cache`
        );
        return res.json({
          success: true,
          data: cachedData,
          cached: true,
          pagination: {
            limit: cachedData.length,
            offset: 0,
            hasMore: false,
            count: cachedData.length,
          },
        });
      }
    }

    // Fetch fresh data
    const statusPromises = ["CONTACTED", "INTERESTED"].map(async (status) => {
      try {
        console.log(`📊 Fetching leads for status: ${status}`);
        const leads = await leadService.getLeadsByStatus(
          status,
          parseInt(limit),
          {
            sortBy,
            sortOrder,
            offset: parseInt(offset),
            useCache: false, // Don't use individual status cache when building conversion cache
          }
        );

        return leads.map((lead) => ({
          ...lead,
          status: status.toLowerCase(),
          contactedDate: lead.createdAt,
          priority: (() => {
            const currentDate = new Date();
            const leadDate = new Date(lead.createdAt);
            const daysDifference = Math.floor(
              (currentDate - leadDate) / (1000 * 60 * 60 * 24)
            );

            if (daysDifference <= 3) return "high";
            else if (daysDifference <= 10) return "medium";
            else return "low";
          })(),
        }));
      } catch (error) {
        console.error(`❌ Error fetching leads for status ${status}:`, error);
        return [];
      }
    });

    // Wait for both status fetches to complete
    const statusResults = await Promise.all(statusPromises);
    const allLeads = statusResults.flat();

    // Sort by creation date (newest first)
    allLeads.sort((a, b) => {
      const dateA =
        a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt || 0);
      const dateB =
        b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt || 0);
      return dateB - dateA;
    });

    console.log(`✅ API: Combined ${allLeads.length} conversion leads`);

    // Cache the results if caching is enabled
    if (useCache === "true" || useCache === true) {
      await leadService.cacheConversionLeads(allLeads);
    }

    res.json({
      success: true,
      data: allLeads,
      cached: false,
      pagination: {
        limit: allLeads.length,
        offset: 0,
        hasMore: false,
        count: allLeads.length,
      },
    });
  } catch (error) {
    console.error("❌ Error getting conversion leads:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      data: [],
      cached: false,
    });
  }
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
      name,
      email,
      phone,
      program,
      dateRange,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    console.log(`📋 API: Fetching leads with query params:`, req.query);

    // Validate limit - Allow pagination limits (200, 400, 1000) for data center, higher limits for analytics
    const requestedLimit = parseInt(limit) || 50;
    const parsedLimit =
      requestedLimit > 1000
        ? Math.min(requestedLimit, 5000) // Analytics queries
        : Math.min(requestedLimit, 1000); // Regular pagination queries
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
        name,
        email,
        phone,
        program,
        dateRange,
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
 * Get marketing agents for assignment
 * GET /api/leads/marketing-agents
 */
router.get("/marketing-agents", async (req, res) => {
  try {
    console.log("📋 Fetching marketing agents for lead assignment...");

    // Get all users with marketing agent role
    const usersSnapshot = await db
      .collection("users")
      .where("role", "==", "marketingAgent")
      .get();

    console.log(
      `📋 Found ${usersSnapshot.docs.length} users with marketingAgent role`
    );

    const marketingAgents = [];

    // Process each marketing agent
    for (const doc of usersSnapshot.docs) {
      const user = doc.data();
      console.log(`📋 Processing user: ${user.email}, role: ${user.role}`);

      // Count assigned leads for this agent
      const assignedLeadsCount = await db
        .collection("leads")
        .where("assignedTo", "==", user.email)
        .where("status", "in", ["CONTACTED", "INTERESTED"])
        .count()
        .get();

      marketingAgents.push({
        uid: doc.id,
        name: user.displayName || user.name || user.email.split("@")[0],
        email: user.email,
        avatar: user.photoURL || null,
        assignedCount: assignedLeadsCount.data().count,
        status:
          user.lastActiveAt && new Date() - new Date(user.lastActiveAt) < 300000
            ? "online"
            : "offline",
        conversionRate: user.conversionRate || 0,
        maxCapacity: user.maxLeadCapacity || 50,
        role: "marketingAgent",
      });
    }

    // Sort by availability (least assigned first)
    marketingAgents.sort((a, b) => {
      const aAvailability = (a.maxCapacity - a.assignedCount) / a.maxCapacity;
      const bAvailability = (b.maxCapacity - b.assignedCount) / b.maxCapacity;
      return bAvailability - aAvailability;
    });

    console.log(`✅ Found ${marketingAgents.length} marketing agents`);

    res.json({
      success: true,
      data: marketingAgents,
    });
  } catch (error) {
    console.error("❌ Error fetching marketing agents:", error);
    res.status(500).json({
      success: false,
      error: error.message,
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
router.post(
  "/:id/interactions",
  authenticateUser,
  ensureLeadService,
  async (req, res) => {
    try {
      const { id } = req.params;
      const interactionData = req.body;

      // Validate required fields
      if (!interactionData.type) {
        return res.status(400).json({
          success: false,
          error: "Interaction type is required",
        });
      }

      if (!interactionData.notes || interactionData.notes.trim() === "") {
        return res.status(400).json({
          success: false,
          error: "Interaction notes are required",
        });
      }

      // Add authenticated user info to interaction data
      if (req.user) {
        interactionData.agentInfo = {
          uid: req.user.uid,
          email: req.user.email,
          name: req.user.displayName || req.user.name || req.user.email,
          role: req.user.role,
        };

        // Set agent field if not provided
        if (!interactionData.agent) {
          interactionData.agent =
            req.user.displayName || req.user.name || req.user.email;
        }
      }

      console.log(`📝 API: Adding interaction to lead ${id}:`, {
        type: interactionData.type,
        direction: interactionData.direction,
        outcome: interactionData.outcome,
        agent: interactionData.agent,
        hasNextAction: !!interactionData.nextAction,
      });

      const lead = await leadService.addInteraction(id, interactionData);

      res.json({
        success: true,
        data: lead,
        message: "Interaction logged successfully",
      });
    } catch (error) {
      console.error("❌ Error adding interaction:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * Get interactions for a lead
 * GET /api/leads/:id/interactions
 */
router.get(
  "/:id/interactions",
  authenticateUser,
  ensureLeadService,
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        type,
        outcome,
        agent,
        limit = 50,
        offset = 0,
        sortBy = "date",
        sortOrder = "desc",
      } = req.query;

      const lead = await leadService.getLeadById(id);
      if (!lead) {
        return res.status(404).json({
          success: false,
          error: "Lead not found",
        });
      }

      // Extract interactions from timeline
      let interactions = (lead.timeline || [])
        .filter((entry) => entry.action === "INTERACTION" && entry.interaction)
        .map((entry) => ({
          id: entry.interaction.id,
          date: entry.date,
          type: entry.interaction.type,
          direction: entry.interaction.direction,
          duration: entry.interaction.duration,
          outcome: entry.interaction.outcome,
          sentiment: entry.interaction.sentiment,
          interactionTag: entry.interaction.interactionTag,
          priority: entry.interaction.priority,
          agent: entry.interaction.agent,
          agentId: entry.interaction.agentId,
          notes: entry.notes,
          nextAction: entry.interaction.nextAction,
          nextActionDate: entry.interaction.nextActionDate,
          subject: entry.interaction.subject,
          attachments: entry.interaction.attachments || [],
          conversationId: entry.interaction.conversationId,
          conversionImpact: entry.interaction.conversionImpact,
          createdAt: entry.interaction.createdAt,
          // Map to frontend expected format
          timestamp: entry.date,
          status: "completed",
        }));

      // Apply filters
      if (type) {
        interactions = interactions.filter((i) =>
          i.type.toLowerCase().includes(type.toLowerCase())
        );
      }
      if (outcome) {
        interactions = interactions.filter((i) => i.outcome === outcome);
      }
      if (agent) {
        interactions = interactions.filter(
          (i) =>
            i.agent?.toLowerCase().includes(agent.toLowerCase()) ||
            i.agentId === agent
        );
      }

      // Sort interactions
      interactions.sort((a, b) => {
        let valueA = a[sortBy];
        let valueB = b[sortBy];

        if (sortBy === "date" || sortBy === "timestamp") {
          valueA = new Date(valueA);
          valueB = new Date(valueB);
        }

        if (sortOrder === "desc") {
          return valueB > valueA ? 1 : -1;
        } else {
          return valueA > valueB ? 1 : -1;
        }
      });

      // Apply pagination
      const parsedLimit = parseInt(limit);
      const parsedOffset = parseInt(offset);
      const paginatedInteractions = interactions.slice(
        parsedOffset,
        parsedOffset + parsedLimit
      );

      res.json({
        success: true,
        data: paginatedInteractions,
        pagination: {
          total: interactions.length,
          limit: parsedLimit,
          offset: parsedOffset,
          hasMore: parsedOffset + parsedLimit < interactions.length,
        },
        summary: lead.interactionSummary || {},
      });
    } catch (error) {
      console.error("❌ Error getting lead interactions:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

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

/**
 * Assign a single lead to a user
 * POST /api/leads/:leadId/assign
 */
router.post(
  "/:leadId/assign",
  authenticateUser,
  ensureLeadService,
  async (req, res) => {
    try {
      const { leadId } = req.params;
      const { assignTo, notes } = req.body;

      if (!leadId) {
        return res.status(400).json({
          success: false,
          error: "Lead ID is required",
        });
      }

      // Get current user making the assignment
      const assignedBy = {
        email: req.user.email,
        name: req.user.name || req.user.displayName || req.user.email,
        uid: req.user.uid,
        role: req.user.role,
      };

      console.log(
        `📋 Assigning lead ${leadId} to ${assignTo?.name || "unassigned"}`
      );

      // Get the lead
      const lead = await leadService.getLeadById(leadId);

      if (!lead) {
        return res.status(404).json({
          success: false,
          error: "Lead not found",
        });
      }

      // Use the LeadModel.assignLead method for assignment
      const updatedLead = LeadModel.assignLead(
        lead,
        assignTo,
        assignedBy,
        notes
      );

      // Update the lead in Firestore
      await db.collection("leads").doc(leadId).update({
        assignedTo: updatedLead.assignedTo,
        assignment: updatedLead.assignment,
        updatedAt: updatedLead.updatedAt,
        timeline: updatedLead.timeline,
      });

      console.log(
        `✅ Lead ${leadId} assigned to ${assignTo?.email || "unassigned"}`
      );

      res.json({
        success: true,
        data: {
          leadId,
          assignedTo: assignTo
            ? {
                email: assignTo.email,
                name: assignTo.name,
              }
            : null,
          assignment: updatedLead.assignment,
        },
      });
    } catch (error) {
      console.error("❌ Error assigning lead:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * Bulk assign leads to marketing agents
 * POST /api/leads/bulk-assign
 */
router.post(
  "/bulk-assign",
  authenticateUser,
  ensureLeadService,
  async (req, res) => {
    try {
      const { leadIds, assignTo, assignedBy } = req.body;

      if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Lead IDs required",
        });
      }

      console.log(
        `📋 Bulk assigning ${leadIds.length} leads to ${
          assignTo?.name || "unassigned"
        }`
      );

      const results = { assigned: 0, failed: 0, errors: [] };
      const timestamp = new Date();

      // Process each lead
      for (const leadId of leadIds) {
        try {
          const lead = await leadService.getLeadById(leadId);

          if (!lead) {
            results.errors.push({ leadId, error: "Lead not found" });
            results.failed++;
            continue;
          }

          // Use the LeadModel.assignLead method for consistent assignment logic
          const updatedLead = LeadModel.assignLead(
            lead,
            assignTo,
            assignedBy,
            assignTo
              ? `Bulk assigned to ${assignTo.name}`
              : "Unassigned in bulk operation"
          );

          // Update the lead in Firestore
          await db.collection("leads").doc(leadId).update({
            assignedTo: updatedLead.assignedTo,
            assignment: updatedLead.assignment,
            updatedAt: updatedLead.updatedAt,
            timeline: updatedLead.timeline,
          });

          results.assigned++;

          console.log(
            `✅ Lead ${leadId} assigned to ${assignTo?.email || "unassigned"}`
          );
        } catch (error) {
          console.error(`❌ Error assigning lead ${leadId}:`, error);
          results.errors.push({ leadId, error: error.message });
          results.failed++;
        }
      }

      console.log(
        `✅ Bulk assignment completed: ${results.assigned} assigned, ${results.failed} failed`
      );

      res.json({
        success: true,
        results,
      });
    } catch (error) {
      console.error("❌ Error in bulk assignment:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

module.exports = router;
module.exports.initLeadService = initLeadService;
