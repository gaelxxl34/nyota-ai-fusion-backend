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

  // Detect the primary language of the user's message
  detectLanguage(userMessage, conversationHistory = []) {
    const message = userMessage.toLowerCase().trim();

    // Check conversation history for language patterns
    const recentMessages = conversationHistory.slice(-5);
    const allText = [
      userMessage,
      ...recentMessages.map((msg) => msg.message || ""),
    ]
      .join(" ")
      .toLowerCase();

    // Language indicators with weights
    const languageIndicators = {
      french: [
        // High confidence French words (weight 5)
        {
          words: ["bonjour", "bonsoir", "salut", "au revoir", "à bientôt"],
          weight: 5,
        },
        {
          words: [
            "français",
            "francais",
            "je parle français",
            "parlez-vous français",
          ],
          weight: 5,
        },
        {
          words: [
            "s'il vous plaît",
            "excusez-moi",
            "je voudrais",
            "pouvez-vous",
          ],
          weight: 5,
        },

        // Medium confidence French words (weight 3)
        {
          words: ["merci", "oui", "non", "comment", "où", "quand", "pourquoi"],
          weight: 3,
        },
        {
          words: [
            "qu'est-ce que",
            "est-ce que",
            "combien",
            "depuis",
            "pendant",
          ],
          weight: 3,
        },
        {
          words: ["université", "étudiant", "étudiante", "programme", "cours"],
          weight: 3,
        },
        {
          words: [
            "diplôme",
            "inscription",
            "frais",
            "coût",
            "prix",
            "formation",
            "études",
          ],
          weight: 3,
        },

        // Low confidence French words (weight 1) - common but could be in other contexts
        {
          words: ["je", "tu", "il", "elle", "nous", "vous", "ils", "elles"],
          weight: 1,
        },
        {
          words: [
            "le",
            "la",
            "les",
            "un",
            "une",
            "des",
            "du",
            "de la",
            "au",
            "aux",
          ],
          weight: 1,
        },
        {
          words: ["mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses"],
          weight: 1,
        },
      ],

      english: [
        // High confidence English words (weight 5)
        {
          words: [
            "hello",
            "hi",
            "good morning",
            "good afternoon",
            "good evening",
          ],
          weight: 5,
        },
        {
          words: [
            "thank you",
            "thanks",
            "please",
            "excuse me",
            "can you",
            "could you",
          ],
          weight: 5,
        },
        {
          words: ["english", "do you speak english", "speak english"],
          weight: 5,
        },

        // Medium confidence English words (weight 3)
        {
          words: ["what", "where", "when", "why", "how", "which", "who"],
          weight: 3,
        },
        {
          words: [
            "university",
            "student",
            "program",
            "course",
            "degree",
            "admission",
          ],
          weight: 3,
        },
        {
          words: [
            "tuition",
            "fees",
            "cost",
            "price",
            "application",
            "requirements",
          ],
          weight: 3,
        },

        // English patterns
        {
          words: ["i am", "i'm", "you are", "you're", "we are", "they are"],
          weight: 2,
        },
        {
          words: ["the", "and", "but", "for", "with", "about", "from"],
          weight: 1,
        },
      ],

      spanish: [
        {
          words: [
            "hola",
            "buenos días",
            "buenas tardes",
            "buenas noches",
            "adiós",
          ],
          weight: 5,
        },
        {
          words: [
            "gracias",
            "por favor",
            "perdón",
            "disculpe",
            "español",
            "habla español",
          ],
          weight: 5,
        },
        {
          words: ["qué", "cómo", "cuándo", "dónde", "por qué", "cuánto"],
          weight: 3,
        },
        {
          words: [
            "universidad",
            "estudiante",
            "programa",
            "curso",
            "matrícula",
          ],
          weight: 3,
        },
        {
          words: ["yo", "tú", "él", "ella", "nosotros", "ustedes", "ellos"],
          weight: 1,
        },
      ],

      swahili: [
        {
          words: ["habari", "jambo", "asante", "karibu", "kwaheri", "pole"],
          weight: 5,
        },
        {
          words: ["nini", "wapi", "lini", "kwa nini", "vipi", "ngapi"],
          weight: 3,
        },
        {
          words: ["chuo", "mwanafunzi", "programu", "masomo", "ada"],
          weight: 3,
        },
        { words: ["mimi", "wewe", "yeye", "sisi", "ninyi", "wao"], weight: 1 },
      ],

      luganda: [
        {
          words: ["ki kati", "oli otya", "webale", "tusiibye", "mukwano"],
          weight: 5,
        },
        { words: ["ki", "wa", "ddi", "lwaki", "otya"], weight: 3 },
        { words: ["ttendekero", "omuyizi", "puloguramu"], weight: 3 },
      ],

      arabic: [
        {
          words: ["مرحبا", "السلام عليكم", "شكرا", "من فضلك", "عذرا"],
          weight: 5,
        },
        { words: ["ماذا", "أين", "متى", "لماذا", "كيف", "كم"], weight: 3 },
        { words: ["جامعة", "طالب", "برنامج", "دورة", "رسوم"], weight: 3 },
      ],
    };

    // Calculate scores for each language
    const scores = {};
    Object.keys(languageIndicators).forEach((lang) => {
      scores[lang] = 0;

      languageIndicators[lang].forEach((group) => {
        group.words.forEach((word) => {
          if (allText.includes(word)) {
            scores[lang] += group.weight;
          }
        });
      });
    });

    // Language-specific patterns
    const patterns = {
      french: [
        /\bje (suis|veux|voudrais|peux|dois|ne|n')\b/,
        /\bc'est\b/,
        /\bil y a\b/,
        /\bqu'est-ce que\b/,
        /\best-ce que\b/,
        /\bj'ai\b/,
        /\bje n'ai pas\b/,
        /\bà la\b/,
        /\bau niveau de\b/,
        /\ben tant que\b/,
        /\bparlez-vous\b/,
      ],
      english: [
        /\bi (am|want|would|can|need|have)\b/,
        /\byou (are|can|could|would|have)\b/,
        /\bdo you\b/,
        /\bcan you\b/,
        /\bhow (much|many|long|do)\b/,
        /\bwhat (is|are|do|does)\b/,
      ],
      spanish: [
        /\byo (soy|quiero|puedo|necesito|tengo)\b/,
        /\btú (eres|puedes|quieres|tienes)\b/,
        /\b¿(qué|cómo|cuándo|dónde)\b/,
        /\bme gusta\b/,
      ],
    };

    // Apply pattern bonuses
    Object.keys(patterns).forEach((lang) => {
      patterns[lang].forEach((pattern) => {
        if (pattern.test(allText)) {
          scores[lang] += 4;
        }
      });
    });

    // Check for accented characters
    if (/[àâäéèêëîïôöùûüÿç]/i.test(allText)) {
      scores.french += 4;
    }
    if (/[áéíóúñü]/i.test(allText)) {
      scores.spanish += 4;
    }
    if (/[\u0600-\u06FF]/i.test(allText)) {
      scores.arabic += 5;
    }

    // Special cases for language switching requests
    const languageRequests = {
      french: /speak\s+(french|français)|parler\s+français|en français/i,
      english: /speak\s+english|parler\s+anglais|in english/i,
      spanish: /hablar\s+español|speak\s+spanish|en español/i,
      swahili: /speak\s+swahili|kiswahili/i,
    };

    for (const [lang, pattern] of Object.entries(languageRequests)) {
      if (pattern.test(allText)) {
        return lang;
      }
    }

    console.log(`Language detection scores:`, scores, `Text: "${message}"`);

    // Find the language with the highest score
    const maxScore = Math.max(...Object.values(scores));
    const detectedLanguage = Object.keys(scores).find(
      (lang) => scores[lang] === maxScore
    );

    // Only return detected language if score is significant enough
    if (maxScore >= 3) {
      return detectedLanguage;
    }

    // Default to English if no clear indicators
    return "english";
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
    allItems.forEach((item) => {
      let score = 0;

      // Direct question match gets highest score
      if (
        (item.question && item.question.includes(searchTerms)) ||
        searchTerms.includes(item.question || "")
      ) {
        score += 10;
      }

      // For dynamic items, also check title
      if (
        item.title &&
        (item.title.toLowerCase().includes(searchTerms) ||
          searchTerms.includes(item.title.toLowerCase()))
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
      const userWords = searchTerms
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

      // Category-specific boosting
      if (
        searchTerms.includes("fee") ||
        searchTerms.includes("cost") ||
        searchTerms.includes("pay")
      ) {
        if (
          item.category &&
          (item.category.toLowerCase().includes("fee") ||
            item.category.toLowerCase().includes("payment"))
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
          item.category &&
          (item.category.toLowerCase().includes("course") ||
            item.category.toLowerCase().includes("academic"))
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
          item.category &&
          (item.category.toLowerCase().includes("enrol") ||
            item.category.toLowerCase().includes("admission"))
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

  async generateResponse(
    userMessage,
    conversationHistory = [],
    leadStatus = null
  ) {
    try {
      // Detect the language of the user's message
      const detectedLanguage = this.detectLanguage(
        userMessage,
        conversationHistory
      );

      console.log(
        `Detected language: ${detectedLanguage} for message: "${userMessage}"`
      );

      // Language-specific response instructions
      const getLanguageInstructions = (language) => {
        switch (language) {
          case "french":
            return `- CRITICAL: Respond ENTIRELY in FRENCH - the user has been detected as communicating in French
- Use natural, conversational French appropriate for university admissions  
- Maintain a warm and professional tone in French
- All information about programs, fees, and requirements should be in French
- When providing contact information, introduce it in French
- Example: "Pour plus d'informations, vous pouvez nous contacter à apply@iuea.ac.ug ou au +256 706 026496"
- If asked about language capabilities, respond in French: "Oui, bien sûr ! Je parle français et je suis là pour vous aider avec toutes vos questions sur IUEA."`;

          case "spanish":
            return `- CRITICAL: Respond ENTIRELY in SPANISH - the user has been detected as communicating in Spanish
- Use natural, conversational Spanish appropriate for university admissions
- Maintain a warm and professional tone in Spanish
- All information about programs, fees, and requirements should be in Spanish
- When providing contact information, introduce it in Spanish
- Example: "Para más información, puede contactarnos en apply@iuea.ac.ug o llamar al +256 706 026496"
- If asked about language capabilities, respond in Spanish: "¡Por supuesto! Hablo español y estoy aquí para ayudarle con todas sus preguntas sobre IUEA."`;

          case "swahili":
            return `- CRITICAL: Respond ENTIRELY in SWAHILI - the user has been detected as communicating in Swahili
- Use natural, conversational Swahili appropriate for university admissions
- Maintain a warm and professional tone in Swahili
- All information about programs, fees, and requirements should be in Swahili
- When providing contact information, introduce it in Swahili
- Example: "Kwa maelezo zaidi, unaweza kuwasiliana nasi kupitia apply@iuea.ac.ug au kupiga simu +256 706 026496"
- If asked about language capabilities, respond in Swahili: "Ndiyo, nina uelewa! Ninazungumza Kiswahili na niko hapa kukusaidia na maswali yako yote kuhusu IUEA."`;

          case "luganda":
            return `- CRITICAL: Respond ENTIRELY in LUGANDA - the user has been detected as communicating in Luganda
- Use natural, conversational Luganda appropriate for university admissions
- Maintain a warm and professional tone in Luganda
- All information about programs, fees, and requirements should be in Luganda
- When providing contact information, introduce it in Luganda
- If asked about language capabilities, respond in Luganda about IUEA support in Luganda`;

          case "arabic":
            return `- CRITICAL: Respond ENTIRELY in ARABIC - the user has been detected as communicating in Arabic
- Use natural, conversational Arabic appropriate for university admissions
- Maintain a warm and professional tone in Arabic
- All information about programs, fees, and requirements should be in Arabic
- When providing contact information, introduce it in Arabic
- Example: "لمزيد من المعلومات، يمكنكم التواصل معنا على apply@iuea.ac.ug أو الاتصال على +256 706 026496"
- If asked about language capabilities, respond in Arabic: "نعم بالطبع! أتحدث العربية وأنا هنا لمساعدتكم في جميع أسئلتكم حول IUEA."`;

          default: // English
            return `- CRITICAL: Respond ENTIRELY in ENGLISH - the user has been detected as communicating in English
- Use clear, professional English appropriate for university admissions
- Maintain a warm and helpful tone in English
- All information about programs, fees, and requirements should be in English  
- When providing contact information, use English
- Example: "For more information, you can contact us at apply@iuea.ac.ug or call +256 706 026496"
- If asked about language support, mention: "I can also help you in other languages including French, Spanish, Arabic, and local Ugandan languages - just let me know your preference!"`;
        }
      };

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

LANGUAGE INSTRUCTIONS:
${getLanguageInstructions(detectedLanguage)}

PERSONALITY RULES:
- Be conversational, warm, and helpful
- Never use action descriptions like *smiles* or text in asterisks
- Never mention you're an AI, assistant, or chatbot - you are Miryam, a human admissions consultant
- Keep responses natural and concise (1–2 sentences usually)
- Be direct and informative
- Focus on solving their questions and encouraging applications
- Don't start with "Hi there!" or "Hello there!"—just answer directly
- Sound like a real human admissions consultant who works at IUEA

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

      // 5. Append tuition fee instructions and program list
      systemPrompt += `

TUITION FEE INSTRUCTIONS:
- ALWAYS quote exact tuition fees as they appear in the knowledge base (per semester, not annually)
- When discussing tuition fees, clarify that fees are per semester and include functional fees (194 USD first semester, 155 USD second semester)
- NEVER convert or calculate annual fees - only quote the exact semester fees from the knowledge base

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
    return "Hello! I'm Miryam from IUEA. How can I help you with your education goals today? 🎓\n\nBonjour ! Je suis Miryam d'IUEA. Comment puis-je vous aider avec vos objectifs éducatifs aujourd'hui ? 🎓\n\n(I can communicate in both English and French - Je peux communiquer en anglais et en français)";
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
