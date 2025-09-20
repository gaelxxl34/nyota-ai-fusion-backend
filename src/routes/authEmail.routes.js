/**
 * Authentication Email Routes
 * Handles custom branded authentication emails for student portal
 */

const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/auth.middleware");
const authEmailController = require("../controllers/authEmail.controller");
// Removed testEmail controller (testing route deleted)

// Debug middleware
router.use((req, res, next) => {
  console.log(
    `[${new Date().toISOString()}] Auth Email API: ${req.method} ${req.url}`
  );
  next();
});

/**
 * Send custom branded email verification
 * POST /api/auth/send-email-verification
 */
router.post(
  "/send-email-verification",
  authEmailController.sendEmailVerification
);

/**
 * Send custom branded password reset email
 * POST /api/auth/send-password-reset
 */
router.post("/send-password-reset", authEmailController.sendPasswordReset);

/**
 * Send verification reminder email
 * POST /api/auth/send-verification-reminder
 */
router.post(
  "/send-verification-reminder",
  authEmailController.sendVerificationReminder
);

// Test email endpoint removed

module.exports = router;
