const express = require("express");
const router = express.Router();
const knowledgeBaseService = require("../services/knowledgeBaseService");
const { authenticateUser } = require("../middleware/auth.middleware");
const { checkRole } = require("../middleware/permissions.middleware");

// Apply authentication to all routes
router.use(authenticateUser);

// Get all knowledge base items
router.get(
  "/",
  checkRole([
    "superAdmin",
    "admin",
    "admissionAdmin",
    "marketingAgent",
    "admissionAgent",
  ]),
  async (req, res) => {
    try {
      const result = await knowledgeBaseService.getKnowledgeBase();
      res.json(result);
    } catch (error) {
      console.error("Error fetching knowledge base:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch knowledge base",
        error: error.message,
      });
    }
  }
);

// Get knowledge base categories
router.get(
  "/categories",
  checkRole([
    "superAdmin",
    "admin",
    "admissionAdmin",
    "marketingAgent",
    "admissionAgent",
  ]),
  async (req, res) => {
    try {
      const result = await knowledgeBaseService.getCategories();
      res.json(result);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch categories",
        error: error.message,
      });
    }
  }
);

// Add new knowledge item
router.post(
  "/",
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      const { question, answer, category } = req.body;

      if (!question || !answer) {
        return res.status(400).json({
          success: false,
          message: "Question and answer are required",
        });
      }

      const result = await knowledgeBaseService.addKnowledgeItem({
        question,
        answer,
        category,
      });

      res.status(201).json(result);
    } catch (error) {
      console.error("Error adding knowledge item:", error);
      res.status(500).json({
        success: false,
        message: "Failed to add knowledge item",
        error: error.message,
      });
    }
  }
);

// Update knowledge item
router.put(
  "/:id",
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { question, answer, category } = req.body;

      if (!question || !answer) {
        return res.status(400).json({
          success: false,
          message: "Question and answer are required",
        });
      }

      const result = await knowledgeBaseService.updateKnowledgeItem(id, {
        question,
        answer,
        category,
      });

      res.json(result);
    } catch (error) {
      console.error("Error updating knowledge item:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update knowledge item",
        error: error.message,
      });
    }
  }
);

// Delete knowledge item
router.delete(
  "/:id",
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const result = await knowledgeBaseService.deleteKnowledgeItem(id);
      res.json(result);
    } catch (error) {
      console.error("Error deleting knowledge item:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete knowledge item",
        error: error.message,
      });
    }
  }
);

// Bulk update knowledge base
router.put(
  "/",
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      const { items } = req.body;

      if (!Array.isArray(items)) {
        return res.status(400).json({
          success: false,
          message: "Items must be an array",
        });
      }

      const result = await knowledgeBaseService.updateKnowledgeBase(items);
      res.json(result);
    } catch (error) {
      console.error("Error bulk updating knowledge base:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update knowledge base",
        error: error.message,
      });
    }
  }
);

// Get backup files
router.get(
  "/backups",
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      const result = await knowledgeBaseService.getBackups();
      res.json(result);
    } catch (error) {
      console.error("Error fetching backups:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch backups",
        error: error.message,
      });
    }
  }
);

// Restore from backup
router.post(
  "/restore",
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      const { backupFilename } = req.body;

      if (!backupFilename) {
        return res.status(400).json({
          success: false,
          message: "Backup filename is required",
        });
      }

      const result = await knowledgeBaseService.restoreFromBackup(
        backupFilename
      );
      res.json(result);
    } catch (error) {
      console.error("Error restoring from backup:", error);
      res.status(500).json({
        success: false,
        message: "Failed to restore from backup",
        error: error.message,
      });
    }
  }
);

module.exports = router;
