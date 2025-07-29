/**
 * WhatsApp Message Service
 * Handles WhatsApp message processing, AI responses, and broadcasting
 */

const admin = require("firebase-admin");
const aiService = require("./ai.service");
const ConversationService = require("./conversationService");
const { broadcastMessage } = require("./broadcastService");

class WhatsAppMessageService {
  /**
   * Send a WhatsApp template message using the Cloud API
   * @param {string} phoneNumber - Recipient phone number (international format, no +)
   * @param {object} templatePayload - The template message payload (see WhatsApp Cloud API docs)
   * @returns {Promise<object>} - { success, messageId, error }
   */
  async sendTemplateMessage(phoneNumber, templatePayload) {
    const axios = require("axios");
    // WhatsApp Cloud API credentials from environment variables
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!accessToken || !phoneNumberId) {
      return {
        success: false,
        error: "WhatsApp API credentials not set in environment variables.",
      };
    }
    const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
    try {
      const response = await axios.post(url, templatePayload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });
      // WhatsApp API returns messageId in response.data.messages[0].id
      const messageId = response.data?.messages?.[0]?.id;
      return { success: true, messageId };
    } catch (error) {
      let errMsg = error.response?.data?.error?.message || error.message;
      return { success: false, error: errMsg };
    }
  }
  constructor() {
    this.conversationService = new ConversationService();
    this.db = admin.firestore();
  }

  /**
   * Process incoming WhatsApp message
   */
  async processIncomingMessage(messageData) {
    try {
      const {
        messageId,
        phoneNumber,
        messageContent,
        messageType,
        profileName,
      } = messageData;

      // Store message in database
      const messageDbId = await this.storeIncomingMessage(messageData);
      console.log(`💾 Stored incoming message with ID: ${messageDbId}`);

      // Broadcast to real-time clients
      this.broadcastIncomingMessage(messageData);

      // Handle AI auto-reply if enabled (check both global and per-conversation settings)
      if (messageType === "text" && aiService.getStatus().enabled) {
        const aiEnabledForConversation =
          await this.conversationService.getAIAutoReplyStatus(phoneNumber);
        if (aiEnabledForConversation) {
          await this.handleAIAutoReply(
            phoneNumber,
            messageContent,
            profileName
          );
        } else {
          console.log(
            `🤖 AI Auto-Reply disabled for conversation ${phoneNumber}`
          );
        }
      }

      return { success: true, messageDbId };
    } catch (error) {
      console.error("❌ Error processing incoming message:", error);
      throw error;
    }
  }

  /**
   * Store incoming message in database
   */
  async storeIncomingMessage({
    messageId,
    phoneNumber,
    messageContent,
    messageType,
    profileName,
  }) {
    return await this.conversationService.storeIncomingMessage({
      id: messageId,
      from: phoneNumber,
      type: messageType,
      text: { body: messageContent },
      timestamp: new Date().toISOString(),
      profile: { name: profileName },
    });
  }

  /**
   * Broadcast incoming message to SSE clients
   */
  broadcastIncomingMessage({
    messageId,
    phoneNumber,
    messageContent,
    messageType,
    profileName,
  }) {
    const incomingMessageData = {
      id: messageId,
      from: phoneNumber,
      sender: "customer",
      content: messageContent,
      type: messageType,
      profileName: profileName,
      timestamp: new Date(),
    };

    broadcastMessage(incomingMessageData, "incoming_message");
  }

  /**
   * Handle AI auto-reply logic
   */
  async handleAIAutoReply(phoneNumber, messageContent, profileName) {
    console.log("🤖 AI Auto-Reply is enabled, generating response...");

    try {
      // Start typing indicator
      this.broadcastAITyping(phoneNumber, profileName, true);

      // Fetch recent messages for context (last 3 messages)
      const recentMessages =
        await this.conversationService.getRecentMessagesForContext(phoneNumber);
      console.log(
        `📚 Got ${recentMessages.length} recent messages for AI context`
      );

      // Get lead status for this contact
      const leadStatus = await this.getLeadStatus(phoneNumber);
      console.log(
        `👤 Lead status for ${phoneNumber}: ${
          leadStatus || "No status (direct contact)"
        }`
      );

      // Generate AI response with context and lead status
      const aiResponse = await aiService.generateResponse(messageContent, {
        phoneNumber: phoneNumber,
        profileName: profileName,
        conversationHistory: recentMessages,
        leadStatus: leadStatus,
      });

      if (aiResponse) {
        // Stop typing indicator
        this.broadcastAITyping(phoneNumber, profileName, false);

        // Send AI response with natural delay
        await this.sendAIResponse(phoneNumber, aiResponse, profileName);
      } else {
        // Stop typing if no response generated
        this.broadcastAITyping(phoneNumber, profileName, false);
      }
    } catch (error) {
      console.error("❌ AI Response Error:", error);
      // Always stop typing indicator on error
      this.broadcastAITyping(phoneNumber, profileName, false);
    }
  }

  /**
   * Get lead status for a phone number
   */
  async getLeadStatus(phoneNumber) {
    try {
      // Normalize phone number for API call
      const normalizedPhone = phoneNumber
        .replace(/[^\d]/g, "")
        .replace(/^0+/, "");

      // Import axios here to avoid circular dependencies
      const axios = require("axios");

      // Use timeout to prevent hanging
      const response = await axios.get(
        `${
          process.env.BACKEND_URL || "http://localhost:3000"
        }/api/leads/phone/${normalizedPhone}`,
        { timeout: 3000 } // 3 second timeout
      );

      if (response.data.success && response.data.lead) {
        return response.data.lead.status;
      }

      return null; // No lead status found - direct contact
    } catch (error) {
      console.log(
        `⚠️ No lead found for ${phoneNumber}, treating as direct contact`
      );
      return null; // No status means direct contact
    }
  }

  /**
   * Broadcast AI typing status
   */
  broadcastAITyping(phoneNumber, profileName, isTyping) {
    broadcastMessage(
      {
        phoneNumber: phoneNumber,
        profileName: profileName,
        isTyping: isTyping,
        sender: "ai",
      },
      "ai_typing"
    );
  }

  /**
   * Send AI response message
   */
  async sendAIResponse(phoneNumber, aiResponse, profileName) {
    // Add minimal delay to show typing indicator briefly
    const delay = 200 + Math.random() * 300; // 0.2-0.5 seconds (reduced)

    setTimeout(async () => {
      try {
        // Find conversation
        const conversationId =
          await this.conversationService.findConversationByPhone(phoneNumber);

        if (!conversationId) {
          console.warn(
            `⚠️ No conversation found for phone number: ${phoneNumber}`
          );
          this.broadcastAITyping(phoneNumber, profileName, false);
          return;
        }

        // Send message through conversation service with AI flags
        const result = await this.conversationService.sendMessage(
          phoneNumber,
          aiResponse,
          conversationId,
          profileName,
          true, // isAI = true
          true // automated = true
        );

        if (result.success) {
          console.log(`🤖 AI replied to ${profileName}: "${aiResponse}"`);
          this.broadcastAIReply(phoneNumber, aiResponse, profileName);
        } else {
          console.error(
            "❌ Failed to send AI response via conversation service"
          );
          this.broadcastAITyping(phoneNumber, profileName, false);
        }
      } catch (error) {
        console.error("❌ Failed to send AI response:", error);
        this.broadcastAITyping(phoneNumber, profileName, false);
      }
    }, delay);
  }

  /**
   * Broadcast AI reply to SSE clients
   */
  broadcastAIReply(phoneNumber, aiResponse, profileName) {
    const aiMessageData = {
      id: `ai_${Date.now()}`,
      to: phoneNumber,
      sender: "ai",
      senderName: "Miryam",
      content: aiResponse,
      type: "text",
      profileName: "Miryam",
      timestamp: new Date(),
      isAI: true,
      automated: true,
      direction: "outgoing",
    };

    broadcastMessage(aiMessageData, "ai_reply");
  }

  /**
   * Process message status updates (delivery confirmations, read receipts)
   */
  async processMessageStatus(status) {
    try {
      const messageId = status.id;
      const statusType = status.status;
      const recipientId = status.recipient_id;
      const errors = status.errors || [];
      const timestamp = status.timestamp
        ? new Date(status.timestamp * 1000)
        : new Date();

      console.log(`📊 Message ${messageId} status updated to ${statusType}`);

      // Check if this is a validation message that failed
      if (statusType === "failed" && recipientId && errors.length > 0) {
        const errorCode = errors[0]?.code;
        const errorTitle = errors[0]?.title || "Unknown error";
        const errorDetails = errors[0]?.error_data?.details || "";

        console.log(
          `❌ WhatsApp message failed for ${recipientId} - Error ${errorCode}: ${errorTitle} (${errorDetails})`
        );

        // Always update validation status for failed messages
        await this.updateLeadValidationStatus(
          recipientId,
          messageId,
          false,
          errorCode
        );
      } else if (statusType === "delivered" && recipientId) {
        console.log(
          `✅ WhatsApp validation successful for ${recipientId} - Message delivered`
        );

        // Update lead validation status to confirmed
        await this.updateLeadValidationStatus(recipientId, messageId, true);
      }

      // Update message status in database with current timestamp
      await this.conversationService.updateMessageStatus(
        messageId,
        statusType,
        new Date()
      );

      // Broadcast status update to clients
      broadcastMessage(
        {
          messageId: messageId,
          status: statusType,
          timestamp: timestamp,
        },
        "message_status_update"
      );

      return { success: true };
    } catch (error) {
      console.error("❌ Error processing message status:", error);
      throw error;
    }
  }

  /**
   * Extract message data from WhatsApp webhook
   */
  extractMessageData(message, contact) {
    const phoneNumber = message.from;
    const messageId = message.id;
    const messageType = message.type;
    const messageContent = message.text?.body || "";
    const profileName = contact?.profile?.name || "Unknown";

    return {
      phoneNumber,
      messageId,
      messageType,
      messageContent,
      profileName,
    };
  }

  /**
   * Update lead validation status based on message delivery status
   * @deprecated - No longer needed with simplified validation approach
   */
  async updateLeadValidationStatus(
    phoneNumber,
    messageId,
    isValid,
    errorCode = null
  ) {
    // Validation queue removed - this function is no longer used
    console.log(
      "updateLeadValidationStatus called but skipped - validation queue removed"
    );
    return;
  }

  /**
   * Send a WhatsApp message
   * Delegates to conversation service
   */
  async sendMessage(phoneNumber, message, messageType = "text", metadata = {}) {
    try {
      return await this.conversationService.sendMessage(
        phoneNumber,
        message,
        metadata.leadId,
        metadata.contactName,
        false, // isAI
        false // automated
      );
    } catch (error) {
      console.error("❌ Error sending WhatsApp message:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send a WhatsApp validation message without creating conversation
   * Used for phone number validation - conversation created only after validation succeeds
   */
  async sendValidationMessage(phoneNumber, message, metadata = {}) {
    try {
      return await this.conversationService.sendValidationMessage(
        phoneNumber,
        message
      );
    } catch (error) {
      console.error("❌ Error sending validation message:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create conversation after successful validation
   * Should be called only after validation message has been confirmed as delivered
   */
  async createConversationAfterValidation(
    phoneNumber,
    validationMessage,
    messageId,
    metadata = {}
  ) {
    try {
      return await this.conversationService.createConversationWithValidationMessage(
        phoneNumber,
        validationMessage,
        metadata.leadId,
        metadata.contactName,
        messageId
      );
    } catch (error) {
      console.error("❌ Error creating conversation after validation:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new WhatsAppMessageService();
