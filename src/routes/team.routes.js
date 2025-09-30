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
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
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
          const userData = userDoc.data() || {};

          // Only use explicitly defined roles from role field, don't check jobRole
          const role = userData.role || user.customClaims?.role;

          console.log(
            `User ${user.email}: customClaims.role=${user.customClaims?.role}, firestore.role=${userData.role}, final.role=${role}`
          );

          return {
            id: user.uid,
            email: user.email || "",
            name: user.displayName || userData.name || "Unnamed User",
            role: role,
            status: userData.status,
            createdAt: user.metadata.creationTime,
            lastSignIn: user.metadata.lastSignInTime,
          };
        })
      );

      // Filter out super admins and users without defined roles from the list
      const teamMembers = userDocs.filter(
        (user) =>
          user.role !== "superAdmin" &&
          user.role !== undefined &&
          user.role !== null
      );

      console.log(
        `Found ${teamMembers.length} team members (before super admin filter: ${userDocs.length})`
      );
      console.log(
        "Team members breakdown:",
        teamMembers.map((u) => ({ email: u.email, role: u.role }))
      );

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
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      const { email, name, role } = req.body;

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
      await db.collection("users").doc(userRecord.uid).set({
        email,
        name,
        role,
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
      const { name, role, status } = req.body;

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

// Get Firebase authentication data for team members
router.post(
  "/members/auth-data",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      const { memberEmails } = req.body;

      if (!memberEmails || !Array.isArray(memberEmails)) {
        return res.status(400).json({
          success: false,
          message: "memberEmails array is required",
        });
      }

      console.log(
        `Fetching Firebase auth data for ${memberEmails.length} members...`
      );

      // Get Firebase auth data for each email
      const authDataPromises = memberEmails.map(async (email) => {
        try {
          // Get user by email from Firebase Auth
          const userRecord = await admin.auth().getUserByEmail(email);

          return {
            uid: userRecord.uid,
            email: userRecord.email,
            emailVerified: userRecord.emailVerified,
            disabled: userRecord.disabled,
            lastSignInTime: userRecord.metadata.lastSignInTime,
            lastRefreshTime: userRecord.metadata.lastRefreshTime,
            creationTime: userRecord.metadata.creationTime,
            provider: userRecord.providerData?.[0]?.providerId || "password",
            customClaims: userRecord.customClaims || {},
          };
        } catch (error) {
          console.warn(
            `Could not fetch auth data for ${email}:`,
            error.message
          );
          // Return partial data if user not found in Firebase Auth
          return {
            email,
            uid: null,
            emailVerified: false,
            disabled: false,
            lastSignInTime: null,
            lastRefreshTime: null,
            creationTime: null,
            provider: "unknown",
            customClaims: {},
            error: error.message,
          };
        }
      });

      const authData = await Promise.all(authDataPromises);

      console.log(
        `Successfully fetched auth data for ${
          authData.filter((d) => d.uid).length
        }/${memberEmails.length} members`
      );

      res.json({
        success: true,
        authData,
        message: `Fetched authentication data for ${authData.length} members`,
      });
    } catch (error) {
      console.error("Error fetching Firebase auth data:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch authentication data",
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
        role: userData.role || userRecord.customClaims?.role,
        status: userData.status,
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
