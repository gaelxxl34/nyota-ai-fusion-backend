const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/auth.middleware");
const axios = require("axios");
const whatsappMessageService = require("../services/whatsappMessageService");
const ConversationService = require("../services/conversationService");
const aiService = require("../services/ai.service");
const {
  addConnection,
  removeConnection,
  broadcastMessage,
} = require("../services/broadcastService");
// WhatsApp Cloud API Configuration
const WHATSAPP_ACCESS_TOKEN =
  process.env.WHATSAPP_ACCESS_TOKEN ||
  "EAAOh77mWWOIBPABEguuY3IBFUmBpr61KhhOJDZBJ2XduZCu6q5ecZCgrkYKKfZC35Hjq6RyRz4e56op0fofBMJE3al422J5VZCLbVPcTjcMVj0ABpYZASeg1d63ZC6QZAv1eAZAnB1U5fjbG8J8RZCrfh1MyvaZBw0nXOMQWMCO7rpKQvSvzfRHd8r1126oLeOuyNETS88U9Ht30ZBGMlLnb5YbdShQaj8GK8glv1RiWxUxQW5UZD";
const WHATSAPP_PHONE_NUMBER_ID =
  process.env.WHATSAPP_PHONE_NUMBER_ID || "693644923834735";
const WHATSAPP_VERIFY_TOKEN =
  process.env.WHATSAPP_VERIFY_TOKEN || "NYOTA_VERIFY_2025";

// WhatsApp webhook verification endpoint
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("📱 WhatsApp webhook verification:", { mode, token, challenge });

  if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
    console.log("✅ WhatsApp webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    console.log("❌ WhatsApp webhook verification failed");
    res.status(403).send("Forbidden");
  }
});

