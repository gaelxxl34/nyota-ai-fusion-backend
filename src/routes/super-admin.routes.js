const express = require("express");
const router = express.Router();
const { admin } = require("../config/firebase.config");
const { authenticateUser } = require("../middleware/auth.middleware");
const bcrypt = require("bcryptjs");

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

    // Delete from Firestore
    await userRef.delete();

    // Delete from Firebase Auth
    try {
      await admin.auth().deleteUser(userId);
    } catch (authError) {
      console.error("Error deleting user from Auth:", authError);
      // Continue even if Auth deletion fails
    }

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete user",
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

    // Get counts for various collections
    const [usersSnapshot, leadsSnapshot, applicationsSnapshot] =
      await Promise.all([
        db.collection("users").get(),
        db.collection("leads").get(),
        db.collection("applications").get(),
      ]);

    // Count users by role
    const usersByRole = {};
    usersSnapshot.docs.forEach((doc) => {
      const role = doc.data().role || "unknown";
      usersByRole[role] = (usersByRole[role] || 0) + 1;
    });

    // Count leads by status
    const leadsByStatus = {};
    leadsSnapshot.docs.forEach((doc) => {
      const status = doc.data().status || "unknown";
      leadsByStatus[status] = (leadsByStatus[status] || 0) + 1;
    });

    res.json({
      success: true,
      stats: {
        totalUsers: usersSnapshot.size,
        totalLeads: leadsSnapshot.size,
        totalApplications: applicationsSnapshot.size,
        usersByRole,
        leadsByStatus,
        systemHealth: "operational",
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
            autoQualification: true,
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

module.exports = router;
