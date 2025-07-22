const express = require("express");
const router = express.Router();
const { admin } = require("../config/firebase.config");
const { authenticateUser } = require("../middleware/auth.middleware");
const crypto = require("crypto");

// Generate secure random password
function generateSecurePassword() {
  const specialChars = "!@#$%^&*()_+";
  const numbers = "0123456789";
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lowercase = "abcdefghijklmnopqrstuvwxyz";

  // Ensure at least one of each type
  const password = [
    uppercase[Math.floor(Math.random() * uppercase.length)],
    lowercase[Math.floor(Math.random() * lowercase.length)],
    numbers[Math.floor(Math.random() * numbers.length)],
    specialChars[Math.floor(Math.random() * specialChars.length)],
  ];

  // Add more random characters to reach desired length
  while (password.length < 10) {
    const charset = uppercase + lowercase + numbers + specialChars;
    password.push(charset[Math.floor(Math.random() * charset.length)]);
  }

  // Shuffle the password characters
  return password.sort(() => 0.5 - Math.random()).join("");
}

// Get all team members for an organization
router.get("/", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const organizationId = req.user.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: "No organization ID found for this user",
      });
    }

    const db = admin.firestore();

    // Get all users with this organization ID
    const usersSnapshot = await db
      .collection("users")
      .where("organizationId", "==", organizationId)
      .get();

    const users = [];
    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      users.push({
        id: doc.id,
        email: userData.email,
        name: userData.name || userData.email.split("@")[0],
        role: userData.role,
        status: userData.status || "active",
        createdAt: userData.createdAt?.toDate?.() || null,
        lastLogin: userData.lastLogin?.toDate?.() || null,
      });
    });

    return res.json({
      success: true,
      team: users,
    });
  } catch (error) {
    console.error("Error fetching team members:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch team members",
    });
  }
});

// Add team member
router.post("/", authenticateUser, async (req, res) => {
  try {
    const { email, name, role } = req.body;
    const organizationId = req.user.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: "No organization ID found for this user",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const db = admin.firestore();
    const auth = admin.auth();

    // Check if user already exists
    try {
      const userRecord = await auth.getUserByEmail(email);

      // User exists, check if they're already in our organization
      const userDoc = await db.collection("users").doc(userRecord.uid).get();

      if (userDoc.exists) {
        const userData = userDoc.data();
        if (userData.organizationId === organizationId) {
          return res.status(400).json({
            success: false,
            message: "User already exists in this organization",
          });
        } else {
          return res.status(400).json({
            success: false,
            message: "User exists in another organization",
          });
        }
      }

      // User exists in Auth but not in Firestore
      const password = generateSecurePassword();
      await auth.updateUser(userRecord.uid, { password });

      await db
        .collection("users")
        .doc(userRecord.uid)
        .set({
          email,
          name: name || email.split("@")[0],
          role: role || "user",
          organizationId,
          status: "active",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      return res.status(201).json({
        success: true,
        message: "User added to organization successfully",
        user: {
          id: userRecord.uid,
          email,
          name: name || email.split("@")[0],
          role: role || "user",
        },
      });
    } catch (error) {
      // User doesn't exist, create new user
      if (error.code === "auth/user-not-found") {
        const password = generateSecurePassword();

        const userRecord = await auth.createUser({
          email,
          password,
          emailVerified: false,
        });

        await db
          .collection("users")
          .doc(userRecord.uid)
          .set({
            email,
            name: name || email.split("@")[0],
            role: role || "user",
            organizationId,
            status: "active",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

        return res.status(201).json({
          success: true,
          message: `Team member created with password: ${password}`,
          user: {
            id: userRecord.uid,
            email,
            name: name || email.split("@")[0],
            role: role || "user",
          },
        });
      }

      throw error;
    }
  } catch (error) {
    console.error("Error adding team member:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add team member",
    });
  }
});

// Update team member
router.put("/:userId", authenticateUser, async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, role, status } = req.body;
    const organizationId = req.user.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: "No organization ID found for this user",
      });
    }

    const db = admin.firestore();

    // Verify user belongs to this organization
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    const userData = userDoc.data();
    if (userData.organizationId !== organizationId) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to update this team member",
      });
    }

    // Update user
    const updateData = {};
    if (name) updateData.name = name;
    if (role) updateData.role = role;
    if (status) updateData.status = status;

    await db
      .collection("users")
      .doc(userId)
      .update({
        ...updateData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return res.json({
      success: true,
      message: "Team member updated successfully",
    });
  } catch (error) {
    console.error("Error updating team member:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update team member",
    });
  }
});

// Delete team member
router.delete("/:userId", authenticateUser, async (req, res) => {
  try {
    const { userId } = req.params;
    const organizationId = req.user.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: "No organization ID found for this user",
      });
    }

    const db = admin.firestore();

    // Verify user belongs to this organization
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    const userData = userDoc.data();
    if (userData.organizationId !== organizationId) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to delete this team member",
      });
    }

    // Delete user from Firestore (optionally delete from Auth too)
    await db.collection("users").doc(userId).delete();

    return res.json({
      success: true,
      message: "Team member removed from organization successfully",
    });
  } catch (error) {
    console.error("Error deleting team member:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete team member",
    });
  }
});

module.exports = router;
