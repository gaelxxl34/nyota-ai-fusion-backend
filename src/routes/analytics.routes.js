const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permissions.middleware");
const { PERMISSIONS } = require("../config/roles.config");
const analyticsService = require("../services/analytics.service");
const logger = require("../utils/logger");

/**
 * @route   GET /api/analytics/test
 * @desc    Test endpoint to verify analytics routes are working
 * @access  Public
 */
router.get("/test", (req, res) => {
  console.log("=== ANALYTICS TEST ENDPOINT HIT ===");
  res.json({
    success: true,
    message: "Analytics routes are working!",
    timestamp: new Date().toISOString(),
  });
});

/**
 * @route   GET /api/analytics/overview
 * @desc    Get analytics overview with status counts and trends
 * @access  Private - Requires authentication
 * @query   timeRange - 'daily', 'weekly', or 'monthly'
 */
router.get(
  "/overview",
  authenticateUser,
  requirePermission(PERMISSIONS.ANALYTICS),
  async (req, res) => {
    try {
      console.log("=== ANALYTICS OVERVIEW ENDPOINT HIT ===");
      const { timeRange = "daily" } = req.query;

      // Extract organizationId and role from user object
      const organizationId =
        req.user?.organizationId || req.user?.orgId || "iuea";
      const userRole = req.user?.role || req.user?.jobRole;

      console.log("Request details:", {
        timeRange,
        organizationId,
        userRole,
        user: req.user?.email,
        fullUser: req.user,
        headers: req.headers.authorization,
      });

      logger.info(
        `Fetching analytics overview for org: ${organizationId}, timeRange: ${timeRange}, role: ${userRole}`
      );

      const overview = await analyticsService.getOverviewStats(
        timeRange,
        userRole
      );

      res.json({
        success: true,
        data: overview,
      });
    } catch (error) {
      logger.error("Error fetching analytics overview:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch analytics overview",
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /api/analytics/lead-progression
 * @desc    Get lead progression data over time
 * @access  Private - Requires authentication
 * @query   timeRange - 'daily', 'weekly', or 'monthly'
 */
router.get(
  "/lead-progression",
  authenticateUser,
  requirePermission(PERMISSIONS.ANALYTICS),
  async (req, res) => {
    try {
      console.log("=== ANALYTICS LEAD PROGRESSION ENDPOINT HIT ===");
      const { timeRange = "daily" } = req.query;

      // Extract organizationId and role from user object
      const organizationId =
        req.user?.organizationId || req.user?.orgId || "iuea";
      const userRole = req.user?.role || req.user?.jobRole;

      console.log("Lead progression request:", {
        timeRange,
        organizationId,
        userRole,
      });

      logger.info(
        `Fetching lead progression for org: ${organizationId}, timeRange: ${timeRange}, role: ${userRole}`
      );

      const progression = await analyticsService.getLeadProgression(
        timeRange,
        userRole
      );

      res.json({
        success: true,
        data: progression,
      });
    } catch (error) {
      logger.error("Error fetching lead progression:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch lead progression",
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /api/analytics/agent-performance
 * @desc    Get performance metrics for each agent
 * @access  Private - Requires authentication
 * @query   timeRange - 'daily', 'weekly', or 'monthly'
 */
router.get(
  "/agent-performance",
  authenticateUser,
  requirePermission(PERMISSIONS.ANALYTICS),
  async (req, res) => {
    try {
      console.log("=== ANALYTICS AGENT PERFORMANCE ENDPOINT HIT ===");
      const { timeRange = "daily" } = req.query;

      // Extract organizationId and role from user object
      const organizationId =
        req.user?.organizationId || req.user?.orgId || "iuea";
      const role = req.user?.role || req.user?.jobRole;

      console.log("Agent performance request:", {
        timeRange,
        organizationId,
        role,
      });

      logger.info(
        `Fetching agent performance for org: ${organizationId}, timeRange: ${timeRange}`
      );

      const performance = await analyticsService.getAgentPerformance(
        timeRange,
        role
      );

      res.json({
        success: true,
        data: performance,
      });
    } catch (error) {
      logger.error("Error fetching agent performance:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch agent performance",
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /api/analytics/conversion-rates
 * @desc    Get conversion rates between different lead stages
 * @access  Private - Requires authentication
 * @query   timeRange - 'daily', 'weekly', or 'monthly'
 */
router.get(
  "/conversion-rates",
  authenticateUser,
  requirePermission(PERMISSIONS.ANALYTICS),
  async (req, res) => {
    try {
      console.log("=== ANALYTICS CONVERSION RATES ENDPOINT HIT ===");
      const { timeRange = "daily" } = req.query;

      // Extract organizationId and role from user object
      const organizationId =
        req.user?.organizationId || req.user?.orgId || "iuea";
      const userRole = req.user?.role || req.user?.jobRole;

      console.log("Conversion rates request:", {
        timeRange,
        organizationId,
        userRole,
      });

      logger.info(
        `Fetching conversion rates for org: ${organizationId}, timeRange: ${timeRange}, role: ${userRole}`
      );

      const rates = await analyticsService.getConversionRates(
        timeRange,
        userRole
      );

      res.json({
        success: true,
        data: rates,
      });
    } catch (error) {
      logger.error("Error fetching conversion rates:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch conversion rates",
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /api/analytics/export
 * @desc    Export analytics data as CSV
 * @access  Private - Requires authentication
 * @query   timeRange - 'daily', 'weekly', or 'monthly'
 * @query   format - 'csv' or 'json'
 */
router.get(
  "/export",
  authenticateUser,
  requirePermission(PERMISSIONS.EXPORT_DATA),
  async (req, res) => {
    try {
      const { timeRange = "daily", format = "csv" } = req.query;
      const userRole = req.user?.role || req.user?.jobRole;

      logger.info(
        `Exporting analytics data, timeRange: ${timeRange}, format: ${format}`
      );

      const exportData = await analyticsService.exportAnalyticsData(
        timeRange,
        format,
        userRole
      );

      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=analytics-${timeRange}-${
            new Date().toISOString().split("T")[0]
          }.csv`
        );
        res.send(exportData);
      } else {
        res.json({
          success: true,
          data: exportData,
        });
      }
    } catch (error) {
      logger.error("Error exporting analytics data:", error);
      res.status(500).json({
        success: false,
        message: "Failed to export analytics data",
        error: error.message,
      });
    }
  }
);

module.exports = router;
