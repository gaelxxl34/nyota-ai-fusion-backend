/**
 * Organization Management Routes
 * API endpoints for organization operations
 */

const express = require("express");
const router = express.Router();

// GET /api/organization - Get organization details
router.get("/", (req, res) => {
  res.json({ message: "Organization API endpoint" });
});

// Import team routes
const teamRoutes = require("./team.routes");

// Use team routes as a sub-route
router.use("/team", teamRoutes);

module.exports = router;
