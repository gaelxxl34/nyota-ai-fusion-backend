require("dotenv").config();
const express = require("express");
const cors = require("cors");
const logger = require("./utils/logger");

// Initialize Firebase
async function initializeFirebase() {
  try {
    // Use the existing configuration from firebase.config.js
    const {
      initializeFirebase,
      isInitialized,
    } = require("./config/firebase.config");
    const { getFirestore } = require("firebase-admin/firestore");

    // Initialize Firebase if not already initialized
    if (!isInitialized()) {
      initializeFirebase();

      // Test Firestore connection without writing to database
      const db = getFirestore();
      await db.listCollections().then((collections) => {
        logger.info("Firebase Firestore connection verified");
      });
    }
  } catch (error) {
    logger.error("Firebase initialization failed", error);
    throw error;
  }
}

// Initialize Firebase before starting server
initializeFirebase()
  .then(() => {
    startServer();
  })
  .catch((error) => {
    logger.error("Failed to initialize Firebase, exiting...", error);

    // Check if the error is related to the serviceAccountKey.json file
    if (error.message && error.message.includes("serviceAccountKey.json")) {
      logger.error(
        "There appears to be an issue with your serviceAccountKey.json file. Please verify that the file exists and contains valid credentials."
      );
    }
    // Check for network-related errors
    else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      logger.error(
        "Network connectivity issue. Please check your internet connection."
      );
    }

    // Wait a bit before exiting to ensure logs are written
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

function startServer() {
  // Initialize Express app
  const app = express();
  const fileUpload = require("express-fileupload");
  const path = require("path");

  // Serve static files for chatbot widget
  app.use("/chatbot", express.static(path.join(__dirname, "../public")));

  // Serve demo.html and other public files at root level
  app.use(express.static(path.join(__dirname, "../public")));

  // Middleware
  app.use(
    cors({
      origin: [
        process.env.FRONTEND_URL || "http://localhost:3001",
        "http://localhost:3000", // For chatbot widget
        "http://127.0.0.1:3000", // For chatbot widget
        /^https?:\/\/.*$/, // Allow all origins for chatbot embedding
      ],
      credentials: true,
    })
  );
  // File upload middleware - only for routes that actually need file uploads
  app.use(
    /^\/api\/(applications|files|admin|super-admin)/,
    fileUpload({
      limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
      useTempFiles: true,
      tempFileDir: "/tmp/",
      debug: false, // Disable debug to reduce console noise
    })
  );
  // Ensure JSON and URL-encoded middleware are configured correctly for webhooks
  app.use(express.json({ limit: "500mb", strict: false })); // Use strict:false to accept malformed JSON
  app.use(express.urlencoded({ extended: true, limit: "500mb" }));

  // Production logging middleware - only log important requests, not routine API calls
  if (process.env.NODE_ENV === "development") {
    app.use((req, res, next) => {
      // Skip logging for noisy routes
      if (
        req.path.includes("notifications") ||
        req.path.includes("__nextjs_original-stack-frames") ||
        req.path.includes("sse") ||
        req.path.includes("health")
      ) {
        return next();
      }
      logger.debug(`${req.method} ${req.path}`);
      next();
    });
  }

  // NOTE: Removed custom raw-body middleware for /api/webhook to avoid re-reading the stream.
  // Rely on express.json, express.urlencoded, and express-fileupload to parse bodies.

  // Define error handler
  app.use((err, req, res, next) => {
    logger.error("Server error", err);
    res.status(500).json({
      success: false,
      error:
        "Server error: " +
        (process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong"),
    });
  });

  // Import and set up routes
  app.use("/api/auth", require("./routes/auth.routes"));

  // Super Admin routes (Super Admin only)
  try {
    const superAdminRoutes = require("./routes/super-admin.routes");
    app.use("/api/super-admin", superAdminRoutes);
    logger.info("Super Admin routes loaded");
  } catch (error) {
    logger.warn("Super Admin routes not loaded:", error.message);
  }

  // Admin routes (Admin role)
  try {
    const adminRoutes = require("./routes/admin.routes");
    app.use("/api/admin", adminRoutes);
    logger.info("Admin routes loaded");
  } catch (error) {
    logger.warn("Admin routes not loaded:", error.message);
  }

  // Enhanced webhook routes
  try {
    const enhancedWebhookRoutes = require("./routes/enhanced-webhook.routes");

    if (!enhancedWebhookRoutes || !enhancedWebhookRoutes.router) {
      throw new Error("Webhook routes module did not export router properly");
    }

    // Add debug logging only in development
    if (process.env.NODE_ENV === "development") {
      enhancedWebhookRoutes.router.use((req, res, next) => {
        logger.webhook("Enhanced webhook request", {
          method: req.method,
          path: req.path,
          headers: req.headers,
        });
        next();
      });
    }

    app.use("/api/webhook", enhancedWebhookRoutes.router);
    logger.info("Enhanced webhook routes loaded at /api/webhook");
  } catch (error) {
    logger.warn("Enhanced webhook routes not loaded:", error.message);
    logger.error("Webhook routes error details", error); // Log the full error for debugging
  }

  // Lead management routes
  try {
    const { getFirestore } = require("firebase-admin/firestore");
    const leadRoutes = require("./routes/leads.routes");

    // Initialize lead service with Firestore
    const db = getFirestore();
    leadRoutes.initLeadService(db);

    app.use("/api/leads", leadRoutes);
    logger.info("Lead management routes loaded");
  } catch (error) {
    logger.warn("Lead routes not loaded:", error.message);
  }

  // Application management routes
  try {
    const { getFirestore } = require("firebase-admin/firestore");
    const {
      router: applicationRoutes,
      initializeApplicationService,
    } = require("./routes/applications.routes");

    const LeadService = require("./services/leadService");
    const WhatsAppMessageService = require("./services/whatsappMessageService"); // Now returns the class, not an instance
    const ConversationService = require("./services/conversationService");
    const StorageService = require("./services/storageService");

    // Initialize services
    const db = getFirestore();
    const leadService = new LeadService(db);
    const conversationService = new ConversationService(db);
    const whatsappMessageService = new WhatsAppMessageService(
      db,
      leadService,
      conversationService
    );
    const storageService = new StorageService();

    initializeApplicationService(
      db,
      leadService,
      whatsappMessageService,
      storageService
    );

    app.use("/api/applications", applicationRoutes);
    logger.info("Application management routes loaded");
  } catch (error) {
    logger.warn("Application routes not loaded:", error.message);
  }

  // Analytics routes
  try {
    const analyticsRoutes = require("./routes/analytics.routes");
    app.use("/api/analytics", analyticsRoutes);
    logger.info("Analytics routes loaded");
  } catch (error) {
    logger.warn("Analytics routes not loaded:", error.message);
  }

  // Knowledge Base routes
  try {
    const knowledgeBaseRoutes = require("./routes/knowledge-base.routes");
    app.use("/api/knowledge-base", knowledgeBaseRoutes);
    logger.info("Knowledge Base routes loaded");
  } catch (error) {
    logger.warn("Knowledge Base routes not loaded:", error.message);
  }

  // Team routes have been moved to admin routes
  // Organization-specific routes have been removed since IUEA is single-org

  // Team routes
  app.use("/api/team", require("./routes/team.routes"));

  // WhatsApp routes
  try {
    const whatsappRoutes = require("./routes/whatsapp.routes");
    app.use("/api/whatsapp", whatsappRoutes);
  } catch (error) {
    logger.warn("WhatsApp routes not loaded:", error.message);
  }

  // Chatbot routes for iframe embedding
  try {
    const chatbotRoutes = require("./routes/chatbot.routes");
    app.use("/api/chatbot", chatbotRoutes);
    logger.info("Chatbot routes loaded");
  } catch (error) {
    logger.warn("Chatbot routes not loaded:", error.message);
  }

  // Meta Conversions API test routes
  try {
    const metaTestRoutes = require("./routes/meta-test.routes");
    app.use("/api/meta", metaTestRoutes);
    logger.info("Meta Conversions API test routes loaded");
  } catch (error) {
    logger.warn("Meta test routes not loaded:", error.message);
  }

  // Welcome message routes
  try {
    const welcomeRoutes = require("./routes/welcome.routes");
    app.use("/api/welcome", welcomeRoutes);
    logger.info("Welcome message routes loaded");
  } catch (error) {
    logger.warn("Welcome routes not loaded:", error.message);
  }

  // Health check endpoint
  app.get("/health", async (req, res) => {
    try {
      const emailService = require("./services/emailService");
      const emailStatus = {
        available: emailService.isInitialized || false,
        provider: emailService.isInitialized ? "sendgrid" : "none",
      };

      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        services: {
          email: emailStatus,
        },
      });
    } catch (error) {
      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        services: {
          email: {
            available: false,
            provider: "none",
            error: error.message,
          },
        },
      });
    }
  });

  // Handle missing notifications endpoint (to prevent frontend 404s)
  app.get("/api/notifications/sse", (req, res) => {
    res.status(200).json({ message: "SSE endpoint not implemented yet" });
  });

  // Handle NextJS stack frame requests (development)
  app.post("/__nextjs_original-stack-frames", (req, res) => {
    res.status(200).json({ frames: [] });
  });

  // Start server
  const port = process.env.BACKEND_PORT || process.env.PORT || 3000;
  const host = process.env.BACKEND_HOST || process.env.HOST || "0.0.0.0"; // Listen on all network interfaces
  app.listen(port, host, () => {
    logger.info(`Server running on ${host}:${port}`);

    // Only show development URLs in development mode
    if (process.env.NODE_ENV === "development") {
      const localIP = process.env.LOCAL_IP || "localhost";
      logger.info(`Accessible from network at: http://${localIP}:${port}`);
      logger.info(
        `Webhook endpoint: http://${localIP}:${port}/api/webhook/receive`
      );
    }

    logger.info("Application services initialized successfully");
  });
}
