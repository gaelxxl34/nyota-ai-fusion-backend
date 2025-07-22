const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const axios = require("axios");

class ConversationService {
  constructor() {
    this.db = getFirestore();
  }

  /**
   * Store incoming WhatsApp message in Firestore
   */
  async storeIncomingMessage(messageData) {
    try {
      const { id, from, type, text, timestamp, profile } = messageData;

      // Extract contact name from profile
      const contactName = profile?.name || null;

      // Find or create conversation with contact name
      const conversationId = await this.createOrGetConversation(
        from,
        null,
        contactName
      );

      // Store message
      const messageDoc = {
        messageId: id,
        conversationId: conversationId,
        from: from,
        to: process.env.WHATSAPP_PHONE_NUMBER_ID,
        content: text?.body || "",
        messageType: type,
        direction: "incoming",
        timestamp: new Date(timestamp),
        profileName: contactName || "Unknown",
        status: "received",
        createdAt: new Date(),
      };

      const messageRef = await this.db.collection("messages").add(messageDoc);

      // Update conversation with latest message and contact name
      const updateData = {
        lastMessage: text?.body || "",
        lastMessageTime: new Date(timestamp),
        lastMessageFrom: "customer",
        updatedAt: new Date(),
      };

      // Update contact name if provided
      if (contactName) {
        updateData.contactName = contactName;
      }

      await this.db
        .collection("conversations")
        .doc(conversationId)
        .update(updateData);

      console.log(
        `💾 Stored message ${id} in conversation ${conversationId} from ${
          contactName || from
        }`
      );
      return messageRef.id;
    } catch (error) {
      console.error("❌ Error storing incoming message:", error);
      throw error;
    }
  }

  /**
   * Find conversation by phone number
   */
  async findConversationByPhone(phoneNumber) {
    try {
      // Normalize phone number for comparison - remove all non-digits
      const normalizedNumber = phoneNumber.replace(/[^\d]/g, "");

      console.log(
        `🔍 Searching for conversation with phone: ${phoneNumber} (normalized: ${normalizedNumber})`
      );

      // Try exact match first
      let conversationsQuery = await this.db
        .collection("conversations")
        .where("phoneNumber", "==", phoneNumber)
        .limit(1)
        .get();

      if (!conversationsQuery.empty) {
        console.log(`✅ Found exact match for ${phoneNumber}`);
        return conversationsQuery.docs[0].id;
      }

      // Try normalized match (without country codes, spaces, etc.)
      conversationsQuery = await this.db
        .collection("conversations")
        .where("phoneNumber", "==", normalizedNumber)
        .limit(1)
        .get();

      if (!conversationsQuery.empty) {
        console.log(`✅ Found normalized match for ${normalizedNumber}`);
        return conversationsQuery.docs[0].id;
      }

      // Try with + prefix
      conversationsQuery = await this.db
        .collection("conversations")
        .where("phoneNumber", "==", `+${normalizedNumber}`)
        .limit(1)
        .get();

      if (!conversationsQuery.empty) {
        console.log(`✅ Found + prefixed match for +${normalizedNumber}`);
        return conversationsQuery.docs[0].id;
      }

      console.log(`❌ No conversation found for ${phoneNumber}`);
      return null;
    } catch (error) {
      console.error("❌ Error finding conversation:", error);
      return null;
    }
  }

  /**
   * Create or get existing conversation
   */
  async createOrGetConversation(
    phoneNumber,
    leadId = null,
    contactName = null
  ) {
    try {
      // First try to find existing conversation
      const existingConversationId = await this.findConversationByPhone(
        phoneNumber
      );
      if (existingConversationId) {
        // Update contact name if provided and conversation exists
        if (contactName) {
          try {
            await this.db
              .collection("conversations")
              .doc(existingConversationId)
              .update({
                contactName: contactName,
                updatedAt: new Date(),
              });
            console.log(
              `📝 Updated contact name for ${phoneNumber} to: ${contactName}`
            );
          } catch (updateError) {
            console.warn("⚠️ Could not update contact name:", updateError);
          }
        }
        return existingConversationId;
      }

      // Create new conversation with lead information (not contact)
      const conversationData = {
        phoneNumber: phoneNumber,
        leadId: leadId, // Use leadId instead of contactId
        contactName: contactName || `Contact ${phoneNumber.slice(-4)}`,
        organizationId: "dev_org_123", // Add organization ID for development
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastMessage: "",
        lastMessageTime: new Date(),
        lastMessageFrom: "system",
        messageCount: 0,
        aiEnabled: true, // AI auto-reply enabled by default
      };

      const conversationRef = await this.db
        .collection("conversations")
        .add(conversationData);
      console.log(
        `📞 Created new conversation ${
          conversationRef.id
        } for ${phoneNumber} (${contactName || "Unknown"}) - Lead ID: ${
          leadId || "None"
        }`
      );
      return conversationRef.id;
    } catch (error) {
      console.error("❌ Error creating conversation:", error);
      throw error;
    }
  }

