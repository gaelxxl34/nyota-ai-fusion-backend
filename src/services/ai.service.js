const { Anthropic } = require("@anthropic-ai/sdk");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const redisCache = require("./redisCache.service");

class AIService {
  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    this.primaryModel =
      process.env.ANTHROPIC_PRIMARY_MODEL || "claude-3-5-sonnet-latest";
    this.fallbackModel =
      process.env.ANTHROPIC_FALLBACK_MODEL || "claude-3-sonnet-20240229";

    this.csvKnowledgeBase = null;
    this.isEnabled = process.env.AI_AUTO_REPLY_ENABLED === "true";
    this.redisCache = redisCache;

    this.loadCSVKnowledge();
  }

  isModelNotFoundError(error) {
    if (!error) return false;

    const status = error.status || error?.response?.status;
    if (status === 404) return true;

    const errorType =
      error?.error?.type ||
      error?.error?.error?.type ||
      error?.data?.error?.type ||
      error?.name;

    if (typeof errorType === "string" && errorType.includes("not_found")) {
      return true;
    }

    const message =
      error?.error?.message ||
      error?.error?.error?.message ||
      error?.message ||
      "";

    if (typeof message === "string" && message.includes("model")) {
      return message.includes("not found") || message.includes("Unknown");
    }

    return false;
  }

  async createMessageWithFallback(payload) {
    try {
      return await this.anthropic.messages.create({
        ...payload,
        model: this.primaryModel,
      });
    } catch (error) {
      if (!this.isModelNotFoundError(error)) {
        throw error;
      }

      console.warn(
        `Primary Anthropic model ${this.primaryModel} unavailable, attempting fallback ${this.fallbackModel}`
      );

      if (!this.fallbackModel) {
        throw error;
      }

      return this.anthropic.messages.create({
        ...payload,
        model: this.fallbackModel,
      });
    }
  }

  async loadCSVKnowledge() {
    try {
      // Try to get knowledge base from Redis cache first
      const cachedKnowledge = await this.redisCache.getCachedKnowledgeBase();

      if (cachedKnowledge) {
        console.log(
          `⚡ Knowledge base loaded from Redis cache: ${cachedKnowledge.knowledgeItems.length} items`
        );
        this.csvKnowledgeBase = cachedKnowledge.csvData;
        this.knowledgeItems = cachedKnowledge.knowledgeItems;
        return;
      }

      console.log("📊 Cache miss - loading knowledge base from CSV file...");

      const csvPath = path.join(
        __dirname,
        "../../data/Iuea Knowledgebase with Categories.csv"
      );
      const csvData = await fs.readFile(csvPath, "utf8");
      this.csvKnowledgeBase = csvData;

      // Parse CSV into structured knowledge items for smart retrieval
      this.knowledgeItems = this.parseCSVToItems(csvData);

      // Cache the knowledge base in Redis
      const knowledgeData = {
        csvData: this.csvKnowledgeBase,
        knowledgeItems: this.knowledgeItems,
        lastUpdated: new Date().toISOString(),
      };

      await this.redisCache.cacheKnowledgeBase(knowledgeData);

      console.log(
        `✅ Knowledge base loaded and cached: ${this.knowledgeItems.length} items`
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
    // Use only CSV knowledge items since everything is now saved to CSV
    const allItems = this.knowledgeItems || [];

    if (allItems.length === 0) {
      return "";
    }

    // Enhanced keyword matching for better question understanding
    const searchTerms = userMessage.toLowerCase();

    // Normalize common question patterns
    let normalizedQuery = searchTerms;

    // Handle common informal ways of asking about fees
    if (
      normalizedQuery.includes("how much") ||
      normalizedQuery.includes("what does it cost") ||
      normalizedQuery.includes("price") ||
      normalizedQuery.includes("expensive")
    ) {
      normalizedQuery += " fee cost tuition";
    }

    // Handle informal ways of asking about courses
    if (
      normalizedQuery.includes("what can i study") ||
      normalizedQuery.includes("what courses") ||
      normalizedQuery.includes("what programs") ||
      normalizedQuery.includes("what degrees")
    ) {
      normalizedQuery += " course program degree";
    }

    // Handle admission questions
    if (
      normalizedQuery.includes("how to join") ||
      normalizedQuery.includes("how do i get in") ||
      normalizedQuery.includes("can i apply") ||
      normalizedQuery.includes("how to apply")
    ) {
      normalizedQuery += " admission application entry";
    }

    // Add program name variations
    const programAliases = {
      mba: "master business administration",
      mit: "master information technology",
      bit: "bachelor information technology",
      cs: "computer science",
      it: "information technology",
      bba: "bachelor business administration",
      llb: "bachelor law",
      engineering:
        "civil electrical architecture petroleum mechatronics communications mining",
    };

    Object.keys(programAliases).forEach((alias) => {
      if (normalizedQuery.includes(alias)) {
        normalizedQuery += " " + programAliases[alias];
      }
    });

    const keywordMatches = [];

    // Check for questions about programs not offered
    const notOfferedKeywords = [
      "mphil",
      "master of philosophy",
      "botany",
      "plant science",
    ];
    const hasNotOfferedKeyword = notOfferedKeywords.some((keyword) =>
      normalizedQuery.includes(keyword)
    );

    // Find items that match keywords from user's question
    allItems.forEach((item) => {
      let score = 0;

      // Direct question match gets highest score
      if (
        (item.question && item.question.includes(normalizedQuery)) ||
        normalizedQuery.includes(item.question || "")
      ) {
        score += 10;
      }

      // For dynamic items, also check title
      if (
        item.title &&
        (item.title.toLowerCase().includes(normalizedQuery) ||
          normalizedQuery.includes(item.title.toLowerCase()))
      ) {
        score += 10;
      }

      // Boost score for "not offered" questions when user asks about non-existent programs
      if (
        hasNotOfferedKeyword &&
        item.category &&
        item.category.toLowerCase().includes("not offered")
      ) {
        score += 15;
      }

      // Check for individual word matches
      const userWords = normalizedQuery
        .split(" ")
        .filter((word) => word.length > 2);
      userWords.forEach((word) => {
        const searchText =
          item.searchText ||
          `${item.question || item.title || ""} ${
            item.answer || item.content || ""
          } ${item.category || ""}`.toLowerCase();
        if (searchText.includes(word)) {
          score += 1;
        }
      });

      // Category-specific boosting with more flexible keyword matching
      const feeKeywords = [
        "fee",
        "fees",
        "cost",
        "costs",
        "pay",
        "payment",
        "money",
        "price",
        "tuition",
        "charges",
        "expensive",
        "cheap",
        "afford",
        "budget",
      ];
      const courseKeywords = [
        "course",
        "courses",
        "program",
        "programmes",
        "programs",
        "study",
        "studies",
        "degree",
        "degrees",
        "diploma",
        "diplomas",
        "major",
        "field",
        "subject",
        "curriculum",
      ];
      const admissionKeywords = [
        "admission",
        "admissions",
        "apply",
        "application",
        "requirement",
        "requirements",
        "entry",
        "qualify",
        "qualification",
        "join",
        "enroll",
        "enrolment",
        "registration",
      ];

      // Check for fee-related questions
      if (feeKeywords.some((keyword) => normalizedQuery.includes(keyword))) {
        if (
          item.category &&
          (item.category.toLowerCase().includes("fee") ||
            item.category.toLowerCase().includes("payment") ||
            item.category.toLowerCase().includes("tuition"))
        ) {
          score += 5; // Higher boost for fee questions
        }
        // Also boost if the answer contains fee information
        if (
          item.answer &&
          (item.answer.toLowerCase().includes("dollar") ||
            item.answer.toLowerCase().includes("usd") ||
            item.answer.toLowerCase().includes("fee"))
        ) {
          score += 3;
        }
      }

      // Check for course/program questions
      if (courseKeywords.some((keyword) => normalizedQuery.includes(keyword))) {
        if (
          item.category &&
          (item.category.toLowerCase().includes("course") ||
            item.category.toLowerCase().includes("academic") ||
            item.category.toLowerCase().includes("program"))
        ) {
          score += 3;
        }
      }

      // Check for admission questions
      if (
        admissionKeywords.some((keyword) => normalizedQuery.includes(keyword))
      ) {
        if (
          item.category &&
          (item.category.toLowerCase().includes("enrol") ||
            item.category.toLowerCase().includes("admission") ||
            item.category.toLowerCase().includes("application"))
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
      const question = item.question || item.title || "Question";
      const answer = item.answer || item.content || "Answer";
      knowledgeContext += `${index + 1}. Q: ${question}\n   A: ${answer}\n\n`;
    });

    return knowledgeContext;
  }

  // Build application status context to guide AI responses
  buildStatusContext(leadStatus) {
    const statusContexts = {
      INTERESTED: `

APPLICATION STATUS CONTEXT: This user has shown initial interest but hasn't applied yet.
- Guide them towards application process
- Share programme information
- Encourage them to apply through the portal
- Ask what specific programme they're interested in
- Help with admission requirements`,

      APPLIED: `

APPLICATION STATUS CONTEXT: This user has already submitted their application! 🎓
- Acknowledge their application if they mention it
- Focus on next steps in the process
- Provide timeline expectations
- Offer support during review period
- Don't repeatedly ask them to apply - they already have!
- Help with document submission if needed`,

      IN_REVIEW: `

APPLICATION STATUS CONTEXT: This user's application is currently being reviewed.
- Reassure them about the review process
- Provide realistic timelines
- Help with any additional documents needed
- Keep them engaged while waiting
- Don't ask them to apply again - focus on current application`,

      QUALIFIED: `

APPLICATION STATUS CONTEXT: This user has been qualified! Great news! ✨
- Congratulate them on meeting requirements
- Guide them through next steps
- Help with enrollment process
- Share important deadlines
- Assist with any remaining requirements`,

      ADMITTED: `

APPLICATION STATUS CONTEXT: This user has been ADMITTED! Excellent! 🎉
- Celebrate this achievement with them
- Guide them through enrollment steps
- Help with registration process
- Share orientation information
- Assist with fee payment process
- Don't ask them to apply - they're already admitted!`,

      ENROLLED: `

APPLICATION STATUS CONTEXT: This user is ENROLLED! They're now a IUEA student! 🌟
- Welcome them to the IUEA family
- Help with student portal access
- Share campus information
- Assist with academic planning
- Guide them to student services
- Focus on student support, not admissions`,

      DEFERRED: `

APPLICATION STATUS CONTEXT: This user's application was deferred.
- Be supportive and understanding
- Explain next steps for reapplication
- Help them strengthen their application
- Provide encouragement
- Guide them on timeline for next intake`,

      EXPIRED: `

APPLICATION STATUS CONTEXT: This user's previous application expired.
- Encourage fresh application for current intake
- Help them understand what's needed
- Guide them through new application process
- Be supportive about starting over
- Focus on current opportunities`,
    };

    return (
      statusContexts[leadStatus] ||
      `

APPLICATION STATUS CONTEXT: User status: ${leadStatus}
- Respond appropriately to their current stage
- Provide relevant next steps
- Be supportive and helpful`
    );
  }

  // Build user engagement context to personalize AI responses
  buildEngagementContext(userContext) {
    if (!userContext) return "";

    let engagementPrompt = "\n\nUSER ENGAGEMENT CONTEXT:";

    // Engagement level context
    const engagementContexts = {
      new: "- This is a new contact, be welcoming and introductory",
      engaged:
        "- User is actively engaged, continue the conversation naturally",
      highly_engaged:
        "- User is highly engaged with multiple interactions, be more detailed and comprehensive",
      returning:
        "- Returning user after some time, acknowledge the gap and be welcoming back",
    };

    if (userContext.engagementLevel) {
      engagementPrompt += `\n${
        engagementContexts[userContext.engagementLevel] ||
        "- Regular engagement level"
      }`;
    }

    // Application context
    if (userContext.applications && userContext.applications.length > 0) {
      engagementPrompt += `\n- User has ${userContext.applications.length} application(s) on file`;

      // Get most recent application status
      const recentApp = userContext.applications[0];
      if (recentApp && recentApp.status) {
        engagementPrompt += `\n- Most recent application status: ${recentApp.status}`;
      }
    }

    // Message count context
    if (userContext.messageCount) {
      if (userContext.messageCount > 20) {
        engagementPrompt +=
          "\n- Long conversation history, user is very familiar with IUEA";
      } else if (userContext.messageCount > 5) {
        engagementPrompt +=
          "\n- Moderate conversation history, user has some familiarity";
      }
    }

    return engagementPrompt;
  }

  async generateResponse(
    userMessage,
    conversationHistory = [],
    leadStatus = null,
    userContext = null
  ) {
    try {
      console.log(`🤖 AI generating response for: "${userMessage}"`);

      // Create a hash for caching based on message content and context
      const contextString = JSON.stringify({
        message: userMessage.trim().toLowerCase(),
        leadStatus: leadStatus || null,
        historyLength: conversationHistory.length,
        lastMessages: conversationHistory
          .slice(-2)
          .map((m) => m.message?.substring(0, 50)),
      });

      const messageHash = crypto
        .createHash("md5")
        .update(contextString)
        .digest("hex");

      // Try to get cached response first
      const cachedResponse = await this.redisCache.getCachedAIResponse(
        messageHash
      );
      if (cachedResponse) {
        console.log(
          `⚡ Retrieved AI response from cache for: "${userMessage.substring(
            0,
            50
          )}..."`
        );
        return cachedResponse;
      }

      console.log(`📊 Cache miss - generating new AI response...`);
      console.log(
        `📚 Conversation history length: ${conversationHistory.length}`
      );
      console.log(
        `👤 User lead status: ${leadStatus || "No status (direct contact)"}`
      );
      console.log(
        `🔍 User context:`,
        userContext
          ? {
              applications: userContext.applications?.length || 0,
              engagementLevel: userContext.engagementLevel,
              messageCount: userContext.messageCount,
            }
          : "Not available"
      );

      // 1. Build the recent‐conversation context with analysis
      let contextPrompt = "";
      let conversationAnalysis = null;

      if (conversationHistory.length > 0) {
        // Extract conversation analysis if available
        conversationAnalysis = conversationHistory.conversationAnalysis;

        const recent = conversationHistory.slice(-5); // Increased from 3 to 5 for better context
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

        // Add conversation analysis context if available
        if (conversationAnalysis) {
          contextPrompt += "\nCONVERSATION ANALYSIS:\n";
          if (conversationAnalysis.hasUnresolvedQuestions) {
            contextPrompt +=
              "- User has unresolved questions that need addressing\n";
          }
          if (conversationAnalysis.discussedTopics.length > 0) {
            contextPrompt += `- Previously discussed: ${conversationAnalysis.discussedTopics.join(
              ", "
            )}\n`;
          }
          if (conversationAnalysis.lastUserQuestion) {
            contextPrompt += `- Last question: "${conversationAnalysis.lastUserQuestion}"\n`;
          }
          contextPrompt += `- Conversation stage: ${conversationAnalysis.conversationFlow}\n`;
        }

        contextPrompt += "\n";
        console.log(`💬 Enhanced context with analysis: ${contextPrompt}`);
      } else {
        console.log(`📭 No conversation history available`);
      }

      // 2. Build application status context
      let statusContext = "";
      if (leadStatus) {
        statusContext = this.buildStatusContext(leadStatus);
        console.log(`📊 Status context: ${statusContext}`);
      }

      // 3. Build user engagement context
      let engagementContext = "";
      if (userContext) {
        engagementContext = this.buildEngagementContext(userContext);
        console.log(`👥 Engagement context: ${engagementContext}`);
      }

      // 4. Start the system prompt with current date
      const currentDate = new Date();
      const currentDateString = currentDate.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      let systemPrompt = `You are Miryam, admissions consultant for the International University of East Africa (IUEA).

CURRENT DATE: Today is ${currentDateString}

Main Goal: Always guide people to apply through the online applicant portal at 👉 https://applicant.iuea.ac.ug/

Important: https://applicant.iuea.ac.ug/ is the APPLICANT PORTAL (not a website). Say "apply through the portal" or "use the applicant portal", never say "visit the website" or "go to the website".

Intakes: Jan/Feb, May/June, Aug/Sept. Based on today's date (${currentDateString}), calculate and mention the NEXT upcoming intake. Never mention past dates.

Language: ALWAYS write in British English by default. Use British spellings (e.g., "organised", "realise", "colour", "centre", "programme"), British terms (e.g., "university fees" not "tuition"), and British phrasing. Only switch to another language if the user explicitly writes in that language first.

Style: 1–2 short sentences. Natural, warm, and direct. No lists unless asked. No filler words, no clichés, no markdown, no hashtags, no asterisks, no em dashes.

Context Awareness: You have access to the conversation history and user's application status. Use this information to:
- Avoid repeating information already discussed
- Reference previous conversations naturally
- Adapt your response based on their application stage
- Provide relevant next steps based on where they are in the process
- Show continuity and understanding of their journey
- Acknowledge their engagement level and respond appropriately

Emotions & Emojis: Show personality with appropriate emojis and emotions:
- Happy/Excited: 😊 😁 🎓 ✨ when discussing opportunities, success, achievements
- Helpful/Supportive: 👍 💪 🤝 when providing assistance, encouragement  
- Welcoming: 👋 🌟 when greeting or being friendly
- Informative: 📚 💡 ℹ️ when sharing knowledge
- Enthusiastic: 🚀 🎯 ⭐ for great programs or opportunities
- Concerned/Supportive: 😔 💙 🤗 if user seems worried or needs help
- Use emojis naturally, 1-2 per response maximum

Accuracy: PRIORITIZE the knowledge base provided below. If the knowledge base has specific information, use it. If not covered in the knowledge base, use the general info listed here. If completely unsure, say: "Please email apply@iuea.ac.ug or call +256 705 722 300 / +256 790002000." Never invent details.

Tuition: Quote per semester only. Include functional fees (194 USD first semester, 155 USD second semester). Never annual totals.

Programs Offered:

Bachelors: Business Admin, Public Admin, Procurement & Logistics, Tourism & Hotel Mgmt, HR Mgmt, Journalism & Communication, Laws (LLB), Int. Relations & Diplomacy, Computer Science, IT, Software Eng, Climate Smart Agriculture, Env. Science & Mgmt, Electrical Eng, Civil Eng, Architecture, Petroleum Eng, Mechatronics & Robotics, Communications Eng, Mining Eng.

Masters: MBA, Master of IT, Master of Int. Relations.

Diplomas: Electrical Eng, Civil Eng, Architecture.${statusContext}${engagementContext}`;

      // 3. Pull in any matched Q&A from the CSV
      const relevantKnowledge = this.getRelevantKnowledge(userMessage);
      if (relevantKnowledge) {
        systemPrompt += relevantKnowledge;
      }

      // 4. Finally tack on the recent conversation
      systemPrompt += contextPrompt;

      // 5. Send to Anthropic
      const response = await this.createMessageWithFallback({
        max_tokens: 150,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        temperature: 0.7,
      });

      const aiResponse =
        response.content[0]?.text ||
        "I apologize, but I encountered an issue. Could you please try again?";

      // Cache the response for future use
      if (aiResponse && !aiResponse.includes("I apologize")) {
        await this.redisCache.cacheAIResponse(messageHash, aiResponse);
        console.log(`💾 Cached AI response for future queries`);
      }

      return aiResponse;
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
    return "Hello! I'm Miryam from IUEA. How can I help you with your education goals today? 🎓";
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

  // Knowledge base management functions
  async addKnowledgeItem(item) {
    try {
      const csvPath = path.join(
        __dirname,
        "../../data/Iuea Knowledgebase with Categories.csv"
      );

      // Escape CSV content properly
      const escapeCSV = (str) => {
        if (!str) return '""';
        const escaped = str.toString().replace(/"/g, '""');
        return `"${escaped}"`;
      };

      // Create CSV line for the new item
      const newCsvLine = `${escapeCSV(item.title)},${escapeCSV(item.content)}`;

      // Append to CSV file
      await fs.appendFile(csvPath, `\n${newCsvLine}`);

      // Reload the knowledge base to include the new item
      await this.loadCSVKnowledge();

      // Invalidate knowledge base cache since we added new content
      await this.redisCache.del(this.redisCache.KEYS.KNOWLEDGE_BASE + "full");
      console.log("🗑️ Invalidated knowledge base cache after adding new item");

      // Find the newly added item in the loaded knowledge base
      const addedItem = this.knowledgeItems.find(
        (knowledgeItem) =>
          knowledgeItem.question === item.title &&
          knowledgeItem.answer === item.content
      );

      const newItem = {
        id: this.knowledgeItems.length, // Use array length as ID
        category: item.category || "general",
        title: item.title,
        content: item.content,
        question: item.title,
        answer: item.content,
        tags: item.tags || [],
        priority: item.priority || "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        searchText: `${item.title} ${item.content} ${
          item.category || ""
        }`.toLowerCase(),
        source: "csv",
      };

      console.log(`✅ Added knowledge item to CSV: ${newItem.title}`);
      return newItem;
    } catch (error) {
      console.error("❌ Error adding knowledge item to CSV:", error);
      throw error;
    }
  }

  async updateKnowledgeItem(id, updates) {
    try {
      const csvPath = path.join(
        __dirname,
        "../../data/Iuea Knowledgebase with Categories.csv"
      );

      // Read current CSV content
      const csvData = await fs.readFile(csvPath, "utf8");
      const lines = csvData.split("\n");

      // Find the item to update by parsing CSV and matching ID
      let itemIndex = -1;
      let currentItemIndex = 0;
      let updatedLines = [];
      let currentCategory = "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (i === 0) {
          // Keep header
          updatedLines.push(lines[i]);
          continue;
        }

        if (!line) {
          updatedLines.push(lines[i]);
          continue;
        }

        const fields = this.parseCSVLine(line);
        const question = fields[0] || "";
        const answer = fields[1] || "";

        if (question && question.startsWith("CATEGORY:")) {
          currentCategory = question.replace("CATEGORY:", "").trim();
          updatedLines.push(lines[i]);
          continue;
        }

        if (
          question &&
          answer &&
          question !== "Questions" &&
          answer !== "Answers"
        ) {
          const itemId = `csv_${currentItemIndex}`;

          if (itemId === id) {
            // Found the item to update
            itemIndex = i;
            const escapeCSV = (str) => {
              if (!str) return '""';
              const escaped = str.toString().replace(/"/g, '""');
              return `"${escaped}"`;
            };

            const newTitle = updates.title || question;
            const newContent = updates.content || answer;
            const newCsvLine = `${escapeCSV(newTitle)},${escapeCSV(
              newContent
            )}`;
            updatedLines.push(newCsvLine);
          } else {
            updatedLines.push(lines[i]);
          }
          currentItemIndex++;
        } else {
          updatedLines.push(lines[i]);
        }
      }

      if (itemIndex === -1) {
        return null; // Item not found
      }

      // Write updated content back to CSV
      await fs.writeFile(csvPath, updatedLines.join("\n"));

      // Reload the knowledge base
      await this.loadCSVKnowledge();

      // Invalidate knowledge base cache since we updated content
      await this.redisCache.del(this.redisCache.KEYS.KNOWLEDGE_BASE + "full");
      console.log("🗑️ Invalidated knowledge base cache after update");

      const updatedItem = {
        id,
        category: updates.category || "general",
        title: updates.title,
        content: updates.content,
        question: updates.title,
        answer: updates.content,
        tags: updates.tags || [],
        priority: updates.priority || "medium",
        updatedAt: new Date().toISOString(),
        searchText: `${updates.title} ${updates.content} ${
          updates.category || ""
        }`.toLowerCase(),
        source: "csv",
      };

      console.log(`✅ Updated knowledge item in CSV: ${updatedItem.title}`);
      return updatedItem;
    } catch (error) {
      console.error("❌ Error updating knowledge item in CSV:", error);
      throw error;
    }
  }

  async deleteKnowledgeItem(id) {
    try {
      const csvPath = path.join(
        __dirname,
        "../../data/Iuea Knowledgebase with Categories.csv"
      );

      // Read current CSV content
      const csvData = await fs.readFile(csvPath, "utf8");
      const lines = csvData.split("\n");

      // Find and remove the item by parsing CSV and matching ID
      let itemFound = false;
      let currentItemIndex = 0;
      let updatedLines = [];
      let deletedItem = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (i === 0) {
          // Keep header
          updatedLines.push(lines[i]);
          continue;
        }

        if (!line) {
          updatedLines.push(lines[i]);
          continue;
        }

        const fields = this.parseCSVLine(line);
        const question = fields[0] || "";
        const answer = fields[1] || "";

        if (question && question.startsWith("CATEGORY:")) {
          updatedLines.push(lines[i]);
          continue;
        }

        if (
          question &&
          answer &&
          question !== "Questions" &&
          answer !== "Answers"
        ) {
          const itemId = `csv_${currentItemIndex}`;

          if (itemId === id) {
            // Found the item to delete - don't add it to updatedLines
            itemFound = true;
            deletedItem = { title: question, content: answer };
          } else {
            updatedLines.push(lines[i]);
          }
          currentItemIndex++;
        } else {
          updatedLines.push(lines[i]);
        }
      }

      if (!itemFound) {
        return false; // Item not found
      }

      // Write updated content back to CSV
      await fs.writeFile(csvPath, updatedLines.join("\n"));

      // Reload the knowledge base
      await this.loadCSVKnowledge();

      // Invalidate knowledge base cache since we deleted content
      await this.redisCache.del(this.redisCache.KEYS.KNOWLEDGE_BASE + "full");
      console.log("🗑️ Invalidated knowledge base cache after deletion");

      console.log(`✅ Deleted knowledge item from CSV: ${deletedItem.title}`);
      return true;
    } catch (error) {
      console.error("❌ Error deleting knowledge item from CSV:", error);
      throw error;
    }
  }

  searchKnowledgeBase(query) {
    if (!query) {
      return this.getAllKnowledgeItems();
    }

    const searchTerm = query.toLowerCase();

    // Search CSV items only since everything is now in CSV
    const csvResults = (this.knowledgeItems || [])
      .filter((item) => item.searchText && item.searchText.includes(searchTerm))
      .map((item, index) => ({
        id: `csv_${index}`,
        title: item.question || "",
        content: item.answer || "",
        question: item.question || "",
        answer: item.answer || "",
        category: item.category || "general",
        searchText: item.searchText,
        source: "csv",
      }));

    return csvResults;
  }

  getAllKnowledgeItems() {
    // Helper function to intelligently categorize based on keywords
    const categorizeFrontend = (originalCategory, question, answer) => {
      const text = `${originalCategory} ${question} ${answer}`.toLowerCase();

      // Fee-related keywords
      if (
        text.includes("fee") ||
        text.includes("tuition") ||
        text.includes("cost") ||
        text.includes("payment") ||
        text.includes("money") ||
        text.includes("account") ||
        text.includes("billing") ||
        text.includes("scholarship") ||
        text.includes("financial")
      ) {
        return "fees";
      }

      // Academic-related keywords
      if (
        text.includes("course") ||
        text.includes("program") ||
        text.includes("academic") ||
        text.includes("curriculum") ||
        text.includes("study") ||
        text.includes("class") ||
        text.includes("subject") ||
        text.includes("degree") ||
        text.includes("diploma") ||
        text.includes("bachelor") ||
        text.includes("master") ||
        text.includes("faculty") ||
        text.includes("department") ||
        text.includes("specialisation") ||
        text.includes("examination") ||
        text.includes("grade") ||
        text.includes("credit") ||
        text.includes("semester") ||
        text.includes("duration")
      ) {
        return "academics";
      }

      // Admissions-related keywords
      if (
        text.includes("admission") ||
        text.includes("enrol") ||
        text.includes("apply") ||
        text.includes("application") ||
        text.includes("requirement") ||
        text.includes("entry") ||
        text.includes("qualify") ||
        text.includes("eligibility") ||
        text.includes("registration") ||
        text.includes("intake") ||
        text.includes("deadline")
      ) {
        return "admissions";
      }

      // Everything else goes to general
      return "general";
    };

    const csvItems = (this.knowledgeItems || []).map((item, index) => {
      const frontendCategory = categorizeFrontend(
        item.category || "General",
        item.question || "",
        item.answer || ""
      );

      return {
        id: `csv_${index}`,
        title: item.question || "", // Frontend expects 'title'
        content: item.answer || "", // Frontend expects 'content'
        question: item.question || "", // Keep original for reference
        answer: item.answer || "", // Keep original for reference
        category: frontendCategory, // Smart categorized for frontend
        originalCategory: item.category || "General", // Keep original CSV category
        tags: [frontendCategory, item.category || "General"], // Both categories as tags
        priority: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: "csv",
      };
    });

    return csvItems;
  }
}

module.exports = new AIService();
