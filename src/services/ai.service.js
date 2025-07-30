const { Anthropic } = require("@anthropic-ai/sdk");
const fs = require("fs").promises;
const path = require("path");

class AIService {
  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    this.csvKnowledgeBase = null;
    this.isEnabled = process.env.AI_AUTO_REPLY_ENABLED === "true";
    this.loadCSVKnowledge();
  }

  async loadCSVKnowledge() {
    try {
      const csvPath = path.join(
        __dirname,
        "../../data/Iuea Knowledgebase with Categories.csv"
      );
      const csvData = await fs.readFile(csvPath, "utf8");
      this.csvKnowledgeBase = csvData;

      // Parse CSV into structured knowledge items for smart retrieval
      this.knowledgeItems = this.parseCSVToItems(csvData);
      console.log(
        `✅ Knowledge base loaded: ${this.knowledgeItems.length} items`
      );
    } catch (error) {
      console.warn("CSV knowledge base not found, continuing without it");
      this.csvKnowledgeBase = "";
      this.knowledgeItems = [];
    }
  }

  parseCSVToItems(csvData) {
    const items = [];
    const lines = csvData.split("\n");
    let currentCategory = "";

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
        return;
      }

      if (
        question &&
        answer &&
        question !== "Questions" &&
        answer !== "Answers"
      ) {
        items.push({
          question: question.toLowerCase(),
          answer: answer,
          category: currentCategory,
          searchText: `${question} ${answer} ${currentCategory}`.toLowerCase(),
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

  // Smart knowledge retrieval based on user question
  getRelevantKnowledge(userMessage, maxItems = 5) {
    if (!this.knowledgeItems || this.knowledgeItems.length === 0) {
      return "";
    }

    const searchTerms = userMessage.toLowerCase();
    const keywordMatches = [];

    // Check for questions about programs not offered
    const notOfferedKeywords = [
      "mphil",
      "master of philosophy",
      "botany",
      "plant science",
    ];
    const hasNotOfferedKeyword = notOfferedKeywords.some((keyword) =>
      searchTerms.includes(keyword)
    );

    // Find items that match keywords from user's question
    this.knowledgeItems.forEach((item) => {
      let score = 0;

      // Direct question match gets highest score
      if (
        item.question.includes(searchTerms) ||
        searchTerms.includes(item.question)
      ) {
        score += 10;
      }

      // Boost score for "not offered" questions when user asks about non-existent programs
      if (
        hasNotOfferedKeyword &&
        item.category.toLowerCase().includes("not offered")
      ) {
        score += 15;
      }

      // Check for individual word matches
      const userWords = searchTerms
        .split(" ")
        .filter((word) => word.length > 2);
      userWords.forEach((word) => {
        if (item.searchText.includes(word)) {
          score += 1;
        }
      });

      // Category-specific boosting
      if (
        searchTerms.includes("fee") ||
        searchTerms.includes("cost") ||
        searchTerms.includes("pay")
      ) {
        if (
          item.category.toLowerCase().includes("fee") ||
          item.category.toLowerCase().includes("payment")
        ) {
          score += 3;
        }
      }

      if (
        searchTerms.includes("course") ||
        searchTerms.includes("program") ||
        searchTerms.includes("study")
      ) {
        if (
          item.category.toLowerCase().includes("course") ||
          item.category.toLowerCase().includes("academic")
        ) {
          score += 3;
        }
      }

      if (
        searchTerms.includes("admission") ||
        searchTerms.includes("apply") ||
        searchTerms.includes("requirement")
      ) {
        if (
          item.category.toLowerCase().includes("enrol") ||
          item.category.toLowerCase().includes("admission")
        ) {
          score += 3;
        }
      }

      if (score > 0) {
        keywordMatches.push({ ...item, score });
      }
    });

    // Sort by relevance score and take top matches
    const topMatches = keywordMatches
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);

    if (topMatches.length === 0) {
      return "";
    }

    // Format as Q&A for the AI
    let knowledgeContext = "\n\nRELEVANT KNOWLEDGE:\n";
    topMatches.forEach((item, index) => {
      knowledgeContext += `${index + 1}. Q: ${item.question}\n   A: ${
        item.answer
      }\n\n`;
    });

    return knowledgeContext;
  }

  async generateResponse(
    userMessage,
    conversationHistory = [],
    leadStatus = null
  ) {
    try {
      // 1. Compute current date string
      const now = new Date();
      const formattedDate = now.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });

      // 2. Build the recent‐conversation context
      let contextPrompt = "";
      if (conversationHistory.length > 0) {
        const recent = conversationHistory.slice(-3);
        contextPrompt = "\n\nRecent conversation:\n";
        recent.forEach((msg) => {
          if (msg.sender_name) {
            contextPrompt += `${msg.sender_name}: ${msg.message}\n`;
          } else if (msg.is_from_user) {
            contextPrompt += `User: ${msg.message}\n`;
          } else {
            contextPrompt += `Miryam: ${msg.message}\n`;
          }
        });
        contextPrompt += "\n";
      }

      const isDirectContact = leadStatus === null;
      const isLead = leadStatus?.isLead;

      // 3. Start the system prompt
      const intakeSchedule = "January/February, May/June, and August/September";
      let systemPrompt = `Today is ${formattedDate}. The official IUEA intake months are ${intakeSchedule}.
Use the current date and the intake schedule to answer any questions about the next intake or application timing.

You are Miryam, a friendly and knowledgeable admissions consultant for IUEA (International University of East Africa). You help people learn about programs and guide them toward applying.

PERSONALITY RULES:
- Be conversational, warm, and helpful
- Never use action descriptions like *smiles* or text in asterisks
- Don't mention you're an AI or assistant
- Keep responses natural and concise (1–2 sentences usually)
- Be direct and informative
- Focus on solving their questions and encouraging applications
- Don't start with "Hi there!" or "Hello there!"—just answer directly

STRICT ACCURACY RULES:
- ONLY provide info explicitly in the knowledge base
- If a program isn't mentioned, say IUEA does not offer it
- NEVER make up or assume details about programs, fees, durations, requirements
- If unsure, direct them to apply@iuea.ac.ug or +256 706 026496
- Be honest when you don't have information

YOUR MAIN GOAL: Guide interested people to apply at https://iuea.ac.ug/Applicationform/

CONTEXT AWARENESS:
- Reference previous messages naturally
- If asked about their last question, refer to it
- Remember conversation flow and build on it`;

      if (isDirectContact) {
        systemPrompt += `

CONTACT TYPE: This person contacted us directly (not via lead form). They may be exploring or have specific questions. Be helpful and guide them to apply if interested.`;
      } else if (isLead) {
        systemPrompt += `

CONTACT TYPE: This person is a qualified lead who showed interest. They're likely ready for next steps. Encourage them to complete their application.`;
      }

      // 4. Pull in any matched Q&A from the CSV
      const relevantKnowledge = this.getRelevantKnowledge(userMessage);
      if (relevantKnowledge) {
        systemPrompt += relevantKnowledge;
      }

      // 5. Append the full program list
      systemPrompt += `

IMPORTANT - IUEA PROGRAMS OFFERED (COMPLETE LIST):

BACHELOR PROGRAMS:
- Business: Business Administration, Public Administration, Procurement & Logistics Management, Tourism & Hotel Management, Human Resource Management, Journalism & Communication Studies
- Law & Humanities: Laws (LLB), International Relations & Diplomatic Studies  
- Science & Technology: Computer Science, Information Technology, Software Engineering, Climate Smart Agriculture, Environmental Science & Management
- Engineering: Electrical Engineering, Civil Engineering, Architecture, Petroleum Engineering, Mechatronics & Robotics, Communications Engineering, Mining Engineering

MASTER PROGRAMS (ONLY THESE THREE):
- Master of Business Administration (MBA)
- Master of Information Technology
- Master of International Relations and Diplomatic Studies

DIPLOMA PROGRAMS:
- Engineering: Electrical Engineering, Civil Engineering, Architecture`;

      // 6. Finally tack on the recent conversation
      systemPrompt += contextPrompt;

      // 7. Send to Anthropic
      const response = await this.anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        temperature: 0.7,
      });

      return (
        response.content[0]?.text ||
        "I apologize, but I encountered an issue. Could you please try again?"
      );
    } catch (error) {
      console.error("Error generating AI response:", error);
      return "I apologize for the technical difficulty. Please try your question again, or contact our admissions team directly for immediate assistance.";
    }
  }

  // Keep existing utility methods
  async analyzeMessage(message) {
    try {
      const response = await this.anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 150,
        system:
          "Analyze this message and categorize it as: inquiry (asking about programs/courses), application (wanting to apply), support (technical help), or general (other). Respond with just the category word.",
        messages: [
          {
            role: "user",
            content: message,
          },
        ],
        temperature: 0.3,
      });

      return response.content[0]?.text?.toLowerCase() || "general";
    } catch (error) {
      console.error("Error analyzing message:", error);
      return "general";
    }
  }

  async generateWelcomeMessage() {
    return "Hello! I'm Miryam from IUEA. How can I help you with your education goals today?";
  }

  getStatus() {
    return {
      enabled: this.isEnabled,
    };
  }

  setEnabled(enabled) {
    this.isEnabled = Boolean(enabled);
    console.log(
      `🤖 AI Auto-Reply set to: ${this.isEnabled ? "ENABLED" : "DISABLED"}`
    );
    return this.getStatus();
  }

  getKnowledgeBase() {
    return {
      csvData: this.csvKnowledgeBase,
      isLoaded:
        this.csvKnowledgeBase !== null && this.csvKnowledgeBase.length > 0,
      size: this.csvKnowledgeBase ? this.csvKnowledgeBase.length : 0,
    };
  }

  async generateFollowUpSuggestions(conversation) {
    try {
      const response = await this.anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 200,
        system:
          "Based on this conversation, suggest 2-3 brief follow-up questions the user might ask. Return as a simple array of questions.",
        messages: [
          {
            role: "user",
            content: JSON.stringify(conversation),
          },
        ],
        temperature: 0.8,
      });

      const suggestions = response.content[0]?.text || "";
      return suggestions
        .split("\n")
        .filter((s) => s.trim().length > 0)
        .slice(0, 3);
    } catch (error) {
      console.error("Error generating follow-up suggestions:", error);
      return [
        "Tell me about available programs",
        "What are the admission requirements?",
        "How do I apply?",
      ];
    }
  }
}

module.exports = new AIService();
