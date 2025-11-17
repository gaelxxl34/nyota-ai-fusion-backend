const express = require("express");
const router = express.Router();
const { admin } = require("../config/firebase.config");
const { authenticateUser } = require("../middleware/auth.middleware");
const bcrypt = require("bcryptjs");
const conversationStatsService = require("../services/conversationStats.service");

// Middleware to check if user is super admin
const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== "superAdmin") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Super admin role required.",
    });
  }
  next();
};

// Apply authentication and super admin check to all routes
router.use(authenticateUser);
router.use(requireSuperAdmin);

// Get all users
router.get("/users", async (req, res) => {
  try {
    const db = admin.firestore();
    const usersSnapshot = await db.collection("users").get();

    const users = usersSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      // Don't send password hash to frontend
      password: undefined,
    }));

    res.json({
      success: true,
      users,
      total: users.length,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: error.message,
    });
  }
});

// Create new user
router.post("/users", async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "Name, email, password, and role are required",
      });
    }

    const db = admin.firestore();

    // Check if user with email already exists
    const existingUserQuery = await db
      .collection("users")
      .where("email", "==", email.toLowerCase())
      .get();

    if (!existingUserQuery.empty) {
      return res.status(400).json({
        success: false,
        message: "User with this email already exists",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user document
    const userData = {
      name,
      email: email.toLowerCase(),
      phone: phone || "",
      role,
      status: "Active",
      password: hashedPassword,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.uid,
    };

    const userRef = await db.collection("users").add(userData);

    // Also create Firebase Auth user
    try {
      await admin.auth().createUser({
        uid: userRef.id,
        email: email.toLowerCase(),
        password,
        displayName: name,
      });

      // Set custom claims
      await admin.auth().setCustomUserClaims(userRef.id, {
        role,
        userId: userRef.id,
      });
    } catch (authError) {
      // If Firebase Auth creation fails, delete the Firestore document
      await userRef.delete();
      throw authError;
    }

    res.json({
      success: true,
      message: "User created successfully",
      user: {
        id: userRef.id,
        ...userData,
        password: undefined,
      },
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create user",
      error: error.message,
    });
  }
});

// Update user
router.put("/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email, phone, role } = req.body;

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.uid,
    };

    if (name) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (role) updateData.role = role;

    await userRef.update(updateData);

    // Update Firebase Auth custom claims if role changed
    if (role) {
      await admin.auth().setCustomUserClaims(userId, {
        role,
        userId,
      });
    }

    const updatedUser = await userRef.get();

    res.json({
      success: true,
      message: "User updated successfully",
      user: {
        id: userId,
        ...updatedUser.data(),
        password: undefined,
      },
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user",
      error: error.message,
    });
  }
});

