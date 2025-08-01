const fs = require("fs").promises;
const path = require("path");
const aiService = require("./ai.service");

class KnowledgeBaseService {
  constructor() {
    this.csvPath = path.join(
      __dirname,
      "../../data/Iuea Knowledgebase with Categories.csv"
    );
  }

  async getKnowledgeBase() {
    try {
      const csvData = await fs.readFile(this.csvPath, "utf8");
      const items = this.parseCSVToStructuredData(csvData);
      return {
        success: true,
        data: items,
        totalItems: items.length,
      };
    } catch (error) {
      console.error("Error reading knowledge base:", error);
      throw new Error("Failed to read knowledge base file");
    }
  }

  async updateKnowledgeBase(items) {
    try {
      // Validate the items structure
      if (!Array.isArray(items)) {
        throw new Error("Items must be an array");
      }

      // Convert structured data back to CSV format
      const csvData = this.convertToCsv(items);

      // Create backup of existing file
      await this.createBackup();

      // Write new CSV data
      await fs.writeFile(this.csvPath, csvData, "utf8");

      // Reload AI service knowledge base
      await aiService.reloadKnowledgeBase();

      return {
        success: true,
        message: "Knowledge base updated successfully",
        updatedItems: items.length,
      };
    } catch (error) {
      console.error("Error updating knowledge base:", error);
      throw new Error(`Failed to update knowledge base: ${error.message}`);
    }
  }

  async addKnowledgeItem(item) {
    try {
      const knowledgeBase = await this.getKnowledgeBase();
      const items = knowledgeBase.data;

      // Add new item with generated ID
      const newItem = {
        id: this.generateId(),
        question: item.question,
        answer: item.answer,
        category: item.category || "",
        type: "qa",
      };

      items.push(newItem);

      await this.updateKnowledgeBase(items);

      return {
        success: true,
        message: "Knowledge item added successfully",
        item: newItem,
      };
    } catch (error) {
      console.error("Error adding knowledge item:", error);
      throw new Error(`Failed to add knowledge item: ${error.message}`);
    }
  }

  async updateKnowledgeItem(id, updatedItem) {
    try {
      const knowledgeBase = await this.getKnowledgeBase();
      const items = knowledgeBase.data;

      const itemIndex = items.findIndex((item) => item.id === id);
      if (itemIndex === -1) {
        throw new Error("Knowledge item not found");
      }

      // Update the item
      items[itemIndex] = {
        ...items[itemIndex],
        question: updatedItem.question,
        answer: updatedItem.answer,
        category: updatedItem.category || items[itemIndex].category,
      };

      await this.updateKnowledgeBase(items);

      return {
        success: true,
        message: "Knowledge item updated successfully",
        item: items[itemIndex],
      };
    } catch (error) {
      console.error("Error updating knowledge item:", error);
      throw new Error(`Failed to update knowledge item: ${error.message}`);
    }
  }

  async deleteKnowledgeItem(id) {
    try {
      const knowledgeBase = await this.getKnowledgeBase();
      const items = knowledgeBase.data;

      const itemIndex = items.findIndex((item) => item.id === id);
      if (itemIndex === -1) {
        throw new Error("Knowledge item not found");
      }

      // Remove the item
      const deletedItem = items.splice(itemIndex, 1)[0];

      await this.updateKnowledgeBase(items);

      return {
        success: true,
        message: "Knowledge item deleted successfully",
        deletedItem,
      };
    } catch (error) {
      console.error("Error deleting knowledge item:", error);
      throw new Error(`Failed to delete knowledge item: ${error.message}`);
    }
  }

  async getCategories() {
    try {
      const knowledgeBase = await this.getKnowledgeBase();
      const categories = new Set();

      knowledgeBase.data.forEach((item) => {
        if (item.category && item.category.trim()) {
          categories.add(item.category.trim());
        }
      });

      return {
        success: true,
        categories: Array.from(categories).sort(),
      };
    } catch (error) {
      console.error("Error getting categories:", error);
      throw new Error("Failed to get categories");
    }
  }