// WhatsApp webhook callback - receives messages
router.post("/webhook", async (req, res) => {
  const timestamp = new Date();

  console.log(
    "📱 WhatsApp webhook received:",
    JSON.stringify(req.body, null, 2)
  );

  try {
    if (req.body.entry) {
      for (const entry of req.body.entry) {
        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.value && change.value.messages) {
              for (const message of change.value.messages) {
                await processIncomingMessage(message, change.value);
              }
            }
            if (change.value && change.value.statuses) {
              for (const status of change.value.statuses) {
                await processMessageStatus(status);
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("❌ Error processing WhatsApp webhook:", error);
  }

  res.status(200).json({ success: true });
});

// Process incoming WhatsApp messages
async function processIncomingMessage(message, metadata) {
  try {
    // Ensure phone number has + prefix for consistency
    const phoneNumber = message.from.startsWith("+")
      ? message.from
      : `+${message.from}`;

    // Extract message content based on type
    let messageContent = "";
    switch (message.type) {
      case "text":
        messageContent = message.text.body;
        break;
      case "image":
        messageContent = `[Image] ${message.image.caption || "No caption"}`;
        break;
      case "document":
        messageContent = `[Document] ${
          message.document.filename || "Unknown file"
        }`;
        break;
      case "audio":
        messageContent = "[Audio message]";
        break;
      case "video":
        messageContent = "[Video message]";
        break;
      case "voice":
        messageContent = "[Voice message]";
        break;
      case "location":
        messageContent = "[Location shared]";
        break;
      case "contacts":
        messageContent = "[Contact shared]";
        break;
      default:
        messageContent = `[${message.type} message]`;
    }

    const profileName =
      metadata.contacts?.[0]?.profile?.name ||
      `WhatsApp User ${phoneNumber.slice(-4)}`;

    // Create message data object
    const messageData = {
      messageId: message.id,
      phoneNumber: phoneNumber,
      messageType: message.type,
      messageContent: messageContent,
      profileName: profileName,
    };

    // Process message using the refactored service
    await whatsappMessageService.processIncomingMessage(messageData);
  } catch (error) {
    console.error("❌ Error processing incoming message:", error);
  }
}
// Process message status updates (delivery confirmations, read receipts)
async function processMessageStatus(status) {
  try {
    await whatsappMessageService.processMessageStatus(status);

    // Also check for pending validations from enhanced webhook routes
    const messageId = status.id;
    const messageStatus = status.status; // sent, delivered, read, failed
    const errors = status.errors || [];

    // Import pendingValidations from enhanced webhook routes
    try {
      const { pendingValidations } = require("./enhanced-webhook.routes");

      // Check if this message ID has a pending validation
      if (pendingValidations && pendingValidations.has(messageId)) {
        const validation = pendingValidations.get(messageId);

        // Clear the timeout
        clearTimeout(validation.timeoutId);

        // Remove from pending validations
        pendingValidations.delete(messageId);

        if (messageStatus === "failed") {
          // Message failed - resolve with error details
          const errorInfo =
            errors.length > 0 ? errors[0] : { message: "Unknown error" };
          const errorMessage = `${errorInfo.code}: ${errorInfo.message} (${
            errorInfo.error_data?.details || "Unknown details"
          })`;

          console.log(
            `📞 Validation failed for ${validation.phone}: ${errorMessage}`
          );

          validation.resolve({
            success: false,
            error: errorMessage,
            code: errorInfo.code,
          });
        } else if (messageStatus === "sent" || messageStatus === "delivered") {
          // Message was sent/delivered successfully
          console.log(
            `📞 Validation successful for ${validation.phone}: ${messageStatus}`
          );

          validation.resolve({
            success: true,
            status: messageStatus,
          });
        }
        // For other statuses (read, etc.), we don't need to do anything
      }
    } catch (importError) {
      // Enhanced webhook routes might not be available - ignore this error
      console.debug(
        "Enhanced webhook validation not available:",
        importError.message
      );
    }
  } catch (error) {
    console.error("❌ Error processing message status:", error);
  }
}
// Send WhatsApp message (simplified)
async function sendWhatsAppMessage(to, message, messageType = "text") {
  try {
    const cleanTo = to.replace(/[^\d]/g, "");

    let payload = {
      messaging_product: "whatsapp",
      to: cleanTo,
      type: messageType,
    };

    if (messageType === "text") {
      payload.text = { body: message };
    }

    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ WhatsApp message sent successfully:", response.data);

    return {
      success: true,
      data: response.data,
      messageId: response.data.messages[0].id,
    };
  } catch (error) {
    console.error("❌ Failed to send WhatsApp message:", error);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
    };
  }
}

// API Routes using WhatsApp Cloud API directly

// Get business profile info (replaces conversations for now)
router.get("/business-profile", authenticateUser, async (req, res) => {
  try {
    // Get WhatsApp Business Profile
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_NUMBER_ID}?fields=verified_name,display_phone_number,quality_rating`,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        },
      }
    );

    console.log("📊 WhatsApp Business Profile:", response.data);

    res.json({
      success: true,
      profile: response.data,
      message: "WhatsApp Cloud API is ready for real-time messaging",
    });
  } catch (error) {
    console.error("❌ Error fetching business profile:", error);
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || error.message,
    });
  }
});

// Get conversations from Firestore with pagination and filtering
router.get("/conversations", authenticateUser, async (req, res) => {
  try {
    console.log("📋 Fetching conversations from Firestore...");

    const conversationService = new ConversationService();

    // Extract pagination and filter parameters
    const {
      limit = 25, // Reduced default for better performance
      offset = 0,
      status = "active",
      includeClosed = "false",
      leadStatus = null, // New: filter by lead status
    } = req.query;

    // Validate limit (max 50 per request for performance)
    const parsedLimit = Math.min(parseInt(limit) || 25, 50);
    const parsedOffset = parseInt(offset) || 0;
    const includeClosedBool = includeClosed.toLowerCase() === "true";

    // Fetch conversations using the optimized service
    const result = await conversationService.getActiveConversations({
      limit: parsedLimit,
      offset: parsedOffset,
      status,
      includeClosed: includeClosedBool,
      leadStatus, // Pass lead status filter
    });

    console.log(
      `✅ Returning ${result.conversations.length} conversations to frontend (filtered by leadStatus: ${leadStatus})`
    );

    res.json({
      success: true,
      conversations: result.conversations,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: result.hasMore,
        totalCount: result.totalCount,
        nextOffset: result.pagination?.nextOffset || parsedOffset + parsedLimit,
        currentPage:
          result.pagination?.currentPage ||
          Math.floor(parsedOffset / parsedLimit) + 1,
        totalFetched: result.conversations.length,
      },
      filters: {
        leadStatus,
        status,
        includeClosed: includeClosedBool,
      },
      message: `Found ${result.conversations.length} active conversations`,
    });
  } catch (error) {
    console.error("❌ Error fetching conversations:", error);
    res.status(500).json({
      success: false,
      conversations: [],
      error: error.message,
    });
  }
});

// Get messages for a conversation with pagination
router.get(
  "/conversations/:phoneNumber/messages",
  authenticateUser,
  async (req, res) => {
    try {
      const { phoneNumber } = req.params;
      const { limit = 50, offset = 0 } = req.query;

      const conversationService = new ConversationService();

      // Find conversation by phone number
      const conversationId = await conversationService.findConversationByPhone(
        phoneNumber
      );

      if (!conversationId) {
        return res.json({
          success: true,
          messages: [],
          phoneNumber: phoneNumber,
          message: "No conversation found for this phone number",
        });
      }

      // Get paginated messages for the conversation
      const parsedLimit = Math.min(parseInt(limit) || 50, 100);
      const parsedOffset = parseInt(offset) || 0;

      const result = await conversationService.getConversationMessages(
        conversationId,
        {
          limit: parsedLimit,
          offset: parsedOffset,
        }
      );

      res.json({
        success: true,
        messages: result.messages || [],
        phoneNumber: phoneNumber,
        conversationId: conversationId,
        pagination: {
          limit: parsedLimit,
          offset: parsedOffset,
          hasMore: result.hasMore || false,
          total: result.total || result.messages?.length || 0,
        },
      });
    } catch (error) {
      console.error("❌ Error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);
// Send message to WhatsApp
router.post("/send-message", authenticateUser, async (req, res) => {
  try {
    const { to, message, messageType = "text", leadData } = req.body;

    if (!to || !message) {
      return res.status(400).json({
        success: false,
        error: "Phone number and message are required",
      });
    }

    // Normalize phone number for consistency
    const normalizedPhone = to.startsWith("+") ? to : `+${to}`;

    // Extract lead information from leadData if provided
    const leadId = leadData?.id || null;
    const contactName = leadData?.name || leadData?.contactName || null;

    // Use ConversationService to send message and create conversation/message records
    const conversationService = new ConversationService();
    const result = await conversationService.sendMessage(
      normalizedPhone,
      message,
      leadId,
      contactName,
      false, // isAI = false (manual admin message)
      false // automated = false (manual admin message)
    );

    if (result.success) {
      // Broadcast admin message via SSE for real-time updates
      const adminMessageData = {
        id: result.messageId,
        to: normalizedPhone,
        content: message,
        timestamp: new Date().toISOString(),
        sender: "admin",
        senderName: "Admin",
        messageType: messageType,
        isAI: false,
        automated: false,
        direction: "outgoing",
      };

      broadcastMessage(adminMessageData, "admin_message");

      console.log(
        `✅ Message sent and conversation/message records created for ${normalizedPhone}`
      );

      res.json({
        success: true,
        message: "WhatsApp message sent successfully",
        data: result.data,
        messageId: result.messageId,
        delivered: true, // WhatsApp API confirmed delivery
      });
    } else {
      // Return success: false with specific error details for better frontend handling
      res.json({
        success: false,
        error: result.error,
        delivered: false, // WhatsApp delivery failed
        canRetry:
          result.error && result.error.includes("24 hours") ? false : true,
      });
    }
  } catch (error) {
    console.error("❌ Error sending WhatsApp message:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Mark messages as read (simplified for real-time mode)
router.patch(
  "/conversations/:phoneNumber/mark-read",
  authenticateUser,
  async (req, res) => {
    try {
      const { phoneNumber } = req.params;

      console.log(`✅ Message read acknowledgment for ${phoneNumber}`);

      res.json({
        success: true,
        message: "Read status acknowledged (real-time mode)",
        phoneNumber: phoneNumber,
      });
    } catch (error) {
      console.error("❌ Error acknowledging read status:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Get WhatsApp configuration
router.get("/config", authenticateUser, async (req, res) => {
  try {
    res.json({
      success: true,
      config: {
        webhookUrl: process.env.WHATSAPP_WEBHOOK_URL || "Not configured",
        verifyToken: WHATSAPP_VERIFY_TOKEN,
        phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
        hasAccessToken: !!WHATSAPP_ACCESS_TOKEN,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching WhatsApp config:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Clear messages from conversation by phone number (keep conversation)
router.patch(
  "/conversations/phone/:phoneNumber/clear",
  authenticateUser,
  async (req, res) => {
    try {
      const { phoneNumber } = req.params;

      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          error: "Phone number is required",
        });
      }

      const conversationService = new ConversationService();
      const result = await conversationService.clearConversationMessagesByPhone(
        decodeURIComponent(phoneNumber)
      );

      res.json({
        success: true,
        message: `Cleared ${result.clearedMessages} messages from conversation with ${phoneNumber}`,
        data: result,
      });
    } catch (error) {
      console.error("❌ Error clearing conversation messages:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Delete conversation by ID
router.delete(
  "/conversations/:conversationId",
  authenticateUser,
  async (req, res) => {
    try {
      const { conversationId } = req.params;

      if (!conversationId) {
        return res.status(400).json({
          success: false,
          error: "Conversation ID is required",
        });
      }

      const conversationService = new ConversationService();
      const result = await conversationService.deleteConversation(
        conversationId
      );

      res.json({
        success: true,
        message: `Conversation deleted successfully. Removed ${result.deletedMessages} messages.`,
        data: result,
      });
    } catch (error) {
      console.error("❌ Error deleting conversation:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Delete conversation by phone number
router.delete(
  "/conversations/phone/:phoneNumber",
  authenticateUser,
  async (req, res) => {
    try {
      const { phoneNumber } = req.params;

      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          error: "Phone number is required",
        });
      }

      const conversationService = new ConversationService();
      const result = await conversationService.deleteConversationByPhone(
        decodeURIComponent(phoneNumber)
      );

      res.json({
        success: true,
        message: `Conversation for ${phoneNumber} deleted successfully. Removed ${result.deletedMessages} messages.`,
        data: result,
      });
    } catch (error) {
      console.error("❌ Error deleting conversation by phone:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Delete multiple conversations
router.delete("/conversations", authenticateUser, async (req, res) => {
  try {
    const { conversationIds } = req.body;

    if (
      !conversationIds ||
      !Array.isArray(conversationIds) ||
      conversationIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        error: "Array of conversation IDs is required",
      });
    }

    const conversationService = new ConversationService();
    const result = await conversationService.deleteMultipleConversations(
      conversationIds
    );

    res.json({
      success: true,
      message: `Bulk delete completed. ${result.summary.succeeded} succeeded, ${result.summary.failed} failed.`,
      data: result,
    });
  } catch (error) {
    console.error("❌ Error deleting multiple conversations:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get conversations by lead status (optimized filtering)
router.get(
  "/conversations/by-status/:status",
  authenticateUser,
  async (req, res) => {
    try {
      const { status } = req.params;
      const { limit = 25, offset = 0 } = req.query;

      const conversationService = new ConversationService();

      const result = await conversationService.getActiveConversations({
        limit: Math.min(parseInt(limit) || 25, 50),
        offset: parseInt(offset) || 0,
        leadStatus: status,
      });

      res.json({
        success: true,
        conversations: result.conversations,
        leadStatus: status,
        pagination: {
          limit: result.limit,
          offset: result.offset,
          hasMore: result.hasMore,
          total: result.total,
        },
      });
    } catch (error) {
      console.error("❌ Error fetching conversations by status:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Get conversation counts by lead status (for tab badges)
router.get("/conversations/counts", authenticateUser, async (req, res) => {
  try {
    const conversationService = new ConversationService();

    // This would ideally be optimized with aggregation queries
    // For now, we'll return cached counts or make separate queries
    const statusCounts = {
      NO_LEAD: 0,
      INQUIRY: 0,
      CONTACTED: 0,
      NURTURE: 0,
      PRE_QUALIFIED: 0,
      FOLLOW_UP: 0,
      APPLIED: 0,
      REVIEW: 0,
      PENDING_DOCS: 0,
      ADMITTED: 0,
      ENROLLED: 0,
      SUCCESS: 0,
    };

    // TODO: Implement efficient counting - for now return 0s
    // In a real implementation, you'd use Firestore aggregation queries
    // or maintain counts in a separate document

    res.json({
      success: true,
      counts: statusCounts,
      message: "Conversation counts by lead status",
    });
  } catch (error) {
    console.error("❌ Error fetching conversation counts:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Bulk update lead statuses in conversations
router.post(
  "/conversations/sync-lead-statuses",
  authenticateUser,
  async (req, res) => {
    try {
      const { phoneToStatusMap } = req.body;

      if (!phoneToStatusMap || typeof phoneToStatusMap !== "object") {
        return res.status(400).json({
          success: false,
          error: "phoneToStatusMap is required",
        });
      }

      const conversationService = new ConversationService();
      const updateCount = await conversationService.bulkUpdateLeadStatuses(
        phoneToStatusMap
      );

      res.json({
        success: true,
        message: `Updated ${updateCount} conversation lead statuses`,
        updateCount,
      });
    } catch (error) {
      console.error("❌ Error syncing lead statuses:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// SSE endpoint for real-time message updates
router.get("/messages/stream", (req, res) => {
  // Generate unique client ID
  const clientId = `client_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;

  // Add connection using broadcast service
  addConnection(clientId, res);

  // Handle client disconnect
  req.on("close", () => {
    removeConnection(clientId);
  });
});

// AI Auto-Reply Control Endpoints

// Get AI status
router.get("/ai/status", (req, res) => {
  try {
    const status = aiService.getStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("❌ Error getting AI status:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Enable/Disable AI auto-reply
router.post("/ai/toggle", (req, res) => {
  try {
    let { enabled } = req.body;

    // If no enabled value provided, toggle current state
    if (enabled === undefined || enabled === null) {
      const currentStatus = aiService.getStatus();
      enabled = !currentStatus.enabled;
    }

    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error: `enabled field must be a boolean, received: ${typeof enabled}`,
      });
    }

    aiService.setEnabled(enabled);

    console.log(
      `🤖 AI Auto-Reply toggled to: ${enabled ? "ENABLED" : "DISABLED"}`
    );

    res.json({
      success: true,
      message: `AI Auto-Reply ${enabled ? "enabled" : "disabled"}`,
      data: aiService.getStatus(),
    });
  } catch (error) {
    console.error("❌ Error toggling AI:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Toggle AI auto-reply for specific conversation
router.post("/ai/toggle-conversation", authenticateUser, async (req, res) => {
  try {
    const { phoneNumber, enabled } = req.body;

    console.log("🔄 AI Toggle Request:", {
      phoneNumber,
      enabled,
      phoneNumberType: typeof phoneNumber,
      enabledType: typeof enabled,
      phoneNumberLength: phoneNumber ? phoneNumber.length : 0,
      phoneNumberTrimmed: phoneNumber ? phoneNumber.trim() : "undefined",
    });

    if (!phoneNumber || phoneNumber.trim() === "") {
      console.log("❌ Invalid phone number provided");
      return res.status(400).json({
        success: false,
        error: "Phone number is required and cannot be empty",
      });
    }

    if (typeof enabled !== "boolean") {
      console.log("❌ Invalid enabled value provided");
      return res.status(400).json({
        success: false,
        error: "Enabled must be a boolean value",
      });
    }

    const conversationService = new ConversationService();
    console.log("📞 Calling toggleAIAutoReply...");
    const result = await conversationService.toggleAIAutoReply(
      phoneNumber.trim(),
      enabled
    );
    console.log("✅ Toggle result:", result);

    res.json({
      success: true,
      message: `AI Auto-Reply ${
        enabled ? "enabled" : "disabled"
      } for conversation`,
      data: result,
    });
  } catch (error) {
    console.error("❌ Error toggling conversation AI:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test AI response generation
router.post("/ai/test", async (req, res) => {
  try {
    const { message, context } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "message field is required",
      });
    }

    const response = await aiService.generateResponse(message, context || {});

    res.json({
      success: true,
      data: {
        userMessage: message,
        aiResponse: response,
        context: context,
      },
    });
  } catch (error) {
    console.error("❌ Error testing AI:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// WhatsApp API status check
router.get("/status", async (req, res) => {
  try {
    // Test WhatsApp API connectivity by fetching business profile
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_NUMBER_ID}?fields=verified_name,display_phone_number,quality_rating`,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        },
      }
    );

    console.log("✅ WhatsApp API status check successful");

    res.json({
      success: true,
      data: response.data,
      message: "WhatsApp Cloud API is connected and ready",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ WhatsApp API status check failed:", error);
    res.status(500).json({
      success: false,
      message: "Failed to connect to WhatsApp Cloud API",
      error: error.response?.data?.error?.message || error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Knowledge Base Management Routes

// Get all knowledge base items
router.get("/knowledge", (req, res) => {
  try {
    const knowledgeData = aiService.getKnowledgeBase();

    if (!knowledgeData.isLoaded || !knowledgeData.csvData) {
      return res.json({
        success: true,
        data: [],
        count: 0,
        message: "Knowledge base not loaded",
      });
    }

    // Parse CSV data into array of Q&A items with proper CSV parsing
    const csvLines = knowledgeData.csvData.split("\n");
    const items = [];
    let currentCategory = "";

    // Helper function to parse CSV line properly handling quotes
    const parseCSVLine = (line) => {
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

      result.push(current.trim()); // Add the last field
      return result;
    };

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

    csvLines.forEach((line, index) => {
      if (index === 0) return; // Skip header

      const cleanLine = line.trim().replace(/\r$/, "");
      if (!cleanLine) return;

      const fields = parseCSVLine(cleanLine);
      const question = fields[0] || "";
      const answer = fields[1] || "";

      // Check if this is a category line
      if (question && question.startsWith("CATEGORY:")) {
        currentCategory = question.replace("CATEGORY:", "").trim();
        return;
      }

      // Add Q&A item if both question and answer exist
      if (
        question &&
        answer &&
        question !== "Questions" &&
        answer !== "Answers"
      ) {
        const originalCategory = currentCategory || "General";
        const frontendCategory = categorizeFrontend(
          originalCategory,
          question,
          answer
        );

        items.push({
          id: `kb_${index}`,
          title: question, // Frontend expects 'title'
          content: answer, // Frontend expects 'content'
          question: question, // Keep original for reference
          answer: answer, // Keep original for reference
          category: frontendCategory, // Smart categorized for frontend
          originalCategory: originalCategory, // Keep original CSV category
          tags: [frontendCategory, originalCategory], // Both categories as tags
          priority: "medium",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    });

    res.json({
      success: true,
      data: items,
      count: items.length,
      csvSize: knowledgeData.size,
    });
  } catch (error) {
    console.error("❌ Error getting knowledge base:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Add knowledge base item
router.post("/knowledge", (req, res) => {
  try {
    const { category, title, content, tags, priority } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: "Title and content are required",
      });
    }

    const item = {
      category: category || "general",
      title,
      content,
      tags: Array.isArray(tags)
        ? tags
        : (tags || "")
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t),
      priority: priority || "medium",
    };

    const newItem = aiService.addKnowledgeItem(item);

    res.json({
      success: true,
      data: newItem,
      message: "Knowledge item added successfully",
    });
  } catch (error) {
    console.error("❌ Error adding knowledge item:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Update knowledge base item
router.put("/knowledge/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { category, title, content, tags, priority } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: "Title and content are required",
      });
    }

    const item = {
      category: category || "general",
      title,
      content,
      tags: Array.isArray(tags)
        ? tags
        : (tags || "")
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t),
      priority: priority || "medium",
    };

    const updatedItem = aiService.updateKnowledgeItem(id, item);

    if (!updatedItem) {
      return res.status(404).json({
        success: false,
        error: "Knowledge item not found",
      });
    }

    res.json({
      success: true,
      data: updatedItem,
      message: "Knowledge item updated successfully",
    });
  } catch (error) {
    console.error("❌ Error updating knowledge item:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Delete knowledge base item
router.delete("/knowledge/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = aiService.deleteKnowledgeItem(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: "Knowledge item not found",
      });
    }

    res.json({
      success: true,
      message: "Knowledge item deleted successfully",
    });
  } catch (error) {
    console.error("❌ Error deleting knowledge item:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Search knowledge base
router.get("/knowledge/search", (req, res) => {
  try {
    const { q } = req.query;
    const items = aiService.searchKnowledgeBase(q);

    res.json({
      success: true,
      data: items,
      query: q,
      count: items.length,
    });
  } catch (error) {
    console.error("❌ Error searching knowledge base:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test endpoint to verify conversation creation
router.post("/test-conversation", authenticateUser, async (req, res) => {
  try {
    const {
      phoneNumber = process.env.WHATSAPP_TEST_PHONE_NUMBER,
      contactName,
    } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      });
    }

    const conversationService = new ConversationService();

    // Test conversation creation
    const conversationId = await conversationService.createOrGetConversation(
      phoneNumber,
      null,
      contactName
    );

    res.json({
      success: true,
      message: "Conversation created successfully",
      conversationId: conversationId,
    });
  } catch (error) {
    console.error("❌ Error creating test conversation:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test AI response endpoint
router.post("/test-ai", async (req, res) => {
  try {
    const {
      message,
      phoneNumber = process.env.WHATSAPP_TEST_PHONE_NUMBER,
      profileName,
    } = req.body;

    if (!message || !phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Message and phoneNumber are required",
      });
    }

    const conversationService = new ConversationService();

    // Get recent messages for context
    const recentMessages =
      await conversationService.getRecentMessagesForContext(phoneNumber);

    // Get lead status
    let leadStatus = null;
    try {
      const normalizedPhone = phoneNumber
        .replace(/[^\d]/g, "")
        .replace(/^0+/, "");
      const leadResponse = await axios.get(
        `${
          process.env.BACKEND_URL || "http://localhost:3000"
        }/api/leads/phone/${normalizedPhone}`
      );
      if (leadResponse.data.success && leadResponse.data.lead) {
        leadStatus = leadResponse.data.lead.status;
      }
    } catch (error) {
      console.log("No lead status found - treating as direct contact");
    }

    // Generate AI response
    const aiResponse = await aiService.generateResponse(message, {
      phoneNumber: phoneNumber,
      profileName: profileName,
      conversationHistory: recentMessages,
      leadStatus: leadStatus,
    });

    res.json({
      success: true,
      response: aiResponse,
      context: {
        recentMessagesCount: recentMessages.length,
        leadStatus: leadStatus || "Direct Contact",
      },
    });
  } catch (error) {
    console.error("❌ Error testing AI:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