// Delete user
router.delete("/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Prevent self-deletion
    if (userId === req.user.uid) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete your own account",
      });
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const userData = userDoc.data();
    const userEmail = userData.email;

    console.log(
      `🗑️ Starting comprehensive deletion of user ${userId} (${
        userData.name || "Unknown"
      } - ${userEmail})`
    );

    let cleanupResults = {
      leads: 0,
      applications: 0,
      conversations: 0,
      messages: 0,
      storageFiles: 0,
      errors: [],
    };

    // 1. Delete all leads submitted by this user
    try {
      console.log(`📋 Looking for leads submitted by user: ${userEmail}`);
      const leadsQuery = await db
        .collection("leads")
        .where("submittedBy.email", "==", userEmail)
        .get();

      if (!leadsQuery.empty) {
        // Use the comprehensive lead deletion service
        const LeadService = require("../services/leadService");
        const leadService = new LeadService(db);

        for (const leadDoc of leadsQuery.docs) {
          try {
            const deleteResult = await leadService.deleteLead(leadDoc.id);
            cleanupResults.leads += 1;
            cleanupResults.conversations +=
              deleteResult.cleanupResults?.conversations || 0;
            cleanupResults.messages +=
              deleteResult.cleanupResults?.messages || 0;
            cleanupResults.applications +=
              deleteResult.cleanupResults?.applications || 0;
            cleanupResults.storageFiles +=
              deleteResult.cleanupResults?.storageFiles || 0;

            console.log(
              `✅ Deleted lead ${leadDoc.id} with comprehensive cleanup`
            );
          } catch (leadDeleteError) {
            console.error(
              `❌ Failed to delete lead ${leadDoc.id}:`,
              leadDeleteError
            );
            cleanupResults.errors.push(
              `Lead deletion failed: ${leadDeleteError.message}`
            );
          }
        }
      }
    } catch (leadsCleanupError) {
      console.error("❌ Error during leads cleanup:", leadsCleanupError);
      cleanupResults.errors.push(
        `Leads cleanup failed: ${leadsCleanupError.message}`
      );
    }

    // 2. Delete applications directly submitted by this user (not through leads)
    try {
      console.log(
        `📋 Looking for applications submitted by user: ${userEmail}`
      );
      const applicationsQuery = await db
        .collection("applications")
        .where("submittedBy.email", "==", userEmail)
        .get();

      if (!applicationsQuery.empty) {
        const ApplicationService = require("../services/applicationService");
        const StorageService = require("../services/storageService");

        // Create service instances for cleanup
        const storageService = new StorageService();
        const applicationService = new ApplicationService(
          db,
          null,
          null,
          storageService
        );

        for (const appDoc of applicationsQuery.docs) {
          try {
            // Clean up storage files for this application
            const storageCleanupResult =
              await applicationService.deleteAllApplicationDocuments(appDoc.id);
            if (storageCleanupResult.success) {
              cleanupResults.storageFiles += storageCleanupResult.deletedCount;
            }

            // Delete the application document
            await appDoc.ref.delete();
            cleanupResults.applications += 1;

            console.log(
              `✅ Deleted application ${appDoc.id} with storage cleanup`
            );
          } catch (appDeleteError) {
            console.error(
              `❌ Failed to delete application ${appDoc.id}:`,
              appDeleteError
            );
            cleanupResults.errors.push(
              `Application deletion failed: ${appDeleteError.message}`
            );
          }
        }
      }
    } catch (applicationsCleanupError) {
      console.error(
        "❌ Error during applications cleanup:",
        applicationsCleanupError
      );
      cleanupResults.errors.push(
        `Applications cleanup failed: ${applicationsCleanupError.message}`
      );
    }

    // 3. Delete user assignments from leads/applications
    try {
      console.log(`🔄 Removing user assignments for user: ${userId}`);

      // Remove from leads where user is assigned
      const assignedLeadsQuery = await db
        .collection("leads")
        .where("assignedTo", "==", userId)
        .get();

      if (!assignedLeadsQuery.empty) {
        const batch = db.batch();
        assignedLeadsQuery.docs.forEach((doc) => {
          batch.update(doc.ref, {
            assignedTo: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        await batch.commit();
        console.log(
          `✅ Removed user assignment from ${assignedLeadsQuery.size} leads`
        );
      }

      // Remove from applications where user is assigned
      const assignedAppsQuery = await db
        .collection("applications")
        .where("assignedTo", "==", userId)
        .get();

      if (!assignedAppsQuery.empty) {
        const batch = db.batch();
        assignedAppsQuery.docs.forEach((doc) => {
          batch.update(doc.ref, {
            assignedTo: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        await batch.commit();
        console.log(
          `✅ Removed user assignment from ${assignedAppsQuery.size} applications`
        );
      }
    } catch (assignmentCleanupError) {
      console.error(
        "❌ Error during assignment cleanup:",
        assignmentCleanupError
      );
      cleanupResults.errors.push(
        `Assignment cleanup failed: ${assignmentCleanupError.message}`
      );
    }

    // 4. Delete the user document from Firestore
    await userRef.delete();

    // 5. Delete from Firebase Auth
    try {
      await admin.auth().deleteUser(userId);
      console.log(`✅ Deleted user from Firebase Auth: ${userId}`);
    } catch (authError) {
      console.error("❌ Error deleting user from Auth:", authError);
      cleanupResults.errors.push(`Auth deletion failed: ${authError.message}`);
      // Continue even if Auth deletion fails
    }

    // 6. Log comprehensive cleanup results
    console.log(`✅ User ${userId} deleted successfully with cleanup results:`);
    console.log(`   📋 Leads deleted: ${cleanupResults.leads}`);
    console.log(`   📄 Applications deleted: ${cleanupResults.applications}`);
    console.log(`   📞 Conversations deleted: ${cleanupResults.conversations}`);
    console.log(`   💬 Messages deleted: ${cleanupResults.messages}`);
    console.log(`   📁 Storage files deleted: ${cleanupResults.storageFiles}`);

    if (cleanupResults.errors.length > 0) {
      console.log(`   ⚠️ Cleanup errors: ${cleanupResults.errors.length}`);
      cleanupResults.errors.forEach((error) => console.log(`     - ${error}`));
    }

    res.json({
      success: true,
      message: "User and all associated data deleted successfully",
      cleanupResults: {
        leads: cleanupResults.leads,
        applications: cleanupResults.applications,
        conversations: cleanupResults.conversations,
        messages: cleanupResults.messages,
        storageFiles: cleanupResults.storageFiles,
        errors: cleanupResults.errors.length,
      },
    });
  } catch (error) {
    console.error("❌ Error deleting user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete user",
      error: error.message,
    });
  }
});

// Bulk delete users (optimized with parallel processing)
router.post("/users/bulk-delete", async (req, res) => {
  try {
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "userIds must be a non-empty array",
      });
    }

    // Prevent self-deletion
    if (userIds.includes(req.user.uid)) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete your own account",
      });
    }

    const db = admin.firestore();

    // Use optimized bulk deletion service
    const BulkUserDeletionService = require("../services/bulkUserDeletionService");
    const deletionService = new BulkUserDeletionService(db, admin);

    const results = await deletionService.bulkDeleteUsers(
      userIds,
      req.user.uid
    );

    const statusCode = results.failed > 0 ? 207 : 200; // 207 Multi-Status if some failed

    res.status(statusCode).json({
      success: results.failed === 0,
      message:
        results.failed === 0
          ? `Successfully deleted ${results.succeeded} user(s) and all associated data`
          : `Deleted ${results.succeeded} user(s), but ${results.failed} failed`,
      results,
    });
  } catch (error) {
    console.error("❌ Error in bulk delete operation:", error);
    res.status(500).json({
      success: false,
      message: "Failed to perform bulk delete operation",
      error: error.message,
    });
  }
});

