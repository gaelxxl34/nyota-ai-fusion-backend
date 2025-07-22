const fs = require("fs");
const path = require("path");

class CSVDataProcessor {
  constructor() {
    this.csvPath = path.join(
      __dirname,
      "../../..",
      "nyota-ai-fusion-frontend",
      "src",
      "docs",
      "Iuea Knowledgebase with Categories.csv"
    );
  }

  /**
   * Parse CSV content and organize into structured knowledge base
   */
  parseCSVData() {
    try {
      const csvContent = fs.readFileSync(this.csvPath, "utf-8");
      const lines = csvContent.split("\n").filter((line) => line.trim());

      const knowledgeItems = [];
      let currentCategory = "";
      let currentSubCategory = "";
      let idCounter = 1000; // Start from 1000 to avoid conflicts

      for (const line of lines) {
        const cleanLine = line.trim();
        if (!cleanLine) continue;

        // Check for main categories
        if (cleanLine.startsWith("CATEGORY:")) {
          currentCategory = this.extractCategoryName(cleanLine);
          continue;
        }

        // Check for sub-categories
        if (cleanLine.startsWith("SUB-CATEGORY:")) {
          currentSubCategory = this.extractCategoryName(cleanLine);
          continue;
        }

        // Skip lines that are just category markers or empty
        if (
          cleanLine.includes("CATEGORY:") ||
          cleanLine.includes("SUB-CATEGORY:") ||
          cleanLine.includes("CHANGES MADE TO THE NAMES") ||
          cleanLine.includes("OTHER FEES") ||
          cleanLine.split(",").length < 2
        ) {
          continue;
        }

        // Parse question-answer pairs
        const columns = this.parseCSVLine(cleanLine);
        if (columns.length >= 2 && columns[0] && columns[1]) {
          const question = columns[0].trim();
          const answer = columns[1].trim();

          if (question && answer && !question.includes("CATEGORY")) {
            const item = this.createKnowledgeItem(
              idCounter++,
              currentCategory,
              currentSubCategory,
              question,
              answer
            );
            knowledgeItems.push(item);
          }
        }
      }

      return knowledgeItems;
    } catch (error) {
      console.error("Error parsing CSV data:", error);
      return [];
    }
  }

