/**
 * Lead Assignment Routes
 * API endpoints for lead assignment operations
 */

const express = require("express");
const { getFirestore } = require("firebase-admin/firestore");
const {
  authenticateUser,
  checkRole,
} = require("../middleware/auth.middleware");
const { LeadModel } = require("../models/lead.model");
const LeadService = require("../services/leadService");

const router = express.Router();
const db = getFirestore();

// Helper to deep-sanitize objects for Firestore (replace undefined with null & remove functions)
function sanitizeForFirestore(value) {
  if (value === undefined) return null; // Firestore disallows undefined
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((v) => sanitizeForFirestore(v));
  if (value instanceof Date) return value; // Dates are fine
  if (typeof value === "object") {
    const cleaned = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "function") continue; // skip functions
      const sanitized = sanitizeForFirestore(v);
      cleaned[k] = sanitized;
    }
    return cleaned;
  }
  return value; // primitives
}

// Initialize lead service if needed
let leadService;

// Middleware to ensure lead service is initialized
const ensureLeadService = (req, res, next) => {
  if (!leadService) {
    leadService = new LeadService(db);
  }
  next();
};

/**
 * IMPORTANT: Order parameterized routes AFTER literal ones.
 * The previous ordering had "/:leadId" BEFORE "/bulk" so POST /bulk
 * was incorrectly treated as assigning leadId="bulk" and returned 404 (Lead not found).
 * We move the bulk route above the parameterized route to fix the 404.
 */

/**
 * Bulk assign leads to users
 * POST /api/lead-assignment/bulk
 */