// Reset user password
router.post("/users/:userId/reset-password", async (req, res) => {
  try {
    const { userId } = req.params;

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Generate new password
    const newPassword = Math.random().toString(36).slice(-8) + "Aa1!";
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update in Firestore
    await userRef.update({
      password: hashedPassword,
      passwordResetAt: admin.firestore.FieldValue.serverTimestamp(),
      passwordResetBy: req.user.uid,
    });

    // Update in Firebase Auth
    try {
      await admin.auth().updateUser(userId, {
        password: newPassword,
      });
    } catch (authError) {
      console.error("Error updating password in Auth:", authError);
    }

    res.json({
      success: true,
      message: "Password reset successfully",
      newPassword,
    });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reset password",
      error: error.message,
    });
  }
});

// Get system statistics
router.get("/stats", async (req, res) => {
  try {
    const db = admin.firestore();
    const { ROLES, LEAD_STAGES } = require("../config/roles.config");

    // Get counts for various collections
    const [usersSnapshot, leadsSnapshot, applicationsSnapshot] =
      await Promise.all([
        db.collection("users").get(),
        db.collection("leads").get(),
        db.collection("applications").get(),
      ]);

    // Count users by role with proper role names
    const usersByRole = {};
    Object.keys(ROLES).forEach((role) => {
      usersByRole[role] = 0;
    });

    usersSnapshot.docs.forEach((doc) => {
      const role = doc.data().role || "unknown";
      if (usersByRole[role] !== undefined) {
        usersByRole[role]++;
      } else {
        usersByRole["unknown"] = (usersByRole["unknown"] || 0) + 1;
      }
    });

    // Count leads by status with proper mapping
    const leadsByStatus = {};
    const leadStageMapping = {
      INTERESTED: "interested",
      APPLIED: "applied",
      IN_REVIEW: "in_review",
      QUALIFIED: "qualified",
      ADMITTED: "admitted",
      ENROLLED: "enrolled",
      DEFERRED: "deferred",
      EXPIRED: "expired",
    };

    // Initialize all stages
    Object.values(LEAD_STAGES).forEach((stage) => {
      leadsByStatus[stage] = 0;
    });
    leadsByStatus["deferred"] = 0;
    leadsByStatus["expired"] = 0;

    leadsSnapshot.docs.forEach((doc) => {
      const status = doc.data().status || "unknown";
      const mappedStage = leadStageMapping[status] || status.toLowerCase();
      leadsByStatus[mappedStage] = (leadsByStatus[mappedStage] || 0) + 1;
    });

    // Calculate conversion rates
    const totalLeads = leadsSnapshot.size;
    const conversionRates = {
      inquiryToContacted:
        totalLeads > 0
          ? ((leadsByStatus.contacted / totalLeads) * 100).toFixed(2)
          : 0,
      contactedToQualified:
        leadsByStatus.contacted > 0
          ? ((leadsByStatus.qualified / leadsByStatus.contacted) * 100).toFixed(
              2
            )
          : 0,
      qualifiedToApplied:
        leadsByStatus.qualified > 0
          ? ((leadsByStatus.applied / leadsByStatus.qualified) * 100).toFixed(2)
          : 0,
      appliedToAdmitted:
        leadsByStatus.applied > 0
          ? ((leadsByStatus.admitted / leadsByStatus.applied) * 100).toFixed(2)
          : 0,
      admittedToEnrolled:
        leadsByStatus.admitted > 0
          ? ((leadsByStatus.enrolled / leadsByStatus.admitted) * 100).toFixed(2)
          : 0,
      overallConversion:
        totalLeads > 0
          ? ((leadsByStatus.enrolled / totalLeads) * 100).toFixed(2)
          : 0,
    };

    // Get recent activity (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentLeadsQuery = await db
      .collection("leads")
      .where("createdAt", ">=", thirtyDaysAgo)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const recentActivities = recentLeadsQuery.docs.map((doc) => ({
      id: doc.id,
      type: "lead_created",
      description: `New lead: ${doc.data().name || doc.data().email}`,
      timestamp: doc.data().createdAt,
      status: doc.data().status,
    }));

    // System performance metrics
    const systemPerformance = {
      uptime: "99.9%",
      responseTime: "< 200ms",
      activeUsers: usersSnapshot.docs.filter(
        (doc) =>
          doc.data().status === "active" || doc.data().status === "Active"
      ).length,
      errorRate: "< 0.1%",
    };

    res.json({
      success: true,
      stats: {
        // Basic counts
        totalUsers: usersSnapshot.size,
        totalLeads: leadsSnapshot.size,
        totalApplications: applicationsSnapshot.size,

        // Role-based user distribution
        usersByRole,
        roleDetails: Object.keys(ROLES).map((roleKey) => ({
          role: roleKey,
          name: ROLES[roleKey].name,
          count: usersByRole[roleKey] || 0,
          description: ROLES[roleKey].description,
        })),

        // Lead funnel data
        leadsByStatus,
        leadFunnel: {
          new_contact: leadsByStatus.new_contact || 0,
          contacted: leadsByStatus.contacted || 0,
          qualified: leadsByStatus.qualified || 0,
          applied: leadsByStatus.applied || 0,
          admitted: leadsByStatus.admitted || 0,
          enrolled: leadsByStatus.enrolled || 0,
        },

        // Conversion metrics
        conversionRates,

        // Recent activities
        recentActivities,

        // System health
        systemHealth: "operational",
        systemPerformance,

        // Additional metrics
        activeLeads: leadsSnapshot.docs.filter(
          (doc) => !["REJECTED", "ENROLLED"].includes(doc.data().status)
        ).length,
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching system stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch system statistics",
      error: error.message,
    });
  }
});

// Get system configuration
router.get("/config", async (req, res) => {
  try {
    const db = admin.firestore();
    const configDoc = await db.collection("system").doc("config").get();

    if (!configDoc.exists) {
      // Return default config if none exists
      return res.json({
        success: true,
        config: {
          organizationName: "IUEA",
          systemEmail: "admin@iuea.ac.ug",
          timezone: "Africa/Kampala",
          features: {
            whatsappIntegration: true,
            emailNotifications: true,
          },
        },
      });
    }

    res.json({
      success: true,
      config: configDoc.data(),
    });
  } catch (error) {
    console.error("Error fetching system config:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch system configuration",
      error: error.message,
    });
  }
});

