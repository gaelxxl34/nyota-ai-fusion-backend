require("dotenv").config();
const express = require("express");
const cors = require("cors");

// Initialize Firebase
async function initializeFirebase() {
  try {
    const { initializeApp, cert, getApps } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");

    // Check if Firebase is already initialized
    if (getApps().length === 0) {
      console.log("Loading Firebase credentials from serviceAccountKey.json");
      const serviceAccount = require("../serviceAccountKey.json");

      initializeApp({
        credential: cert(serviceAccount),
      });

      // Test Firestore connection
      const db = getFirestore();
      await db.collection("test").doc("connection").set({
        timestamp: new Date(),
        status: "connected",
      });
      console.log("✅ Firebase Firestore connection verified");
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
    console.error("Failed to initialize Firebase, exiting...");
    process.exit(1);
  });

function startServer() {
  // Initialize Express app
  const app = express();

  // Middleware
  app.use(
    cors({
      origin: process.env.FRONTEND_URL || "http://localhost:3001",
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

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
    app.use("/api/webhook", enhancedWebhookRoutes);
    console.log("✅ Enhanced webhook routes loaded");
  } catch (error) {
    console.warn("❌ Enhanced webhook routes not loaded:", error.message);
  }

  // Lead management routes
  try {
    const { getFirestore } = require("firebase-admin/firestore");
    const {
      router: leadRoutes,
      initializeLeadService,
    } = require("./routes/leads.routes");

    // Initialize lead service with Firestore
    const db = getFirestore();
    initializeLeadService(db);

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
    const whatsappMessageService = require("./services/whatsappMessageService"); // Already instantiated

    // Initialize services
    const db = getFirestore();
    const leadService = new LeadService(db);

    initializeApplicationService(db, leadService, whatsappMessageService);

    app.use("/api/applications", applicationRoutes);
    console.log("✅ Application management routes loaded");
  } catch (error) {
    console.warn("❌ Application routes not loaded:", error.message);
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
    console.log(`🌐 Accessible from network at: http://172.16.117.123:${port}`);
    console.log(
      `📡 Webhook endpoint: http://172.16.117.123:${port}/api/webhook/receive`
    );

    // Start background job to process validation timeouts
    const ValidationQueueService = require("./services/validationQueueService");
    const validationQueueService = new ValidationQueueService();

    // Process timeouts every 10 seconds
    setInterval(async () => {
      try {
        await validationQueueService.processTimeouts();
      } catch (error) {
        console.error("Error processing validation timeouts:", error);
      }
    }, 10000); // 10 seconds

    console.log(
      "⏱️ Started validation timeout processor (runs every 10 seconds)"
    );
  });
}
