const express = require("express");
const router = express.Router();
const { admin } = require("../config/firebase.config");
const { authenticateUser } = require("../middleware/auth.middleware");

// Admin routes for managing organizations

// Get all organizations (System Admin only)
router.get("/", authenticateUser, async (req, res) => {
  try {
    // Check if user is system admin
    if (req.user.role !== "systemAdmin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. System admin role required.",
      });
    }

    const db = admin.firestore();
    const orgsSnapshot = await db.collection("organizations").get();

    const organizations = orgsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(organizations);
  } catch (error) {
    console.error("Error fetching organizations:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch organizations",
      error: error.message,
    });
  }
});

// Create new organization (System Admin only)
router.post("/", authenticateUser, async (req, res) => {
  try {
    // Check if user is system admin
    if (req.user.role !== "systemAdmin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. System admin role required.",
      });
    }

    const db = admin.firestore();
    const orgData = {
      ...req.body,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection("organizations").add(orgData);

    res.json({
      success: true,
      message: "Organization created successfully",
      organization: {
        id: docRef.id,
        ...orgData,
      },
    });
  } catch (error) {
    console.error("Error creating organization:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create organization",
      error: error.message,
    });
  }
});

// Update organization (System Admin only)
router.put("/:id", authenticateUser, async (req, res) => {
  try {
    // Check if user is system admin
    if (req.user.role !== "systemAdmin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. System admin role required.",
      });
    }

    const { id } = req.params;
    const db = admin.firestore();

    const updateData = {
      ...req.body,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("organizations").doc(id).update(updateData);

    res.json({
      success: true,
      message: "Organization updated successfully",
    });
  } catch (error) {
    console.error("Error updating organization:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update organization",
      error: error.message,
    });
  }
});

// Delete organization (System Admin only)
router.delete("/:id", authenticateUser, async (req, res) => {
  try {
    // Check if user is system admin
    if (req.user.role !== "systemAdmin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. System admin role required.",
      });
    }

    const { id } = req.params;
    const db = admin.firestore();

    await db.collection("organizations").doc(id).delete();

    res.json({
      success: true,
      message: "Organization deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting organization:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete organization",
      error: error.message,
    });
  }
});

module.exports = router;
