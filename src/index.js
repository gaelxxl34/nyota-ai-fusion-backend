require("dotenv").config();
const express = require("express");
const cors = require("cors");

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
        console.log("✅ Firebase Firestore connection verified");
      });
    }
  } catch (error) {
    console.error("❌ Firebase initialization failed:", error);
    throw error;
  }
}

// Initialize Firebase before starting server
initializeFirebase()
  .then(() => {
    startServer();
  })
  .catch((error) => {
    console.error("Failed to initialize Firebase, exiting...", error);

    // Check if the error is related to the serviceAccountKey.json file
    if (error.message && error.message.includes("serviceAccountKey.json")) {
      console.error(
        "ERROR: There appears to be an issue with your serviceAccountKey.json file."
      );
      console.error(
        "Please verify that the file exists and contains valid credentials."
      );
    }
    // Check for network-related errors
    else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      console.error(
        "ERROR: Network connectivity issue. Please check your internet connection."
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

  // Middleware
  app.use(
    cors({
      origin: process.env.FRONTEND_URL || "http://localhost:3001",
      credentials: true,
    })
  );
  // File upload middleware
  app.use(
    fileUpload({
      limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
      useTempFiles: true,
      tempFileDir: "/tmp/",
      debug: process.env.NODE_ENV === "development",
    })
  );
  // Ensure JSON and URL-encoded middleware are configured correctly for webhooks
  app.use(express.json({ limit: "500mb", strict: false })); // Use strict:false to accept malformed JSON
  app.use(express.urlencoded({ extended: true, limit: "500mb" }));

  // Production logging middleware - only log in development
  if (process.env.NODE_ENV === "development") {
    app.use((req, res, next) => {
      console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
      next();
    });
  }

  // NOTE: Removed custom raw-body middleware for /api/webhook to avoid re-reading the stream.
  // Rely on express.json, express.urlencoded, and express-fileupload to parse bodies.

  // Define error handler
  app.use((err, req, res, next) => {
    console.error(err.stack);
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
    console.log("✅ Super Admin routes loaded");
  } catch (error) {
    console.warn("❌ Super Admin routes not loaded:", error.message);
  }

  // Admin routes (Admin role)
  try {
    const adminRoutes = require("./routes/admin.routes");
    app.use("/api/admin", adminRoutes);
    console.log("✅ Admin routes loaded");
  } catch (error) {
    console.warn("❌ Admin routes not loaded:", error.message);
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
        console.log(`Webhook request received: ${req.method} ${req.path}`);
        console.log(`Headers: ${JSON.stringify(req.headers)}`);
        next();
      });
    }

    app.use("/api/webhook", enhancedWebhookRoutes.router);
    console.log("✅ Enhanced webhook routes loaded at /api/webhook");
  } catch (error) {
    console.warn("❌ Enhanced webhook routes not loaded:", error.message);
    console.error(error); // Log the full error for debugging
  }

  // Lead management routes
  try {
    const { getFirestore } = require("firebase-admin/firestore");
    const leadRoutes = require("./routes/leads.routes");

    // Initialize lead service with Firestore
    const db = getFirestore();
    leadRoutes.initLeadService(db);

    app.use("/api/leads", leadRoutes);
    console.log("✅ Lead management routes loaded");
  } catch (error) {
    console.warn("❌ Lead routes not loaded:", error.message);
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
    console.log("✅ Application management routes loaded");
  } catch (error) {
    console.warn("❌ Application routes not loaded:", error.message);
  }

  // Analytics routes
  try {
    const analyticsRoutes = require("./routes/analytics.routes");
    app.use("/api/analytics", analyticsRoutes);
    console.log("✅ Analytics routes loaded");
  } catch (error) {
    console.warn("❌ Analytics routes not loaded:", error.message);
  }

  // Knowledge Base routes
  try {
    const knowledgeBaseRoutes = require("./routes/knowledge-base.routes");
    app.use("/api/knowledge-base", knowledgeBaseRoutes);
    console.log("✅ Knowledge Base routes loaded");
  } catch (error) {
    console.warn("❌ Knowledge Base routes not loaded:", error.message);
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
    console.warn("WhatsApp routes not loaded:", error.message);
  }

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Start server
  const port = process.env.BACKEND_PORT || process.env.PORT || 3000;
  const host = process.env.BACKEND_HOST || process.env.HOST || "0.0.0.0"; // Listen on all network interfaces
  app.listen(port, host, () => {
    console.log(`Server running on ${host}:${port}`);

    // Only show development URLs in development mode
    if (process.env.NODE_ENV === "development") {
      const localIP = process.env.LOCAL_IP || "localhost";
      console.log(`🌐 Accessible from network at: http://${localIP}:${port}`);
      console.log(
        `📡 Webhook endpoint: http://${localIP}:${port}/api/webhook/receive`
      );
    }

    console.log("⏱️ Application services initialized successfully");
  });
}