  /**
   * Parse CSV line handling quoted content
   */
  parseCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }

    result.push(current);
    return result.map((item) => item.replace(/^"|"$/g, "").trim());
  }

  /**
   * Extract category name from category line
   */
  extractCategoryName(line) {
    return line.replace(/^(SUB-)?CATEGORY:\s*/, "").trim();
  }

  /**
   * Create structured knowledge item
   */
  createKnowledgeItem(id, category, subCategory, question, answer) {
    // Enhanced smart categorization based on content analysis
    const smartCategory = this.smartCategorizeContent(
      question,
      answer,
      category,
      subCategory
    );

    // Generate tags based on content
    const tags = this.generateTags(question, answer, category, subCategory);

    // Determine priority based on content importance
    const priority = this.determinePriority(question, answer);

    return {
      id,
      category: smartCategory,
      subCategory,
      title: question,
      content: answer,
      tags,
      priority,
      source: "csv-import",
      dateAdded: new Date().toISOString(),
    };
  }

  /**
   * Smart categorization algorithm based on content analysis
   */
  smartCategorizeContent(question, answer, csvCategory, subCategory) {
    const content = (
      question +
      " " +
      answer +
      " " +
      (csvCategory || "") +
      " " +
      (subCategory || "")
    ).toLowerCase();

    // Define keyword patterns for each category
    const categoryPatterns = {
      fees: [
        "fee",
        "fees",
        "cost",
        "tuition",
        "payment",
        "dollar",
        "ugx",
        "money",
        "price",
        "scholarship",
        "financial",
        "pay",
        "invoice",
        "bill",
        "budget",
        "installment",
        "registration fee",
        "application fee",
        "exam fee",
      ],

      academics: [
        "course",
        "courses",
        "program",
        "programs",
        "bachelor",
        "master",
        "degree",
        "diploma",
        "certificate",
        "study",
        "studies",
        "curriculum",
        "semester",
        "academic",
        "grade",
        "examination",
        "exam",
        "faculty",
        "faculties",
        "business",
        "engineering",
        "law",
        "technology",
        "science",
        "management",
        "humanities",
        "language",
        "english",
        "french",
        "computer",
        "information",
      ],

      admissions: [
        "admission",
        "admissions",
        "apply",
        "application",
        "requirement",
        "requirements",
        "entry",
        "enroll",
        "enrollment",
        "register",
        "registration",
        "joining",
        "how to apply",
        "when to apply",
        "deadline",
        "selection",
        "eligibility",
      ],

      campus: [
        "campus",
        "visit",
        "location",
        "address",
        "facilities",
        "environment",
        "spirit",
        "community",
        "multicultural",
        "diverse",
        "inclusive",
        "vibrant",
        "photos",
        "videos",
        "youtube",
        "blog",
        "network",
        "alumni",
        "experience",
        "on-campus",
        "notice boards",
        "marketing office",
        "state-of-the-art",
        "modern",
        "world-class",
        "holistic development",
        "extracurricular",
        "career prospects",
      ],

      general: [
        "information",
        "about",
        "iuea",
        "university",
        "contact",
        "phone",
        "email",
        "website",
        "vision",
        "mission",
        "history",
        "established",
        "accreditation",
        "charter",
        "ownership",
        "staff",
        "students",
      ],
    };

    // Category scoring system
    const scores = {};

    Object.keys(categoryPatterns).forEach((category) => {
      scores[category] = 0;
      categoryPatterns[category].forEach((keyword) => {
        // Count keyword occurrences with weighted scoring
        const keywordRegex = new RegExp(`\\b${keyword}\\b`, "gi");
        const matches = content.match(keywordRegex) || [];
        scores[category] += matches.length;

        // Give extra weight to keywords in question (title)
        const questionMatches =
          question.toLowerCase().match(keywordRegex) || [];
        scores[category] += questionMatches.length * 2;
      });
    });

    // Special handling for CSV categories
    if (csvCategory) {
      const csvCat = csvCategory.toLowerCase();

      // Direct category mappings from CSV
      if (
        csvCat.includes("tuition") ||
        csvCat.includes("payment") ||
        csvCat.includes("fee")
      ) {
        scores.fees += 10;
      }
      if (
        csvCat.includes("course") ||
        csvCat.includes("program") ||
        csvCat.includes("academic")
      ) {
        scores.academics += 10;
      }
      if (
        csvCat.includes("admission") ||
        csvCat.includes("enrolment") ||
        csvCat.includes("application")
      ) {
        scores.admissions += 10;
      }
      if (
        csvCat.includes("campus") ||
        csvCat.includes("facility") ||
        csvCat.includes("visit") ||
        csvCat.includes("environment")
      ) {
        scores.campus += 10;
      }
      if (
        csvCat.includes("general") ||
        csvCat.includes("information") ||
        csvCat.includes("greeting")
      ) {
        scores.general += 10;
      }
    }

    // Find category with highest score
    let bestCategory = "general";
    let maxScore = scores.general;

    Object.keys(scores).forEach((category) => {
      if (scores[category] > maxScore) {
        maxScore = scores[category];
        bestCategory = category;
      }
    });

    // If no clear winner or very low scores, use content-specific rules
    if (maxScore < 2) {
      bestCategory = this.fallbackCategorization(content);
    }

    return bestCategory;
  }

  /**
   * Fallback categorization for edge cases
   */
  fallbackCategorization(content) {
    // Simple keyword-based fallback
    if (
      content.includes("how much") ||
      content.includes("cost") ||
      content.includes("$") ||
      content.includes("ugx")
    ) {
      return "fees";
    }
    if (
      content.includes("how to") &&
      (content.includes("apply") ||
        content.includes("join") ||
        content.includes("enroll"))
    ) {
      return "admissions";
    }
    if (
      content.includes("course") ||
      content.includes("program") ||
      content.includes("study")
    ) {
      return "academics";
    }
    if (
      content.includes("visit") ||
      content.includes("campus") ||
      content.includes("location") ||
      content.includes("photos") ||
      content.includes("videos") ||
      content.includes("facilities")
    ) {
      return "campus";
    }

    return "general";
  }

  /**
   * Generate relevant tags for the knowledge item
   */
  generateTags(question, answer, category, subCategory) {
    const tags = [];

    // Add category-based tags
    if (category) tags.push(category.toLowerCase().replace(/\s+/g, "-"));
    if (subCategory) tags.push(subCategory.toLowerCase().replace(/\s+/g, "-"));

    // Add content-based tags
    const content = (question + " " + answer).toLowerCase();

    // Enhanced tag generation with more comprehensive patterns
    const tagPatterns = {
      // Fee-related tags
      fees: [
        "fee",
        "fees",
        "cost",
        "tuition",
        "payment",
        "dollar",
        "ugx",
        "price",
        "scholarship",
        "financial",
        "budget",
      ],

      // Academic tags
      undergraduate: ["bachelor", "undergraduate", "degree"],
      postgraduate: ["master", "masters", "postgraduate", "graduate"],
      programs: ["program", "programs", "course", "courses"],

      // Faculty/Field tags
      business: ["business", "management", "mba", "commerce"],
      engineering: ["engineering", "engineer", "technology", "technical"],
      law: ["law", "legal", "jurisprudence"],
      science: ["science", "computer", "information", "it"],
      humanities: ["humanities", "arts", "literature"],

      // Admission tags
      admission: [
        "admission",
        "admissions",
        "apply",
        "application",
        "requirement",
        "entry",
      ],

      // Contact/Support tags
      contact: ["email", "phone", "contact", "whatsapp", "call"],

      // Facility tags
      facilities: [
        "facility",
        "facilities",
        "campus",
        "library",
        "hostel",
        "accommodation",
        "state-of-the-art",
        "modern",
        "notice boards",
      ],

      // Campus experience tags
      campus: [
        "campus",
        "visit",
        "vibrant",
        "multicultural",
        "diverse",
        "inclusive",
        "community",
        "spirit",
        "environment",
        "experience",
        "alumni",
        "network",
        "photos",
        "videos",
        "youtube",
        "blog",
        "extracurricular",
        "holistic development",
        "career prospects",
      ],

      // Language tags
      english: ["english", "language"],
      french: ["french", "langue"],

      // Academic process tags
      examination: ["exam", "examination", "test", "assessment"],
      semester: ["semester", "term", "academic year"],

      // University info tags
      iuea: ["iuea", "university", "institution"],
      international: ["international", "multicultural", "diverse"],
    };

    // Apply pattern matching for tags
    Object.keys(tagPatterns).forEach((tagCategory) => {
      tagPatterns[tagCategory].forEach((keyword) => {
        if (content.includes(keyword)) {
          tags.push(tagCategory);
        }
      });
    });

    // Add specific high-value tags based on content analysis
    if (content.includes("how much") || content.includes("cost of")) {
      tags.push("pricing", "cost-inquiry");
    }

    if (
      content.includes("how to apply") ||
      content.includes("application process")
    ) {
      tags.push("application-process", "how-to");
    }

    if (content.includes("requirement") || content.includes("eligible")) {
      tags.push("requirements", "eligibility");
    }

    if (content.includes("duration") || content.includes("how long")) {
      tags.push("duration", "timeline");
    }

    if (
      content.includes("location") ||
      content.includes("address") ||
      content.includes("where")
    ) {
      tags.push("location", "address");
    }

    // Remove duplicates and return
    return [...new Set(tags)];
  }

  /**
   * Determine priority based on content importance
   */
  determinePriority(question, answer) {
    const content = (question + " " + answer).toLowerCase();

    // High priority for fees, admission requirements, contact info
    if (
      content.includes("tuition fee") ||
      content.includes("application fee") ||
      content.includes("academic requirement") ||
      content.includes("how do i apply") ||
      content.includes("contact") ||
      content.includes("email") ||
      content.includes("phone")
    ) {
      return "high";
    }

    // Medium priority for general program info, facilities
    if (
      content.includes("program") ||
      content.includes("course") ||
      content.includes("facility") ||
      content.includes("requirement")
    ) {
      return "medium";
    }

    // Low priority for events, parties, general info
    return "low";
  }
}

module.exports = CSVDataProcessor;
