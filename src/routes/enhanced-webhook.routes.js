/*
 * ENHANCED WEBHOOK ROUTES - COMMENTED OUT
 * This file is temporarily disabled as we're focusing only on Facebook leads webhook
 * All Meta/enhanced webhook functionality is commented out
 *
 * Original file contained 1750+ lines of enhanced webhook code
 * that has been disabled to focus on Facebook leads only.
 *
 * Backup saved as: enhanced-webhook.routes.js.backup
 */

const express = require("express");

// Create empty router for enhanced webhooks (disabled)
const router = express.Router();

// Empty map for pending validations (disabled functionality)
const pendingValidations = new Map();

// Log that enhanced webhooks are disabled
console.log(
  "⚠️  Enhanced webhook routes are disabled - using Facebook leads only"
);

// Export empty implementations to maintain compatibility
module.exports = {
  router,
  pendingValidations,
};