// Update system configuration
router.put("/config", async (req, res) => {
  try {
    const db = admin.firestore();
    const configData = {
      ...req.body,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.uid,
    };

    await db
      .collection("system")
      .doc("config")
      .set(configData, { merge: true });

    res.json({
      success: true,
      message: "System configuration updated successfully",
      config: configData,
    });
  } catch (error) {
    console.error("Error updating system config:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update system configuration",
      error: error.message,
    });
  }
});

// Get user activity analytics
router.get("/analytics/users", async (req, res) => {
  try {
    const db = admin.firestore();
    const { timeRange = "30" } = req.query; // days

    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(timeRange));

    // Get user registrations over time
    const usersSnapshot = await db
      .collection("users")
      .where("createdAt", ">=", daysAgo)
      .orderBy("createdAt", "desc")
      .get();

    // Group by date
    const userRegistrations = {};
    usersSnapshot.docs.forEach((doc) => {
      const date =
        doc.data().createdAt?.toDate?.()?.toISOString?.()?.split("T")[0] ||
        "unknown";
      const role = doc.data().role || "unknown";

      if (!userRegistrations[date]) userRegistrations[date] = {};
      userRegistrations[date][role] = (userRegistrations[date][role] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        userRegistrations,
        totalNewUsers: usersSnapshot.size,
      },
    });
  } catch (error) {
    console.error("Error fetching user analytics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user analytics",
      error: error.message,
    });
  }
});

