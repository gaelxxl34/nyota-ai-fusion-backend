const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/auth.middleware");
const axios = require("axios");
// Import the WhatsAppMessageService class
const WhatsAppMessageService = require("../services/whatsappMessageService");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const LeadService = require("../services/leadService");
// Initialize services properly to avoid circular dependencies
const ConversationService = require("../services/conversationService");
const aiService = require("../services/ai.service");
const {
  addConnection,
  removeConnection,
  broadcastMessage,
} = require("../services/broadcastService");

// Initialize services
const db = getFirestore();
const leadService = new LeadService(db);
const conversationService = new ConversationService(db);
const whatsappMessageService = new WhatsAppMessageService(
  db,
  leadService,
  conversationService
);
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
    let email = null;

    switch (message.type) {
      case "text":
        messageContent = message.text.body;

        // Try to extract email from text message if present
        const emailRegex =
          /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
        const emailMatch = messageContent.match(emailRegex);
        if (emailMatch) {
          email = emailMatch[0];
          console.log(`📧 Extracted email from message: ${email}`);
        }
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

        // Try to extract email from shared contact if available
        if (message.contacts && message.contacts.length > 0) {
          const contact = message.contacts[0];
          if (contact.emails && contact.emails.length > 0) {
            email = contact.emails[0].email;
            console.log(`📧 Extracted email from shared contact: ${email}`);
          }
        }
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
      email: email, // Include email if extracted
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
            messageId: messageId, // Pass the message ID back to create conversation on lead creation
            phone: validation.phone,
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
      payload.text = {
        body: message,
        preview_url: true, // Enable clickable links and link previews
      };
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
      limit = 100, // Increased default for faster loading
      offset = 0,
      leadStatus = null, // Filter by lead status only
      loadAll = "false", // New: option to load all conversations at once
      includeClosed = "false", // Add includeClosed parameter
    } = req.query;

    // For loadAll requests, use a much higher limit
    const isLoadAll = loadAll.toLowerCase() === "true";
    const includeClosedBool = includeClosed.toLowerCase() === "true";
    let parsedLimit;

    if (isLoadAll) {
      parsedLimit = 5000; // Load up to 5000 conversations at once
    } else {
      // Validate limit (max 500 per request for better performance)
      parsedLimit = Math.min(parseInt(limit) || 100, 500);
    }

    const parsedOffset = parseInt(offset) || 0;

    // Fetch conversations using the optimized service with Redis caching
    let result;

    if (isLoadAll) {
      // Use the optimized all-at-once method
      console.log(`🚀 Using optimized loadAll method...`);
      result = await conversationService.getAllConversationsOptimized({
        leadStatus,
      });
    } else {
      // Use the new cached method for better performance
      console.log(`⚡ Using Redis cached method...`);
      result = await conversationService.getActiveConversationsWithCache({
        limit: parsedLimit,
        offset: parsedOffset,
        leadStatus, // Pass lead status filter
        forceRefresh: req.query.forceRefresh === "true", // Allow forcing refresh via query param
      });
    }

    console.log(
      `✅ Returning ${result.conversations.length} conversations to frontend${
        result.source ? ` (source: ${result.source})` : ""
      }${result.loadTime ? ` in ${result.loadTime}ms` : ""}`
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
      performance: {
        source: result.source || "firestore",
        loadTime: result.loadTime || null,
        cached: result.source === "cache",
      },
      filters: {
        leadStatus,
        includeClosed: includeClosedBool,
        loadAll: isLoadAll,
      },
      message: `Found ${result.conversations.length} active conversations${
        result.source ? ` from ${result.source}` : ""
      }`,
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
    let leadId = leadData?.id || leadData?.leadId || null;
    const contactName = leadData?.name || leadData?.contactName || null;

    // Check for leadId - essential for conversation tracking
    if (!leadId) {
      console.warn(
        `⚠️ No lead ID provided for message to ${normalizedPhone}. Will attempt to find or create a lead.`
      );

      // Try to find an existing lead by phone number
      const leadService = new LeadService(db);
      let lead = await leadService.findLeadByPhone(normalizedPhone);

      if (!lead || !lead.id) {
        // Create a new lead if none exists
        const newLeadData = {
          phone: normalizedPhone,
          name: contactName || `Contact ${normalizedPhone.slice(-4)}`,
          status: "CONTACTED",
          source: "WHATSAPP",
          createdAt: new Date(),
        };

        console.log(
          `📝 Creating new lead for WhatsApp conversation: ${normalizedPhone}`
        );
        const newLead = await leadService.createLead(newLeadData, "WHATSAPP");
        lead = newLead;
      }

      // Use the found or created lead ID
      leadId = lead.id;
    }

    // Use ConversationService to send message and create conversation/message records
    const conversationService = new ConversationService();
    // Determine human sender name (fallback to email local part or generic Admin)
    const humanSenderName =
      req.user?.name ||
      (req.user?.email ? req.user.email.split("@")[0] : null) ||
      "Admin";

    const result = await conversationService.sendMessage(
      normalizedPhone,
      message,
      leadId,
      contactName,
      false, // isAI = false (manual admin message)
      false, // automated = false (manual admin message)
      humanSenderName // senderNameOverride
    );

    if (result.success) {
      // Broadcast admin message via SSE for real-time updates
      const adminMessageData = {
        id: result.messageId,
        to: normalizedPhone,
        content: message,
        timestamp: new Date().toISOString(),
        sender: "admin",
        senderName: humanSenderName,
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

      const result = await conversationService.getActiveConversationsWithCache({
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

    // For general testing, context might be empty or contain conversation history
    const conversationHistory = context?.conversationHistory || [];
    const leadStatus = context?.leadStatus || null;

    const response = await aiService.generateResponse(
      message,
      conversationHistory,
      leadStatus
    );

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
    const items = aiService.getAllKnowledgeItems();

    res.json({
      success: true,
      data: items,
      count: items.length,
      message: "Knowledge base items retrieved successfully",
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
router.post("/knowledge", async (req, res) => {
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

    const newItem = await aiService.addKnowledgeItem(item);

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
router.put("/knowledge/:id", async (req, res) => {
  try {
    const id = req.params.id; // Keep as string for CSV IDs
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

    const updatedItem = await aiService.updateKnowledgeItem(id, item);

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
router.delete("/knowledge/:id", async (req, res) => {
  try {
    const id = req.params.id; // Keep as string for CSV IDs
    const deleted = await aiService.deleteKnowledgeItem(id);

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

    // Generate AI response with conversation history and lead status
    const aiResponse = await aiService.generateResponse(
      message,
      recentMessages, // Pass conversation history as second parameter
      leadStatus // Pass lead status as third parameter
    );

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

// Test enhanced AI response endpoint with context awareness
router.post("/test-enhanced-ai", async (req, res) => {
  try {
    const {
      message,
      phoneNumber = process.env.WHATSAPP_TEST_PHONE_NUMBER,
      profileName,
      simulateStatus = null, // Simulate different lead statuses for testing
    } = req.body;

    if (!message || !phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Message and phoneNumber are required",
      });
    }

    console.log(
      `🧪 Testing enhanced AI with simulated status: ${simulateStatus}`
    );

    const conversationService = new ConversationService();

    // Get enhanced conversation context
    const recentMessages =
      await conversationService.getRecentMessagesForContext(phoneNumber, 10);

    // Get lead status (use simulated if provided, otherwise real)
    let leadStatus = simulateStatus;
    if (!leadStatus) {
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
    }

    // Create mock user context for testing
    const mockUserContext = {
      leadStatus: leadStatus,
      applications:
        simulateStatus === "APPLIED" ? [{ status: "under_review" }] : [],
      engagementLevel: recentMessages.length > 5 ? "engaged" : "new",
      messageCount: recentMessages.length,
      lastInteraction: new Date(),
    };

    // Generate AI response with enhanced context
    const aiResponse = await aiService.generateResponse(
      message,
      recentMessages,
      leadStatus,
      mockUserContext
    );

    res.json({
      success: true,
      response: aiResponse,
      context: {
        recentMessagesCount: recentMessages.length,
        leadStatus: leadStatus || "Direct Contact",
        conversationAnalysis: recentMessages.conversationAnalysis,
        userContext: mockUserContext,
        testMode: true,
      },
    });
  } catch (error) {
    console.error("❌ Error testing enhanced AI:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Send WhatsApp Template Message for application follow-up
router.post("/send-template-message", authenticateUser, async (req, res) => {
  try {
    const {
      to,
      templateName = "application_followup_iuea",
      leadData,
    } = req.body;

    if (!to) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      });
    }

    // Normalize phone number for consistency
    const normalizedPhone = to.startsWith("+") ? to : `+${to}`;
    const cleanPhone = normalizedPhone.replace(/[^\d]/g, "");

    // Extract lead information from leadData if provided
    let leadId = leadData?.id || leadData?.leadId || null;
    const contactName = leadData?.name || leadData?.contactName || null;

    // Check for leadId - find or create if needed
    if (!leadId) {
      console.warn(
        `⚠️ No lead ID provided for template message to ${normalizedPhone}. Will attempt to find or create a lead.`
      );

      // Try to find an existing lead by phone number
      const leadService = new LeadService(db);
      let lead = await leadService.findLeadByPhone(normalizedPhone);

      if (!lead || !lead.id) {
        // Create a new lead if none exists
        const newLeadData = {
          phone: normalizedPhone,
          name: contactName || `Contact ${normalizedPhone.slice(-4)}`,
          status: "CONTACTED",
          source: "WHATSAPP",
          createdAt: new Date(),
        };

        console.log(
          `📝 Creating new lead for WhatsApp template conversation: ${normalizedPhone}`
        );
        const newLead = await leadService.createLead(newLeadData, "WHATSAPP");
        lead = newLead;
      }

      leadId = lead.id;
    }

    // Prepare the template payload based on templateName
    let templatePayload;
    let equivalentMessage = "";

    switch (templateName) {
      case "application_followup_iuea":
        templatePayload = {
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "template",
          template: {
            name: "application_followup_iuea",
            language: { code: "en_US" },
            components: [],
          },
        };

        // Define the equivalent message that users will see
        equivalentMessage = `Hi there! 👋
Just checking in to see how things are going with your IUEA application.
We'd love to hear from you — if there's anything you need or any challenge you're facing, feel free to let us know. 😊
We're here to support you and are excited to have you on this journey! 🌟`;
        break;

      case "application_in_review":
        templatePayload = {
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "template",
          template: {
            name: "application_in_review",
            language: { code: "en_US" },
            components: [],
          },
        };

        equivalentMessage = `Hello 👋
Your application is currently under review 📑
Our admissions team is carefully checking your details and documents.
👉 Visit your portal anytime for updates: https://applicant.iuea.ac.ug/`;
        break;

      case "application_qualified":
        templatePayload = {
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "template",
          template: {
            name: "application_qualified",
            language: { code: "en_US" },
            components: [],
          },
        };

        equivalentMessage = `Great news🎉
Your application has met all requirements, and you are qualified for admission.
👉 Check your portal now for the next steps: https://applicant.iuea.ac.ug/`;
        break;

      case "application_admitted":
        templatePayload = {
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "template",
          template: {
            name: "application_admitted",
            language: { code: "en_US" },
            components: [],
          },
        };

        equivalentMessage = `Congratulations 🎓🎉
You've been officially admitted to IUEA!
👉 Download your admission letter and complete enrollment here: https://applicant.iuea.ac.ug/
Welcome to the IUEA family 🌍`;
        break;

      case "application_deferred":
        templatePayload = {
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "template",
          template: {
            name: "application_deferred",
            language: { code: "en_US" },
            components: [],
          },
        };

        equivalentMessage = `Hello 👋
Your application has been deferred to a later intake ⏳
This means your admission process is postponed for now.
👉 Stay updated by checking your portal: https://applicant.iuea.ac.ug/`;
        break;

      default:
        return res.status(400).json({
          success: false,
          error: `Unsupported template: ${templateName}`,
        });
    }

    console.log(
      `📤 Sending template message "${templateName}" to ${normalizedPhone}...`
    );

    // Send template message via WhatsApp API
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      throw new Error("WhatsApp credentials not configured");
    }

    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`,
      templatePayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data && response.data.messages && response.data.messages[0]) {
      const messageId = response.data.messages[0].id;

      console.log(
        `✅ Template message sent successfully with ID: ${messageId}`
      );

      // Create or get conversation
      const conversationService = new ConversationService();
      const conversationId = await conversationService.createOrGetConversation(
        normalizedPhone,
        leadId,
        contactName
      );

      // Store the equivalent message in our database so it appears in the chat
      const templateSenderName =
        req.user?.name ||
        (req.user?.email ? req.user.email.split("@")[0] : null) ||
        "Admin";

      const messageDoc = {
        messageId: messageId,
        conversationId: conversationId,
        from: phoneNumberId,
        to: normalizedPhone,
        content: equivalentMessage,
        messageType: "template",
        sender: "admin", // Changed from senderType to sender for frontend compatibility
        senderType: "admin", // Keep both for backward compatibility
        direction: "outgoing",
        timestamp: new Date(),
        status: "sent",
        createdAt: new Date(),
        isAI: false,
        automated: false,
        senderName: templateSenderName,
        templateName: templateName,
        templateData: templatePayload,
      };

      try {
        await db.collection("messages").add(messageDoc);
        console.log(
          `📝 Template message saved to database with ID: ${messageId}`
        );

        // Update conversation with latest message
        await db
          .collection("conversations")
          .doc(conversationId)
          .update({
            lastMessage: equivalentMessage,
            lastMessageTime: new Date(),
            lastMessageFrom: "agent",
            updatedAt: new Date(),
            messageCount: FieldValue.increment(1),
          });
        console.log(
          `🔄 Conversation ${conversationId} updated with template message`
        );
      } catch (dbError) {
        console.error("❌ Error saving template message to database:", dbError);
        // Don't throw here as the WhatsApp message was sent successfully
        // Just log the error and continue
      }

      // Broadcast template message via SSE for real-time updates
      const templateMessageData = {
        id: messageId,
        to: normalizedPhone,
        content: equivalentMessage,
        timestamp: new Date().toISOString(),
        sender: "admin",
        senderName: templateSenderName,
        messageType: "template",
        templateName: templateName,
        isAI: false,
        automated: false,
        direction: "outgoing",
      };

      broadcastMessage(templateMessageData, "template_message");

      console.log(
        `✅ Template message stored and conversation updated for ${normalizedPhone}`
      );

      res.json({
        success: true,
        message: "WhatsApp template message sent successfully",
        data: response.data,
        messageId: messageId,
        equivalentMessage: equivalentMessage,
        templateName: templateName,
        delivered: true,
        conversationId: conversationId,
      });
    } else {
      throw new Error("Invalid response from WhatsApp API");
    }
  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || error.message;
    console.error(
      "❌ WhatsApp Template API Error:",
      error.response?.data || error.message
    );

    // Check for 24-hour window errors
    if (
      errorMessage &&
      (errorMessage.includes("24 hour") ||
        errorMessage.includes("outside the allowed window") ||
        errorMessage.includes("131047"))
    ) {
      console.log(
        "❌ This error suggests the number was already contacted, but template messages should work regardless"
      );
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      canRetry: true,
    });
  }
});

module.exports = router;
