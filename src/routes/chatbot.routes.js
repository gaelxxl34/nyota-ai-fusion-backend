const express = require("express");
const router = express.Router();
const aiService = require("../services/ai.service");
const logger = require("../utils/logger");

// Store conversation sessions in memory (for live inquiries only)
const conversationSessions = new Map();

// Session cleanup - remove sessions older than 1 hour
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [sessionId, session] of conversationSessions.entries()) {
    if (session.lastActivity < oneHourAgo) {
      conversationSessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

// Generate session ID
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Initialize chatbot session
router.post("/init", async (req, res) => {
  try {
    const sessionId = generateSessionId();
    const welcomeMessage = await aiService.generateWelcomeMessage();

    // Create session
    const session = {
      id: sessionId,
      messages: [
        {
          id: `msg_${Date.now()}`,
          content: welcomeMessage,
          sender: "ai",
          timestamp: new Date(),
          isFromUser: false,
        },
      ],
      lastActivity: Date.now(),
      userInfo: req.body.userInfo || {},
    };

    conversationSessions.set(sessionId, session);

    res.json({
      success: true,
      sessionId,
      message: welcomeMessage,
      suggestions: [
        "Tell me about available programs",
        "What are the admission requirements?",
        "Parlez-moi des programmes disponibles",
        "¿Qué programas están disponibles?",
        "Niambie kuhusu programu zinazopatikana",
        "ما هي البرامج المتاحة؟",
      ],
    });
  } catch (error) {
    logger.error("Error initializing chatbot session:", error);
    res.status(500).json({
      success: false,
      error: "Failed to initialize chat session",
    });
  }
});

// Send message to chatbot
router.post("/message", async (req, res) => {
  try {
    const { sessionId, message, userInfo } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({
        success: false,
        error: "Session ID and message are required",
      });
    }

    // Get or create session
    let session = conversationSessions.get(sessionId);
    if (!session) {
      // Create new session if not found
      session = {
        id: sessionId,
        messages: [],
        lastActivity: Date.now(),
        userInfo: userInfo || {},
      };
      conversationSessions.set(sessionId, session);
    }

    // Add user message to session
    const userMessage = {
      id: `msg_${Date.now()}_user`,
      content: message,
      sender: "user",
      timestamp: new Date(),
      isFromUser: true,
    };
    session.messages.push(userMessage);

    // Update user info if provided
    if (userInfo) {
      session.userInfo = { ...session.userInfo, ...userInfo };
    }

    // Get conversation history for AI context
    const conversationHistory = session.messages.map((msg) => ({
      message: msg.content,
      is_from_user: msg.isFromUser,
      sender_name: msg.isFromUser ? session.userInfo.name || "User" : "Miryam",
      timestamp: msg.timestamp,
    }));

    // Generate AI response
    const aiResponse = await aiService.generateResponse(
      message,
      conversationHistory.slice(0, -1), // Exclude the current message from history
      null // No lead status for live chat
    );

    // Add AI response to session
    const aiMessage = {
      id: `msg_${Date.now()}_ai`,
      content: aiResponse,
      sender: "ai",
      timestamp: new Date(),
      isFromUser: false,
    };
    session.messages.push(aiMessage);

    // Update last activity
    session.lastActivity = Date.now();

    // Generate follow-up suggestions
    const suggestions = await aiService.generateFollowUpSuggestions(
      conversationHistory
    );

    res.json({
      success: true,
      response: aiResponse,
      suggestions: suggestions.slice(0, 3),
      sessionId,
    });
  } catch (error) {
    logger.error("Error processing chatbot message:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process message",
    });
  }
});

// Get conversation history
router.get("/conversation/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = conversationSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: "Session not found",
      });
    }

    res.json({
      success: true,
      messages: session.messages,
      userInfo: session.userInfo,
    });
  } catch (error) {
    logger.error("Error getting conversation history:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get conversation",
    });
  }
});

// Clear conversation
router.delete("/conversation/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;

    if (conversationSessions.has(sessionId)) {
      conversationSessions.delete(sessionId);
    }

    res.json({
      success: true,
      message: "Conversation cleared",
    });
  } catch (error) {
    logger.error("Error clearing conversation:", error);
    res.status(500).json({
      success: false,
      error: "Failed to clear conversation",
    });
  }
});

// Health check for chatbot
router.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    activeSessions: conversationSessions.size,
    aiEnabled: aiService.getStatus().enabled,
  });
});

// Get AI service status
router.get("/status", (req, res) => {
  try {
    const status = aiService.getStatus();
    res.json({
      success: true,
      ...status,
      activeSessions: conversationSessions.size,
    });
  } catch (error) {
    logger.error("Error getting chatbot status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get status",
    });
  }
});

module.exports = router;