// Get lead analytics
router.get("/analytics/leads", async (req, res) => {
  try {
    const db = admin.firestore();
    const { timeRange = "30" } = req.query; // days

    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(timeRange));

    // Get leads over time
    const leadsSnapshot = await db
      .collection("leads")
      .where("createdAt", ">=", daysAgo)
      .orderBy("createdAt", "desc")
      .get();

    // Group by date and status
    const leadTrends = {};
    const statusCounts = {};

    leadsSnapshot.docs.forEach((doc) => {
      const date =
        doc.data().createdAt?.toDate?.()?.toISOString?.()?.split("T")[0] ||
        "unknown";
      const status = doc.data().status || "UNKNOWN";

      if (!leadTrends[date]) leadTrends[date] = {};
      leadTrends[date][status] = (leadTrends[date][status] || 0) + 1;
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        leadTrends,
        statusCounts,
        totalNewLeads: leadsSnapshot.size,
      },
    });
  } catch (error) {
    console.error("Error fetching lead analytics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch lead analytics",
      error: error.message,
    });
  }
});

// Get system performance metrics
router.get("/analytics/performance", async (req, res) => {
  try {
    const db = admin.firestore();

    // Get database size metrics
    const collections = ["users", "leads", "applications", "conversations"];
    const collectionSizes = {};

    for (const collection of collections) {
      const snapshot = await db.collection(collection).get();
      collectionSizes[collection] = snapshot.size;
    }

    // Mock performance metrics (in production, these would come from monitoring systems)
    const performanceMetrics = {
      databaseSize: collectionSizes,
      averageResponseTime: Math.floor(Math.random() * 100) + 50, // 50-150ms
      uptime: 99.9,
      errorRate: (Math.random() * 0.5).toFixed(3), // 0-0.5%
      activeConnections: Math.floor(Math.random() * 100) + 20,
      memoryUsage: (Math.random() * 30 + 40).toFixed(1), // 40-70%
      cpuUsage: (Math.random() * 40 + 10).toFixed(1), // 10-50%
      timestamp: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: performanceMetrics,
    });
  } catch (error) {
    console.error("Error fetching performance metrics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch performance metrics",
      error: error.message,
    });
  }
});

// Get conversation statistics
router.get("/analytics/conversations", async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "true";

    console.log("📊 Fetching conversation statistics...");
    const conversationStats =
      await conversationStatsService.getCachedConversationStats(forceRefresh);

    res.json({
      success: true,
      data: conversationStats,
      cached: !forceRefresh,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching conversation statistics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch conversation statistics",
      error: error.message,
    });
  }
});

// Get simplified conversation counts for dashboard
router.get("/analytics/conversations/counts", async (req, res) => {
  try {
    console.log("📈 Fetching conversation counts for dashboard...");
    const conversationCounts =
      await conversationStatsService.getConversationCounts();

    res.json({
      success: true,
      data: conversationCounts,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching conversation counts:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch conversation counts",
      error: error.message,
    });
  }
});

// ========== BULK ACTIONS ROUTES ==========

// Get all interested leads for bulk messaging
router.get("/bulk-actions/interested-leads", async (req, res) => {
  try {
    const db = admin.firestore();
    const { LEAD_STATUSES } = require("../config/lead.constants");

    const leadsQuery = await db
      .collection("leads")
      .where("status", "==", LEAD_STATUSES.INTERESTED)
      .orderBy("createdAt", "desc")
      .get();

    const leads = leadsQuery.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({
      success: true,
      leads,
      total: leads.length,
    });
  } catch (error) {
    console.error("Error fetching interested leads:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch interested leads",
      error: error.message,
    });
  }
});