  parseCSVToStructuredData(csvData) {
    const items = [];
    const lines = csvData.split("\n");
    let currentCategory = "";
    let idCounter = 1;

    lines.forEach((line, index) => {
      if (index === 0) return; // Skip header

      const cleanLine = line.trim().replace(/\r$/, "");
      if (!cleanLine) return;

      // Parse CSV line properly handling quotes
      const fields = this.parseCSVLine(cleanLine);
      const question = fields[0] || "";
      const answer = fields[1] || "";

      if (question && question.startsWith("CATEGORY:")) {
        currentCategory = question.replace("CATEGORY:", "").trim();
        items.push({
          id: `cat_${idCounter++}`,
          question: "",
          answer: "",
          category: currentCategory,
          type: "category",
        });
        return;
      }

      if (question && question.startsWith("SUB-CATEGORY:")) {
        const subCategory = question.replace("SUB-CATEGORY:", "").trim();
        items.push({
          id: `subcat_${idCounter++}`,
          question: "",
          answer: "",
          category: `${currentCategory} > ${subCategory}`,
          type: "subcategory",
        });
        return;
      }

      if (
        question &&
        answer &&
        question !== "Questions" &&
        answer !== "Answers"
      ) {
        items.push({
          id: `qa_${idCounter++}`,
          question: question.trim(),
          answer: answer.trim(),
          category: currentCategory,
          type: "qa",
        });
      }
    });

    return items;
  }

  parseCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  convertToCsv(items) {
    let csvContent = "Questions,Answers,,,,,,,,,,,,,,,,,,,,,,,,\n";
    let currentCategory = "";

    items.forEach((item) => {
      if (item.type === "category") {
        currentCategory = item.category;
        csvContent += `CATEGORY: ${item.category} ,,,,,,,,,,,,,,,,,,,,,,,,,\n`;
      } else if (item.type === "subcategory") {
        const subCat = item.category.split(" > ").pop();
        csvContent += `SUB-CATEGORY: ${subCat},,,,,,,,,,,,,,,,,,,,,,,,,\n`;
      } else if (item.type === "qa" && item.question && item.answer) {
        // Escape commas and quotes in CSV
        const question = this.escapeCsvField(item.question);
        const answer = this.escapeCsvField(item.answer);
        csvContent += `${question},${answer},,,,,,,,,,,,,,,,,,,,,,,,\n`;
      }
    });

    return csvContent;
  }

  escapeCsvField(field) {
    if (field.includes(",") || field.includes('"') || field.includes("\n")) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }

  generateId() {
    return `kb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async createBackup() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(
        path.dirname(this.csvPath),
        `Iuea_Knowledgebase_backup_${timestamp}.csv`
      );

      const originalData = await fs.readFile(this.csvPath, "utf8");
      await fs.writeFile(backupPath, originalData, "utf8");

      console.log(`✅ Knowledge base backup created: ${backupPath}`);
    } catch (error) {
      console.warn("Failed to create backup:", error.message);
      // Don't throw error - backup failure shouldn't stop the update
    }
  }

  async getBackups() {
    try {
      const dataDir = path.dirname(this.csvPath);
      const files = await fs.readdir(dataDir);

      const backups = files
        .filter((file) => file.startsWith("Iuea_Knowledgebase_backup_"))
        .map((file) => ({
          filename: file,
          path: path.join(dataDir, file),
        }))
        .sort((a, b) => b.filename.localeCompare(a.filename)); // Most recent first

      return {
        success: true,
        backups,
      };
    } catch (error) {
      console.error("Error getting backups:", error);
      return {
        success: false,
        backups: [],
      };
    }
  }

  async restoreFromBackup(backupFilename) {
    try {
      const backupPath = path.join(path.dirname(this.csvPath), backupFilename);

      // Verify backup file exists
      await fs.access(backupPath);

      // Create backup of current file before restore
      await this.createBackup();

      // Copy backup file to main knowledge base file
      const backupData = await fs.readFile(backupPath, "utf8");
      await fs.writeFile(this.csvPath, backupData, "utf8");

      // Reload AI service knowledge base
      await aiService.reloadKnowledgeBase();

      return {
        success: true,
        message: "Knowledge base restored successfully",
      };
    } catch (error) {
      console.error("Error restoring from backup:", error);
      throw new Error(`Failed to restore from backup: ${error.message}`);
    }
  }
}

module.exports = new KnowledgeBaseService();