  /**
   * Send WhatsApp message
   */
  async sendMessage(
    phoneNumber,
    message,
    leadId = null,
    contactName = null,
    isAI = false,
    automated = false
  ) {
    try {
      // Find or create conversation with lead information
      const conversationId = await this.createOrGetConversation(
        phoneNumber,
        leadId,
        contactName
      );

      // Send WhatsApp message
      const whatsappResult = await this.sendWhatsAppMessage(
        phoneNumber,
        message
      );

      if (whatsappResult.success) {
        // Determine if this is an AI message
        const messageIsAI =
          isAI ||
          (message &&
            (message.includes("I'm Miryam") ||
              message.includes("AI assistant") ||
              message.includes("Welcome to International University") ||
              message.includes("university family")));

        // Only store outgoing message if WhatsApp delivery was successful
        const messageDoc = {
          messageId: whatsappResult.messageId,
          conversationId: conversationId,
          from: process.env.WHATSAPP_PHONE_NUMBER_ID,
          to: phoneNumber,
          content: message,
          messageType: "text",
          direction: "outgoing",
          timestamp: new Date(),
          status: "sent",
          createdAt: new Date(),
          isAI: messageIsAI,
          automated: automated || messageIsAI, // AI messages are always automated
          senderName: messageIsAI ? "Miryam" : "Admin",
        };

        await this.db.collection("messages").add(messageDoc);

        // Update conversation with latest message
        await this.db
          .collection("conversations")
          .doc(conversationId)
          .update({
            lastMessage: message,
            lastMessageTime: new Date(),
            lastMessageFrom: "agent",
            updatedAt: new Date(),
            messageCount: FieldValue.increment(1),
          });

        console.log(`📤 Sent message to ${phoneNumber}: "${message}"`);
      } else {
        console.log(
          `❌ WhatsApp message failed for ${phoneNumber}: ${whatsappResult.error}`
        );
        console.log(`💭 No message record created due to delivery failure`);
      }

      return whatsappResult;
    } catch (error) {
      console.error("❌ Error sending message:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send WhatsApp message via API
   */
  async sendWhatsAppMessage(phoneNumber, message) {
    try {
      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      if (!accessToken || !phoneNumberId) {
        throw new Error("WhatsApp credentials not configured");
      }

      // Clean phone number
      const cleanPhoneNumber = phoneNumber.replace(/[^\d]/g, "");

      const payload = {
        messaging_product: "whatsapp",
        to: cleanPhoneNumber,
        type: "text",
        text: { body: message },
      };

      const response = await axios.post(
        `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      return {
        success: true,
        messageId: response.data.messages[0].id,
        whatsappMessageId: response.data.messages[0].id,
        data: response.data,
      };
    } catch (error) {
      console.error(
        "❌ WhatsApp API Error:",
        error.response?.data || error.message
      );
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }

  /**
   * Update message status
   */
  async updateMessageStatus(messageId, status, timestamp) {
    try {
      const messagesQuery = await this.db
        .collection("messages")
        .where("messageId", "==", messageId)
        .limit(1)
        .get();

      if (!messagesQuery.empty) {
        const messageDoc = messagesQuery.docs[0];

        // Prepare update data, ensuring no undefined values
        const updateData = {
          status: status,
          updatedAt: new Date(),
        };

        // Only add statusTimestamp if timestamp is provided and not undefined
        if (timestamp !== undefined && timestamp !== null) {
          updateData.statusTimestamp = timestamp;
        }

        await messageDoc.ref.update(updateData);
        console.log(`📊 Updated message ${messageId} status to ${status}`);
      }
    } catch (error) {
      console.error("❌ Error updating message status:", error);
    }
  }

  /**
   * Get active conversations for organization with pagination and optimization
   */
  async getActiveConversations(organizationId, options = {}) {
    try {
      const {
        limit = 50, // Reduced default limit from 200 to 50
        offset = 0,
        status = "active",
        includeClosed = false,
      } = options;

      console.log(
        `📋 Fetching conversations for organization ${organizationId} (limit: ${limit}, offset: ${offset})...`
      );

      // Build optimized query with proper indexing considerations
      let query = this.db.collection("conversations");

      // Add status filter
      if (!includeClosed) {
        query = query.where("status", "in", ["active", null]);
      }

      // Order by lastMessageTime for better performance (index exists)
      query = query.orderBy("lastMessageTime", "desc").limit(limit);

      // Add offset support
      if (offset > 0) {
        const offsetQuery = await this.db
          .collection("conversations")
          .orderBy("lastMessageTime", "desc")
          .limit(offset)
          .get();

        if (!offsetQuery.empty) {
          const lastDoc = offsetQuery.docs[offsetQuery.docs.length - 1];
          query = query.startAfter(lastDoc);
        }
      }

      const conversationsQuery = await query.get();

      console.log(
        `📊 Raw conversations fetched: ${conversationsQuery.docs.length}`
      );

      // Convert to objects with minimal data first
      const conversations = conversationsQuery.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          phoneNumber: data.phoneNumber,
          contactName: data.contactName,
          contactId: data.contactId,
          lastMessage: data.lastMessage,
          lastMessageTime: data.lastMessageTime,
          lastMessageFrom: data.lastMessageFrom,
          status: data.status || "active",
          messageCount: data.messageCount || 0,
          unreadCount: data.unreadCount || 0,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });

      // Only enhance with contact names if needed and for first page
      if (offset === 0) {
        console.log(
          `🔄 Enhancing ${conversations.length} conversations with contact names...`
        );

        // Use Promise.all for parallel contact name fetching
        const contactNamePromises = conversations.map(async (conversation) => {
          if (conversation.contactId && !conversation.contactName) {
            try {
              const contactName = await this.getContactName(
                conversation.contactId
              );
              if (contactName) {
                conversation.contactName = contactName;
              }
            } catch (error) {
              console.warn(
                `⚠️ Failed to get contact name for ${conversation.contactId}: ${error.message}`
              );
            }
          }
          return conversation;
        });

        const enhancedConversations = await Promise.all(contactNamePromises);

        console.log(
          `✅ Found ${enhancedConversations.length} active conversations for organization`
        );

        return {
          conversations: enhancedConversations,
          hasMore: conversationsQuery.docs.length === limit,
          total: null, // Will be calculated separately if needed
        };
      }

      console.log(
        `✅ Found ${conversations.length} active conversations for organization`
      );

      return {
        conversations,
        hasMore: conversationsQuery.docs.length === limit,
        total: null,
      };
    } catch (error) {
      console.error("❌ Error getting conversations:", error);
      return {
        conversations: [],
        hasMore: false,
        total: 0,
      };
    }
  }

  /**
   * Get messages for a conversation
   */
  /**
   * Get recent messages for AI context (last 3 messages)
   */
  async getRecentMessagesForContext(phoneNumber) {
    try {
      const conversationId = await this.findConversationByPhone(phoneNumber);
      if (!conversationId) {
        console.log(`⚠️ No conversation found for ${phoneNumber}`);
        return [];
      }

      console.log(`📋 Fetching recent messages for AI context...`);

      const messagesQuery = await this.db
        .collection("messages")
        .where("conversationId", "==", conversationId)
        .limit(10) // Get more to sort and pick last 3
        .get();

      const messages = messagesQuery.docs.map((doc) => {
        const data = doc.data();

        // Convert Firestore timestamp to JavaScript Date
        let timestamp = data.timestamp;
        if (timestamp && timestamp.toDate) {
          timestamp = timestamp.toDate();
        } else if (timestamp && timestamp._seconds) {
          timestamp = new Date(
            timestamp._seconds * 1000 + (timestamp._nanoseconds || 0) / 1000000
          );
        } else {
          timestamp = new Date();
        }

        return {
          id: doc.id,
          content: data.content || data.body || "",
          sender:
            data.direction === "incoming"
              ? "customer"
              : data.isAI
              ? "ai"
              : "admin",
          timestamp: timestamp,
          isAI: data.isAI === true,
        };
      });

      // Sort by timestamp and get the last 3 messages (excluding current incoming message)
      const sortedMessages = messages
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .slice(-3);

      console.log(
        `📨 Found ${sortedMessages.length} recent messages for context`
      );
      return sortedMessages;
    } catch (error) {
      console.error("❌ Error fetching recent messages for context:", error);
      return [];
    }
  }

  async getConversationMessages(conversationId, limit = 100) {
    try {
      // Simple query without orderBy to avoid index requirements
      console.log(
        "📋 Fetching messages without orderBy to avoid indexing issues..."
      );

      // First, get the conversation to know the contact ID
      const conversationDoc = await this.db
        .collection("conversations")
        .doc(conversationId)
        .get();

      let contactNameFromDatabase = null;
      if (conversationDoc.exists) {
        const conversationData = conversationDoc.data();

        // Always fetch the contact name from the contacts collection (not from conversation.contactName)
        if (conversationData.contactId) {
          contactNameFromDatabase = await this.getContactName(
            conversationData.contactId
          );
          console.log(
            `🔍 Contact lookup: Found "${contactNameFromDatabase}" in contacts collection for ID: ${conversationData.contactId}`
          );
        }
      }

      const messagesQuery = await this.db
        .collection("messages")
        .where("conversationId", "==", conversationId)
        .limit(limit)
        .get();

      const messages = messagesQuery.docs.map((doc) => {
        const data = doc.data();

        // Convert Firestore timestamp to JavaScript Date
        let timestamp = data.timestamp;
        if (timestamp && timestamp.toDate) {
          timestamp = timestamp.toDate().toISOString();
        } else if (timestamp && timestamp._seconds) {
          timestamp = new Date(
            timestamp._seconds * 1000 + (timestamp._nanoseconds || 0) / 1000000
          ).toISOString();
        } else {
          timestamp = new Date().toISOString();
        }

        // Determine if message is from AI
        const isAI =
          data.isAI === true ||
          (data.direction === "outgoing" &&
            data.from === process.env.WHATSAPP_PHONE_NUMBER_ID &&
            data.content &&
            (data.content.includes("AI assistant") ||
              data.content.includes("I'm Miryam") ||
              data.content.includes("university family") ||
              data.content.includes("Welcome to International University")));

        // Determine sender name - prioritize database contact name over WhatsApp profile name
        let senderName = "";
        if (data.direction === "incoming") {
          // Priority: 1. Database contact name 2. WhatsApp profile name 3. Generic fallback
          senderName =
            contactNameFromDatabase || data.profileName || "Unknown Contact";
          console.log(
            `👤 Message sender: Database="${contactNameFromDatabase}" vs WhatsApp="${data.profileName}" -> Using: "${senderName}"`
          );
        } else {
          senderName = isAI ? "Miryam" : "Admin";
        }

        return {
          id: doc.id,
          ...data,
          timestamp: timestamp,
          isAI: isAI,
          senderName: senderName,
        };
      });

      // Sort in memory by timestamp (ascending - oldest first)
      messages.sort((a, b) => {
        const timestampA = new Date(a.timestamp);
        const timestampB = new Date(b.timestamp);
        return timestampA - timestampB;
      });

      console.log(`✅ Found ${messages.length} messages for conversation`);
      return messages;
    } catch (error) {
      console.error("❌ Error getting messages:", error);
      return [];
    }
  }

  /**
   * Mark conversation as read
   */
  async markConversationAsRead(conversationId) {
    try {
      await this.db.collection("conversations").doc(conversationId).update({
        unreadCount: 0,
        lastReadAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`👁️ Marked conversation ${conversationId} as read`);
    } catch (error) {
      console.error("❌ Error marking conversation as read:", error);
    }
  }

  /**
   * Get contact name by contact ID
   */
  async getContactName(contactId) {
    try {
      if (!contactId) {
        return null;
      }

      console.log(`🔍 Fetching contact name for ID: ${contactId}`);

      const contactDoc = await this.db
        .collection("contacts")
        .doc(contactId)
        .get();

      if (contactDoc.exists) {
        const contactData = contactDoc.data();
        const contactName =
          contactData.name || contactData.fullName || contactData.firstName;
        console.log(
          `✅ Found contact name: ${contactName} for ID: ${contactId}`
        );
        return contactName;
      }

      console.log(`❌ No contact found for ID: ${contactId}`);
      return null;
    } catch (error) {
      console.error("❌ Error fetching contact:", error);
      return null;
    }
  }

  /**
   * Find contact by phone number
   */
  async findContactByPhone(phoneNumber) {
    try {
      console.log(`🔍 Searching for contact with phone: ${phoneNumber}`);

      // Normalize phone number for search
      const normalizedNumber = phoneNumber.replace(/[^\d]/g, "");

      // Try multiple phone number formats
      const phoneFormats = [
        phoneNumber,
        normalizedNumber,
        `+${normalizedNumber}`,
        `256${normalizedNumber.slice(-9)}`, // Uganda format
      ];

      for (const format of phoneFormats) {
        const contactsQuery = await this.db
          .collection("contacts")
          .where("phoneNumber", "==", format)
          .limit(1)
          .get();

        if (!contactsQuery.empty) {
          const contact = contactsQuery.docs[0];
          console.log(
            `✅ Found contact: ${contact.data().name} for phone: ${format}`
          );
          return {
            id: contact.id,
            ...contact.data(),
          };
        }
      }

      console.log(`❌ No contact found for phone: ${phoneNumber}`);
      return null;
    } catch (error) {
      console.error("❌ Error finding contact by phone:", error);
      return null;
    }
  }

  /**
   * Toggle AI auto-reply for a specific conversation
   */
  async toggleAIAutoReply(phoneNumber, enabled) {
    try {
      console.log(
        `🔍 Looking for conversation with phone number: "${phoneNumber}"`
      );

      if (!phoneNumber || phoneNumber.trim() === "") {
        throw new Error("Phone number is required and cannot be empty");
      }

      const conversationId = await this.findConversationByPhone(phoneNumber);
      if (!conversationId) {
        console.log(
          `❌ No conversation found for phone ${phoneNumber}. Creating a new conversation...`
        );

        // Create a new conversation if it doesn't exist
        const newConversationId = await this.createOrGetConversation(
          phoneNumber
        );
        console.log(`✅ Created new conversation: ${newConversationId}`);

        // Now update the AI setting
        await this.db
          .collection("conversations")
          .doc(newConversationId)
          .update({
            aiEnabled: enabled,
            updatedAt: new Date(),
          });

        console.log(
          `🤖 AI Auto-Reply ${
            enabled ? "ENABLED" : "DISABLED"
          } for ${phoneNumber} (new conversation)`
        );
        return { success: true, aiEnabled: enabled };
      }

      console.log(
        `🔄 Updating conversation ${conversationId} with aiEnabled: ${enabled}`
      );

      await this.db.collection("conversations").doc(conversationId).update({
        aiEnabled: enabled,
        updatedAt: new Date(),
      });

      console.log(
        `🤖 AI Auto-Reply ${
          enabled ? "ENABLED" : "DISABLED"
        } for ${phoneNumber}`
      );
      return { success: true, aiEnabled: enabled };
    } catch (error) {
      console.error("❌ Error toggling AI auto-reply:", error);
      throw error;
    }
  }

  /**
   * Get AI auto-reply status for a conversation
   */
  async getAIAutoReplyStatus(phoneNumber) {
    try {
      const conversationId = await this.findConversationByPhone(phoneNumber);
      if (!conversationId) {
        return true; // Default to enabled for new conversations
      }

      // Get the conversation document to check aiEnabled status
      const conversationDoc = await this.db
        .collection("conversations")
        .doc(conversationId)
        .get();

      if (!conversationDoc.exists) {
        return true; // Default to enabled if document doesn't exist
      }

      const conversationData = conversationDoc.data();
      // Return aiEnabled status, default to true if not set
      return conversationData.aiEnabled !== false;
    } catch (error) {
      console.error("❌ Error getting AI auto-reply status:", error);
      return true; // Default to enabled on error
    }
  }

  /**
   * Clear all messages from a conversation (but keep the conversation)
   */
  async clearConversationMessages(conversationId) {
    try {
      console.log(`🧹 Clearing messages from conversation: ${conversationId}`);

      // Find all messages associated with this conversation
      const messagesQuery = await this.db
        .collection("messages")
        .where("conversationId", "==", conversationId)
        .get();

      console.log(`📋 Found ${messagesQuery.size} messages to clear`);

      // Use batch for faster operation
      const batch = this.db.batch();
      messagesQuery.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      // Update conversation to reset message-related fields
      const conversationRef = this.db
        .collection("conversations")
        .doc(conversationId);
      batch.update(conversationRef, {
        lastMessage: "",
        lastMessageTime: null,
        lastMessageFrom: null,
        messageCount: 0,
        updatedAt: new Date(),
      });

      // Commit the batch operation - this is now faster with batching
      await batch.commit();

      console.log(
        `✅ Successfully cleared ${messagesQuery.size} messages from conversation ${conversationId}`
      );

      return {
        success: true,
        clearedMessages: messagesQuery.size,
        conversationId: conversationId,
      };
    } catch (error) {
      console.error("❌ Error clearing conversation messages:", error);
      throw error;
    }
  }

  /**
   * Clear all messages from a conversation by phone number
   */
  async clearConversationMessagesByPhone(phoneNumber) {
    try {
      console.log(`🧹 Clearing messages for phone: ${phoneNumber}`);

      // Find the conversation ID by phone number
      const conversationId = await this.findConversationByPhone(phoneNumber);

      if (!conversationId) {
        throw new Error(
          `No conversation found for phone number: ${phoneNumber}`
        );
      }

      // Clear the messages
      return await this.clearConversationMessages(conversationId);
    } catch (error) {
      console.error("❌ Error clearing conversation messages by phone:", error);
      throw error;
    }
  }

  /**
   * Delete a conversation and all associated messages
   */
  async deleteConversation(conversationId) {
    try {
      console.log(`🗑️ Deleting conversation: ${conversationId}`);

      // First, delete all messages associated with this conversation
      const messagesQuery = await this.db
        .collection("messages")
        .where("conversationId", "==", conversationId)
        .get();

      console.log(`📋 Found ${messagesQuery.size} messages to delete`);

      // Delete messages in batches
      const batch = this.db.batch();
      messagesQuery.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      // Delete the conversation document
      const conversationRef = this.db
        .collection("conversations")
        .doc(conversationId);
      batch.delete(conversationRef);

      // Commit the batch delete
      await batch.commit();

      console.log(
        `✅ Successfully deleted conversation ${conversationId} and ${messagesQuery.size} messages`
      );

      return {
        success: true,
        deletedMessages: messagesQuery.size,
        conversationId: conversationId,
      };
    } catch (error) {
      console.error("❌ Error deleting conversation:", error);
      throw error;
    }
  }

  /**
   * Delete a conversation by phone number
   */
  async deleteConversationByPhone(phoneNumber) {
    try {
      console.log(`🗑️ Deleting conversation for phone: ${phoneNumber}`);

      // Find the conversation ID by phone number
      const conversationId = await this.findConversationByPhone(phoneNumber);

      if (!conversationId) {
        throw new Error(
          `No conversation found for phone number: ${phoneNumber}`
        );
      }

      // Delete the conversation
      return await this.deleteConversation(conversationId);
    } catch (error) {
      console.error("❌ Error deleting conversation by phone:", error);
      throw error;
    }
  }

  /**
   * Delete multiple conversations by IDs
   */
  async deleteMultipleConversations(conversationIds) {
    try {
      console.log(`🗑️ Deleting ${conversationIds.length} conversations`);

      const results = [];

      for (const conversationId of conversationIds) {
        try {
          const result = await this.deleteConversation(conversationId);
          results.push(result);
        } catch (error) {
          console.error(
            `❌ Failed to delete conversation ${conversationId}:`,
            error
          );
          results.push({
            success: false,
            conversationId: conversationId,
            error: error.message,
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.length - successCount;

      console.log(
        `✅ Deleted ${successCount} conversations, ${failCount} failed`
      );

      return {
        success: true,
        results: results,
        summary: {
          total: conversationIds.length,
          succeeded: successCount,
          failed: failCount,
        },
      };
    } catch (error) {
      console.error("❌ Error deleting multiple conversations:", error);
      throw error;
    }
  }
}

module.exports = ConversationService;
