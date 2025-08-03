const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");
const db = admin.firestore();
const { authenticateUser } = require("../middleware/auth.middleware");
const { checkRole } = require("../middleware/permissions.middleware");
const { ROLES } = require("../config/roles.config");

// Get all team members
router.get(
  "/members",
  authenticateUser,
  checkRole(["superAdmin", "admin"]),
  async (req, res) => {
    try {
      console.log("Fetching team members...");

      // Get all users from Firebase Auth
      const listUsersResult = await admin.auth().listUsers();
      const users = listUsersResult.users;

      // Get additional user data from Firestore
      const userDocs = await Promise.all(
        users.map(async (user) => {
          const userDoc = await db.collection("users").doc(user.uid).get();
          return {
            id: user.uid,
            email: user.email || "",
            name: user.displayName || userDoc.data()?.name || "Unnamed User",
            role: user.customClaims?.role || userDoc.data()?.role || "admin",
            jobRole: userDoc.data()?.jobRole,
            status: userDoc.data()?.status || "active",
            createdAt: user.metadata.creationTime,
            lastSignIn: user.metadata.lastSignInTime,
          };
        })
      );

      // Filter out super admins from the list
      const teamMembers = userDocs.filter((user) => user.role !== "superAdmin");

      console.log(`Found ${teamMembers.length} team members`);

      res.json({
        success: true,
        members: teamMembers,
      });
    } catch (error) {
      console.error("Error fetching team members:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch team members",
        error: error.message,
      });
    }
  }
);

// Add a new team member
router.post(
  "/members",
  authenticateUser,
  checkRole(["superAdmin", "admin"]),
  async (req, res) => {
    try {
      const { email, name, role, jobRole } = req.body;

      if (!email || !name || !role) {
        return res.status(400).json({
          success: false,
          message: "Email, name, and role are required",
        });
      }

      // Generate a random password
      const password =
        Math.random().toString(36).slice(-8) +
        Math.random().toString(36).slice(-8);

      // Create user in Firebase Auth
      const userRecord = await admin.auth().createUser({
        email,
        password,
        displayName: name,
      });

      // Set custom claims
      await admin.auth().setCustomUserClaims(userRecord.uid, { role });

      // Create user document in Firestore
      await db
        .collection("users")
        .doc(userRecord.uid)
        .set({
          email,
          name,
          role,
          jobRole: jobRole || role,
          status: "active",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      res.json({
        success: true,
        message: `Team member added successfully. Temporary password: ${password}`,
        member: {
          id: userRecord.uid,
          email,
          name,
          role,
          jobRole: jobRole || role,
          status: "active",
        },
      });
    } catch (error) {
      console.error("Error adding team member:", error);
      res.status(500).json({
        success: false,
        message:
          error.code === "auth/email-already-exists"
            ? "A user with this email already exists"
            : "Failed to add team member",
        error: error.message,
      });
    }
  }
);

// Update a team member
router.put(
  "/members/:id",
  authenticateUser,
  checkRole(["superAdmin", "admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, role, jobRole, status } = req.body;

      const updates = {};
      if (name) updates.displayName = name;

      // Update Firebase Auth user
      if (Object.keys(updates).length > 0) {
        await admin.auth().updateUser(id, updates);
      }

      // Update custom claims if role changed
      if (role) {
        await admin.auth().setCustomUserClaims(id, { role });
      }

      // Update Firestore document
      const firestoreUpdates = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (name) firestoreUpdates.name = name;
      if (role) firestoreUpdates.role = role;
      if (jobRole) firestoreUpdates.jobRole = jobRole;
      if (status) firestoreUpdates.status = status;

      await db.collection("users").doc(id).update(firestoreUpdates);

      res.json({
        success: true,
        message: "Team member updated successfully",
      });
    } catch (error) {
      console.error("Error updating team member:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update team member",
        error: error.message,
      });
    }
  }
);

// Delete a team member
router.delete(
  "/members/:id",
  authenticateUser,
  checkRole(["superAdmin", "admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Get user info before deletion
      const userRecord = await admin.auth().getUser(id);
      const userDoc = await db.collection("users").doc(id).get();
      const userData = userDoc.data();

      // Prevent deletion of super admins
      if (
        userRecord.customClaims?.role === "superAdmin" ||
        userData?.role === "superAdmin"
      ) {
        return res.status(403).json({
          success: false,
          message: "Cannot delete super admin users",
        });
      }

      // Delete from Firebase Auth
      await admin.auth().deleteUser(id);

      // Delete from Firestore
      await db.collection("users").doc(id).delete();

      res.json({
        success: true,
        message: "Team member deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting team member:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete team member",
        error: error.message,
      });
    }
  }
);

// Get team member by ID
router.get(
  "/members/:id",
  authenticateUser,
  checkRole(["superAdmin", "admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const userRecord = await admin.auth().getUser(id);
      const userDoc = await db.collection("users").doc(id).get();
      const userData = userDoc.data() || {};

      const member = {
        id: userRecord.uid,
        email: userRecord.email,
        name: userRecord.displayName || userData.name || "Unnamed User",
        role: userRecord.customClaims?.role || userData.role || "teamMember",
        jobRole: userData.jobRole,
        status: userData.status || "active",
        createdAt: userRecord.metadata.creationTime,
        lastSignIn: userRecord.metadata.lastSignInTime,
      };

      res.json({
        success: true,
        member,
      });
    } catch (error) {
      console.error("Error fetching team member:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch team member",
        error: error.message,
      });
    }
  }
);

module.exports = router;