router.post(
  "/bulk",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin", "marketingManager"]),
  ensureLeadService,
  async (req, res) => {
    try {
      const { leadIds, assignTo, notes } = req.body;

      if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Lead IDs required",
        });
      }

      const assignedBy = {
        email: req.user.email,
        name: req.user.name || req.user.displayName || req.user.email,
        uid: req.user.uid,
        role: req.user.role,
      };

      console.log(
        `📋 Bulk assigning ${leadIds.length} leads to ${
          assignTo?.name || "unassigned"
        }`
      );

      const results = { assigned: 0, failed: 0, errors: [] };

      for (const leadId of leadIds) {
        try {
          const lead = await leadService.getLeadById(leadId);

          if (!lead) {
            results.errors.push({ leadId, error: "Lead not found" });
            results.failed++;
            continue;
          }

          const updatedLead = LeadModel.assignLead(
            lead,
            assignTo,
            assignedBy,
            notes ||
              (assignTo
                ? `Bulk assigned to ${assignTo.name}`
                : "Unassigned in bulk operation")
          );

          // Sanitize updated lead fragment to avoid undefined values
          const updatePayload = sanitizeForFirestore({
            assignedTo: updatedLead.assignedTo,
            assignment: updatedLead.assignment,
            updatedAt: updatedLead.updatedAt,
            timeline: updatedLead.timeline,
          });

          await db.collection("leads").doc(leadId).update(updatePayload);

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

      res.json({ success: true, results });
    } catch (error) {
      console.error("❌ Error in bulk assignment:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * Assign a single lead to a user
 * POST /api/lead-assignment/:leadId
 */
router.post(
  "/:leadId",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin", "marketingManager"]),
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

      const assignedBy = {
        email: req.user.email,
        name: req.user.name || req.user.displayName || req.user.email,
        uid: req.user.uid,
        role: req.user.role,
      };

      console.log(
        `📋 Assigning lead ${leadId} to ${assignTo?.name || "unassigned"}`
      );

      const lead = await leadService.getLeadById(leadId);

      if (!lead) {
        return res
          .status(404)
          .json({ success: false, error: "Lead not found" });
      }

      const updatedLead = LeadModel.assignLead(
        lead,
        assignTo,
        assignedBy,
        notes
      );

      const updatePayload = sanitizeForFirestore({
        assignedTo: updatedLead.assignedTo,
        assignment: updatedLead.assignment,
        updatedAt: updatedLead.updatedAt,
        timeline: updatedLead.timeline,
      });

      await db.collection("leads").doc(leadId).update(updatePayload);

      console.log(
        `✅ Lead ${leadId} assigned to ${assignTo?.email || "unassigned"}`
      );

      res.json({
        success: true,
        data: {
          leadId,
          assignedTo: assignTo
            ? { email: assignTo.email, name: assignTo.name }
            : null,
          assignment: updatedLead.assignment,
        },
      });
    } catch (error) {
      console.error("❌ Error assigning lead:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * Get assigned leads for the current user
 * GET /api/lead-assignment/my-assignments
 */
router.get(
  "/my-assignments",
  authenticateUser,
  ensureLeadService,
  async (req, res) => {
    try {
      const userEmail = req.user?.email;

      if (!userEmail) {
        return res.status(401).json({
          success: false,
          error: "User authentication required",
        });
      }

      // Get optional query parameters
      const {
        status,
        sortBy = "updatedAt",
        sortOrder = "desc",
        limit = 100,
        offset = 0,
      } = req.query;

      console.log(`🔍 Getting assigned leads for user ${userEmail}`);

      // Build query for assigned leads
      let query = db.collection("leads").where("assignedTo", "==", userEmail);

      // Add status filter if provided
      if (status && status !== "ALL") {
        query = query.where("status", "==", status);
      }

      // Apply sorting
      query = query.orderBy(sortBy, sortOrder.toLowerCase());

      // Apply pagination
      query = query.limit(parseInt(limit)).offset(parseInt(offset));

      // Execute query
      const snapshot = await query.get();

      const leads = [];
      snapshot.forEach((doc) => {
        leads.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      res.json({
        success: true,
        data: leads,
        count: leads.length,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      });
    } catch (error) {
      console.error("❌ Error getting assigned leads:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * Get lead assignment history
 * GET /api/lead-assignment/:leadId/history
 */
router.get(
  "/:leadId/history",
  authenticateUser,
  ensureLeadService,
  async (req, res) => {
    try {
      const { leadId } = req.params;

      if (!leadId) {
        return res.status(400).json({
          success: false,
          error: "Lead ID is required",
        });
      }

      // Get the lead
      const lead = await leadService.getLeadById(leadId);

      if (!lead) {
        return res.status(404).json({
          success: false,
          error: "Lead not found",
        });
      }

      // Extract assignment history from timeline
      const assignmentHistory = [];

      if (Array.isArray(lead.timeline)) {
        // Filter timeline for assignment-related actions
        lead.timeline.forEach((entry) => {
          if (["ASSIGNED", "REASSIGNED", "UNASSIGNED"].includes(entry.action)) {
            assignmentHistory.push({
              date: entry.date,
              action: entry.action,
              notes: entry.notes,
              previousAssignee: entry.metadata?.previousAssignee || null,
              newAssignee: entry.metadata?.newAssignee || null,
              assignedBy: entry.metadata?.assignedBy || null,
              assignedByName: entry.metadata?.assignedByName || null,
            });
          }
        });
      }

      // Sort by date (newest first)
      assignmentHistory.sort((a, b) => {
        const dateA = a.date instanceof Date ? a.date : new Date(a.date);
        const dateB = b.date instanceof Date ? b.date : new Date(b.date);
        return dateB - dateA;
      });

      res.json({
        success: true,
        data: {
          leadId,
          currentAssignment: lead.assignment || {
            assignedTo: lead.assignedTo,
          },
          assignmentHistory,
        },
      });
    } catch (error) {
      console.error("❌ Error getting lead assignment history:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * Get marketing agents for assignment
 * GET /api/lead-assignment/available-agents
 */
router.get(
  "/available-agents",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin", "marketingManager"]),
  async (req, res) => {
    try {
      console.log("📋 Fetching marketing agents for lead assignment...");

      // Get users with appropriate roles for lead assignment
      const usersSnapshot = await db
        .collection("users")
        .where("role", "in", [
          "marketingAgent",
          "marketingManager",
          "admissionAgent",
        ])
        .where("status", "==", "active")
        .get();

      const agents = [];

      // Process each user
      for (const userDoc of usersSnapshot.docs) {
        const user = {
          id: userDoc.id,
          ...userDoc.data(),
        };

        // Count assigned leads for this agent
        const assignedLeadsCount = await db
          .collection("leads")
          .where("assignedTo", "==", user.email)
          .count()
          .get();

        // Set maxCapacity to a high number - no practical limit
        // If user has a specific capacity preference, we'll still respect that
        const maxCapacity = user.leadCapacity || 1000;

        agents.push({
          uid: user.id,
          email: user.email,
          name: user.name || user.displayName || user.email,
          role: user.role,
          maxCapacity,
          assignedCount: assignedLeadsCount.data().count,
          department: user.department || "Marketing",
          available: true,
        });
      }

      // Sort by availability (least assigned first)
      agents.sort((a, b) => {
        const aAvailability = (a.maxCapacity - a.assignedCount) / a.maxCapacity;
        const bAvailability = (b.maxCapacity - b.assignedCount) / b.maxCapacity;
        return bAvailability - aAvailability;
      });

      res.json({
        success: true,
        data: agents,
      });
    } catch (error) {
      console.error("❌ Error getting marketing agents:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

module.exports = router;
