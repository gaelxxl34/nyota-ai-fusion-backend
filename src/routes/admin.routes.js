const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");
const db = admin.firestore();
const { authenticateUser } = require("../middleware/auth.middleware");
const { checkRole } = require("../middleware/permissions.middleware");

// Get system statistics for admin dashboard
router.get(
  "/stats",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      // Get total leads count
      const leadsSnapshot = await db.collection("leads").get();
      const totalLeads = leadsSnapshot.size;

      // Get active leads count
      const activeLeadsSnapshot = await db
        .collection("leads")
        .where("status", "in", ["new", "contacted", "qualified"])
        .get();
      const activeLeads = activeLeadsSnapshot.size;

      // Get applications count
      const applicationsSnapshot = await db.collection("applications").get();
      const totalApplications = applicationsSnapshot.size;

      // Get team members count (excluding super admins)
      const usersSnapshot = await db.collection("users").get();
      const teamMembers = usersSnapshot.docs.filter((doc) => {
        const userData = doc.data();
        return userData.role !== "superAdmin";
      }).length;

      res.json({
        success: true,
        stats: {
          totalLeads,
          activeLeads,
          totalApplications,
          teamMembers,
          conversionRate:
            totalLeads > 0
              ? ((totalApplications / totalLeads) * 100).toFixed(1)
              : 0,
        },
      });
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch statistics",
        error: error.message,
      });
    }
  }
);

// Get recent activities
router.get(
  "/activities",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 10;

      // Get recent leads
      const recentLeadsSnapshot = await db
        .collection("leads")
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();

      const activities = recentLeadsSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          type: "lead",
          message: `New lead: ${data.name}`,
          timestamp: data.createdAt,
          details: {
            name: data.name,
            email: data.email,
            status: data.status,
          },
        };
      });

      res.json({
        success: true,
        activities,
      });
    } catch (error) {
      console.error("Error fetching activities:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch activities",
        error: error.message,
      });
    }
  }
);

// Get performance metrics
router.get(
  "/performance",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      let query = db.collection("leads");

      if (startDate && endDate) {
        query = query
          .where("createdAt", ">=", new Date(startDate))
          .where("createdAt", "<=", new Date(endDate));
      }

      const leadsSnapshot = await query.get();

      // Calculate metrics by status
      const statusCounts = {};
      leadsSnapshot.docs.forEach((doc) => {
        const status = doc.data().status || "unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });

      res.json({
        success: true,
        metrics: {
          total: leadsSnapshot.size,
          byStatus: statusCounts,
          period: {
            startDate: startDate || "all-time",
            endDate: endDate || "all-time",
          },
        },
      });
    } catch (error) {
      console.error("Error fetching performance metrics:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch performance metrics",
        error: error.message,
      });
    }
  }
);

module.exports = router;