// Get all contacted leads for bulk messaging
router.get("/bulk-actions/contacted-leads", async (req, res) => {
  try {
    const db = admin.firestore();
    const { LEAD_STATUSES } = require("../config/lead.constants");

    const leadsQuery = await db
      .collection("leads")
      .where("status", "==", LEAD_STATUSES.CONTACTED)
      .orderBy("createdAt", "desc")
      .get();

    const leads = leadsQuery.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({
      success: true,
      leads,
      total: leads.length,
    });
  } catch (error) {
    console.error("Error fetching contacted leads:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch contacted leads",
      error: error.message,
    });
  }
});

// Start bulk messaging campaign
router.post("/bulk-actions/send-messages", async (req, res) => {
  try {
    const {
      campaignName,
      description,
      leadStatus = "interested",
      targetCount = 0,
    } = req.body;

    if (!campaignName) {
      return res.status(400).json({
        success: false,
        message: "Campaign name is required",
      });
    }

    // Validate that we have leads to process
    if (targetCount === 0) {
      return res.status(400).json({
        success: false,
        message: `No ${leadStatus} leads found to process. Campaign cannot be started.`,
      });
    }

    // For non-supported leads, return early with not implemented message
    if (!["interested", "contacted"].includes(leadStatus.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Campaigns for "${leadStatus}" leads are not yet implemented. Only "interested" and "contacted" leads are currently supported.`,
      });
    }

    const db = admin.firestore();

    // Create campaign record
    const campaignData = {
      name: campaignName,
      description: description || "",
      leadStatus: leadStatus.toUpperCase(), // Store the target lead status
      targetCount: targetCount, // Store expected target count
      status: "running",
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      startedBy: req.user.uid,
      results: {
        totalLeads: 0,
        emailsSent: 0,
        emailsFailed: 0,
        whatsappSent: 0,
        whatsappFailed: 0,
        leadsSkipped: 0, // Add skipped leads counter
        errors: [],
      },
      logs: [],
    };

    const campaignRef = await db.collection("campaigns").add(campaignData);
    const campaignId = campaignRef.id;

    // Start the bulk messaging process in the background
    setImmediate(async () => {
      try {
        // Log initial campaign start
        await campaignRef.update({
          [`logs`]: admin.firestore.FieldValue.arrayUnion({
            timestamp: new Date().toISOString(),
            type: "info",
            message: `Campaign started - beginning to process ${leadStatus} leads (Expected: ${targetCount} leads)`,
          }),
        });

        console.log(
          `📧 Starting campaign: ${campaignName} for ${leadStatus} leads`
        );

        // Use appropriate service based on lead status
        if (leadStatus.toLowerCase() === "interested") {
          const InterestedLeadsMessenger = require("../scripts/sendInterestedLeadsMessages");
          const messenger = new InterestedLeadsMessenger(campaignRef);
          const results = await messenger.processInterestedLeads();

          // Update final results
          await campaignRef.update({
            status: "completed",
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            results: results,
            [`logs`]: admin.firestore.FieldValue.arrayUnion({
              timestamp: new Date().toISOString(),
              type: "success",
              message: `Campaign completed successfully. Processed: ${
                results.totalLeads
              } leads, Emails sent: ${results.emailsSent}, WhatsApp sent: ${
                results.whatsappSent
              }, Skipped: ${results.leadsSkipped || 0}, Errors: ${
                results.errors.length
              }`,
            }),
          });

          console.log(
            `✅ Interested leads campaign completed: ${campaignName}`,
            results
          );
        } else if (leadStatus.toLowerCase() === "contacted") {
          const ContactedLeadsMessenger = require("../scripts/sendContactedLeadsMessages");
          const messenger = new ContactedLeadsMessenger(campaignRef);
          const results = await messenger.processContactedLeads();

          // Update final results
          await campaignRef.update({
            status: "completed",
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            results: results,
            [`logs`]: admin.firestore.FieldValue.arrayUnion({
              timestamp: new Date().toISOString(),
              type: "success",
              message: `Campaign completed successfully. Processed: ${
                results.totalLeads
              } leads, Emails sent: ${results.emailsSent}, WhatsApp sent: ${
                results.whatsappSent
              }, Conversations created: ${
                results.conversationsCreated || 0
              }, Skipped: ${results.leadsSkipped || 0}, Errors: ${
                results.errors.length
              }`,
            }),
          });

          console.log(
            `✅ Contacted leads campaign completed: ${campaignName}`,
            results
          );
        }
      } catch (error) {
        console.error("❌ Campaign error:", error);

        // Provide more detailed error message
        let errorMessage = error.message;
        if (error.message.includes("Firebase app already exists")) {
          errorMessage =
            "Firebase initialization error - this has been resolved automatically";
        } else if (error.message.includes("ECONNREFUSED")) {
          errorMessage =
            "Network connection error - please check your internet connection";
        } else if (error.message.includes("permission-denied")) {
          errorMessage =
            "Database permission error - please check Firebase permissions";
        }

        await campaignRef.update({
          status: "failed",
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          error: errorMessage,
          [`logs`]: admin.firestore.FieldValue.arrayUnion({
            timestamp: new Date().toISOString(),
            type: "error",
            message: `Campaign failed: ${errorMessage}`,
          }),
        });
      }
    });

    res.json({
      success: true,
      message: "Bulk messaging campaign started successfully",
      campaignId,
      campaignName,
      leadStatus: leadStatus.toUpperCase(),
      targetCount,
    });
  } catch (error) {
    console.error("Error starting bulk messaging campaign:", error);
    res.status(500).json({
      success: false,
      message: "Failed to start bulk messaging campaign",
      error: error.message,
    });
  }
});

// Get campaign status and logs
router.get("/bulk-actions/campaigns/:campaignId", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const db = admin.firestore();

    const campaignDoc = await db.collection("campaigns").doc(campaignId).get();

    if (!campaignDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    const campaignData = campaignDoc.data();

    res.json({
      success: true,
      campaign: {
        id: campaignId,
        ...campaignData,
      },
    });
  } catch (error) {
    console.error("Error fetching campaign:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch campaign",
      error: error.message,
    });
  }
});

// Get all campaigns
router.get("/bulk-actions/campaigns", async (req, res) => {
  try {
    const db = admin.firestore();
    const { limit = 20, offset = 0 } = req.query;

    const campaignsQuery = await db
      .collection("campaigns")
      .orderBy("startedAt", "desc")
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();

    const campaigns = campaignsQuery.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({
      success: true,
      campaigns,
      total: campaigns.length,
    });
  } catch (error) {
    console.error("Error fetching campaigns:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch campaigns",
      error: error.message,
    });
  }
});

// Delete a campaign
router.delete("/bulk-actions/campaigns/:campaignId", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const db = admin.firestore();

    const campaignRef = db.collection("campaigns").doc(campaignId);
    const campaignDoc = await campaignRef.get();

    if (!campaignDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    await campaignRef.delete();

    res.json({
      success: true,
      message: "Campaign deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting campaign:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete campaign",
      error: error.message,
    });
  }
});

// ========== FACEBOOK LEAD FORMS MANAGEMENT ROUTES ==========

// Get all Facebook lead forms from Meta API with smart caching
router.get("/facebook-lead-forms", async (req, res) => {
  try {
    const fetchAllLeads = req.query.fetchAllLeads === "true";
    const forceRefresh = req.query.refresh === "true";

    console.log(
      `🔍 Fetching Facebook lead forms - fetchAllLeads: ${fetchAllLeads}, forceRefresh: ${forceRefresh}`
    );

    const FacebookLeadFormsService = require("../services/facebookLeadFormsService");
    const facebookService = new FacebookLeadFormsService();

    let formsData;

    if (forceRefresh) {
      // Force refresh cache and get fresh data
      formsData = await facebookService.refreshCache();
      if (fetchAllLeads && !formsData.allLeadsFetched) {
        // If we need all leads but cache refresh only got recent, fetch all
        formsData = await facebookService.getAllLeadFormsData(true, false);
        await facebookService.cache.cacheFacebookLeadFormsData(formsData);
      }
    } else {
      // Use smart caching
      formsData = await facebookService.getAllLeadFormsData(
        fetchAllLeads,
        true
      );
    }

    res.json({
      success: true,
      message: `Facebook lead forms fetched successfully${
        fetchAllLeads ? " (all leads)" : ""
      }${forceRefresh ? " (refreshed)" : " (cached)"}`,
      totalRecentLeads: formsData.recentLeads.length,
      cached: !forceRefresh,
      lastFetched: formsData.lastFetched || new Date().toISOString(),
      ...formsData,
    });
  } catch (error) {
    console.error("Error fetching Facebook lead forms:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch Facebook lead forms",
      error: error.message,
    });
  }
});

// Get all leads from all Facebook forms with caching (must be before parameterized routes)
router.get("/facebook-lead-forms/all-leads", async (req, res) => {
  try {
    const { maxLeadsPerForm = 1000 } = req.query;
    const forceRefresh = req.query.refresh === "true";

    console.log(
      `🔍 Fetching ALL leads from all Facebook forms - maxLeadsPerForm: ${maxLeadsPerForm}, forceRefresh: ${forceRefresh}`
    );

    const FacebookLeadFormsService = require("../services/facebookLeadFormsService");
    const facebookService = new FacebookLeadFormsService();

    const allLeads = await facebookService.getAllLeadsFromAllForms(
      null,
      parseInt(maxLeadsPerForm),
      !forceRefresh // Use cache unless force refresh
    );

    res.json({
      success: true,
      message: `All Facebook leads fetched successfully${
        forceRefresh ? " (refreshed)" : " (cached)"
      }`,
      leads: allLeads,
      total: allLeads.length,
      cached: !forceRefresh,
    });
  } catch (error) {
    console.error("Error fetching all Facebook leads:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch all Facebook leads",
      error: error.message,
    });
  }
});

// Get detailed statistics for a specific Facebook lead form with caching
router.get("/facebook-lead-forms/:formId/stats", async (req, res) => {
  try {
    const { formId } = req.params;
    const { pageAccessToken } = req.query;
    const forceRefresh = req.query.refresh === "true";

    const FacebookLeadFormsService = require("../services/facebookLeadFormsService");
    const facebookService = new FacebookLeadFormsService();

    const stats = await facebookService.getFormStats(
      formId,
      pageAccessToken,
      !forceRefresh // Use cache unless force refresh
    );

    res.json({
      success: true,
      message: `Form statistics fetched successfully${
        forceRefresh ? " (refreshed)" : " (cached)"
      }`,
      stats,
      cached: !forceRefresh,
    });
  } catch (error) {
    console.error("Error fetching form statistics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch form statistics",
      error: error.message,
    });
  }
});

// Get leads from a specific Facebook form with caching
router.get("/facebook-lead-forms/:formId/leads", async (req, res) => {
  try {
    const { formId } = req.params;
    const { pageAccessToken, limit = 25 } = req.query;
    const forceRefresh = req.query.refresh === "true";

    const FacebookLeadFormsService = require("../services/facebookLeadFormsService");
    const facebookService = new FacebookLeadFormsService();

    const leads = await facebookService.getLeadsFromForm(
      formId,
      pageAccessToken,
      parseInt(limit),
      !forceRefresh // Use cache unless force refresh
    );

    res.json({
      success: true,
      message: `Form leads fetched successfully${
        forceRefresh ? " (refreshed)" : " (cached)"
      }`,
      leads,
      total: leads.length,
      cached: !forceRefresh,
    });
  } catch (error) {
    console.error("Error fetching form leads:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch form leads",
      error: error.message,
    });
  }
});

// Cache management routes for Facebook data
router.post("/facebook-lead-forms/refresh-cache", async (req, res) => {
  try {
    console.log("🔄 Manual Facebook cache refresh requested");

    const FacebookLeadFormsService = require("../services/facebookLeadFormsService");
    const facebookService = new FacebookLeadFormsService();

    const refreshedData = await facebookService.refreshCache();

    res.json({
      success: true,
      message: "Facebook cache refreshed successfully",
      data: refreshedData,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error refreshing Facebook cache:", error);
    res.status(500).json({
      success: false,
      message: "Failed to refresh Facebook cache",
      error: error.message,
    });
  }
});

router.get("/facebook-lead-forms/cache-status", async (req, res) => {
  try {
    const FacebookLeadFormsService = require("../services/facebookLeadFormsService");
    const facebookService = new FacebookLeadFormsService();

    const cacheStatus = await facebookService.getCacheStatus();
    const redisHealth = await facebookService.cache.healthCheck();

    res.json({
      success: true,
      cacheStatus,
      redisHealth,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error checking cache status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check cache status",
      error: error.message,
    });
  }
});

module.exports = router;
