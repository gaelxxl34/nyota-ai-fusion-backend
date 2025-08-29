const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/auth.middleware");
const welcomeController = require("../controllers/welcome.controller");

// Debug middleware
router.use((req, res, next) => {
  console.log(
    `[${new Date().toISOString()}] Welcome API: ${req.method} ${req.url}`
  );
  next();
});

// Send welcome email
router.post("/email", authenticateUser, welcomeController.sendWelcomeEmail);

// Send welcome WhatsApp message
router.post(
  "/whatsapp",
  authenticateUser,
  welcomeController.sendWelcomeWhatsApp
);

module.exports = router;
