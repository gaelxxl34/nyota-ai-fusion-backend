const { getFirestore } = require("firebase-admin/firestore");

/**
 * Chatbot Service for handling live chat inquiries
 * This service manages real-time conversations without persisting to database
 */
class ChatbotService {
  constructor() {
    this.db = getFirestore();
    this.activeSessions = new Map();
    this.sessionTimeout = 60 * 60 * 1000; // 1 hour

    // Clean up expired sessions every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);
  }

  /**
   * Create a new chat session
   */
  createSession(userInfo = {}) {
    const sessionId = this.generateSessionId();
    const session = {
      id: sessionId,
      userInfo,
      messages: [],
      createdAt: new Date(),
      lastActivity: new Date(),
      isActive: true,
      metadata: {
        userAgent: userInfo.userAgent,
        referrer: userInfo.referrer,
        ipAddress: userInfo.ipAddress,
        location: userInfo.location,
      },
    };

    this.activeSessions.set(sessionId, session);
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId) {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Add message to session
   */
  addMessage(sessionId, message, isFromUser = false) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const messageObj = {
      id: this.generateMessageId(),
      content: message,
      isFromUser,
      timestamp: new Date(),
      sender: isFromUser ? "user" : "ai",
    };

    session.messages.push(messageObj);
    session.lastActivity = new Date();

    return messageObj;
  }

  /**
   * Get conversation history for a session
   */
  getConversationHistory(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return [];
    }

    return session.messages.map((msg) => ({
      message: msg.content,
      is_from_user: msg.isFromUser,
      sender_name: msg.isFromUser ? session.userInfo.name || "User" : "Miryam",
      timestamp: msg.timestamp,
    }));
  }

  /**
   * Update user information for a session
   */
  updateUserInfo(sessionId, userInfo) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.userInfo = { ...session.userInfo, ...userInfo };
      session.lastActivity = new Date();
    }
  }

  /**
   * End a chat session
   */
  endSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.isActive = false;
      session.endedAt = new Date();

      // Optionally save session summary to database for analytics
      this.saveLiveInquirySummary(session);

      // Remove from active sessions
      this.activeSessions.delete(sessionId);
    }
  }

  /**
   * Get active sessions count
   */
  getActiveSessionsCount() {
    return this.activeSessions.size;
  }

  /**
   * Get all active sessions (for admin monitoring)
   */
  getAllActiveSessions() {
    return Array.from(this.activeSessions.values()).map((session) => ({
      id: session.id,
      userInfo: session.userInfo,
      messageCount: session.messages.length,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      duration: Date.now() - session.createdAt.getTime(),
    }));
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (now - session.lastActivity.getTime() > this.sessionTimeout) {
        this.endSession(sessionId);
      }
    }
  }

  /**
   * Save live inquiry summary for analytics (optional)
   */
  async saveLiveInquirySummary(session) {
    try {
      if (session.messages.length === 0) return;

      const summary = {
        sessionId: session.id,
        duration: session.endedAt.getTime() - session.createdAt.getTime(),
        messageCount: session.messages.length,
        userMessageCount: session.messages.filter((m) => m.isFromUser).length,
        aiMessageCount: session.messages.filter((m) => !m.isFromUser).length,
        userInfo: session.userInfo,
        metadata: session.metadata,
        firstUserMessage:
          session.messages.find((m) => m.isFromUser)?.content || null,
        lastUserMessage:
          session.messages.filter((m) => m.isFromUser).pop()?.content || null,
        createdAt: session.createdAt,
        endedAt: session.endedAt,
        type: "live_inquiry",
      };

      // Save to Firestore for analytics
      await this.db.collection("chatbot_sessions").add(summary);
    } catch (error) {
      console.error("Error saving live inquiry summary:", error);
    }
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique message ID
   */
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * Get session analytics
   */
  getSessionAnalytics(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return null;
    }

    const userMessages = session.messages.filter((m) => m.isFromUser);
    const aiMessages = session.messages.filter((m) => !m.isFromUser);

    return {
      sessionId,
      duration: Date.now() - session.createdAt.getTime(),
      totalMessages: session.messages.length,
      userMessages: userMessages.length,
      aiMessages: aiMessages.length,
      averageResponseTime: this.calculateAverageResponseTime(session.messages),
      isActive: session.isActive,
      lastActivity: session.lastActivity,
    };
  }

  /**
   * Calculate average AI response time
   */
  calculateAverageResponseTime(messages) {
    const responseTimes = [];

    for (let i = 0; i < messages.length - 1; i++) {
      const current = messages[i];
      const next = messages[i + 1];

      if (current.isFromUser && !next.isFromUser) {
        const responseTime =
          next.timestamp.getTime() - current.timestamp.getTime();
        responseTimes.push(responseTime);
      }
    }

    if (responseTimes.length === 0) return 0;

    return (
      responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
    );
  }

  /**
   * Destroy service and cleanup
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.activeSessions.clear();
  }
}

module.exports = ChatbotService;
