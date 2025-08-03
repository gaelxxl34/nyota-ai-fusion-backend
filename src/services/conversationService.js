const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const axios = require("axios");

class ConversationService {
  constructor() {
    this.db = getFirestore();
  }

  /**
   * Convert a single timestamp value to JavaScript Date object
   * Handles various Firestore timestamp formats safely
   */
  _convertTimestamp(timestamp) {
    if (!timestamp) {
      return null;
    }

    try {
      // Firestore Timestamp object with _seconds property
      if (timestamp._seconds !== undefined) {
        return new Date(timestamp._seconds * 1000);
      }

      // Firestore Timestamp object with seconds property
      if (timestamp.seconds !== undefined) {
        return new Date(timestamp.seconds * 1000);
      }

      // Already a Date object
      if (timestamp instanceof Date) {
        return isNaN(timestamp.getTime()) ? null : timestamp;
      }

      // String that can be parsed as date
      if (typeof timestamp === "string") {
        const parsed = new Date(timestamp);
        return isNaN(parsed.getTime()) ? null : parsed;
      }

      // Unix timestamp (number)
      if (typeof timestamp === "number") {
        // Handle both seconds and milliseconds
        const date =
          timestamp > 1000000000000
            ? new Date(timestamp) // milliseconds
            : new Date(timestamp * 1000); // seconds
        return isNaN(date.getTime()) ? null : date;
      }

      // ISO string format
      if (typeof timestamp === "object" && timestamp.toDate) {
        return timestamp.toDate();
      }

      return null;
    } catch (error) {
      console.warn(`⚠️ Error converting timestamp:`, timestamp, error);
      return null;
    }
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
        senderType: "incoming", // For frontend color coding: white background
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
   * Find all conversations by lead ID
   */
  async findConversationsByLeadId(leadId) {
    try {
      console.log(`🔍 Searching for conversations with leadId: ${leadId}`);

      const conversationsQuery = await this.db
        .collection("conversations")
        .where("leadId", "==", leadId)
        .get();

      if (conversationsQuery.empty) {
        console.log(`❌ No conversations found for leadId: ${leadId}`);
        return [];
      }

      const conversations = conversationsQuery.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      console.log(
        `✅ Found ${conversations.length} conversations for leadId: ${leadId}`
      );
      return conversations;
    } catch (error) {
      console.error("❌ Error finding conversations by leadId:", error);
      return [];
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
        // If we have a conversation but no leadId is associated, update it with the leadId
        if (leadId) {
          const conversationDoc = await this.db
            .collection("conversations")
            .doc(existingConversationId)
            .get();

          const conversationData = conversationDoc.data();

          if (!conversationData.leadId && leadId) {
            console.log(
              `📝 Updating conversation ${existingConversationId} with leadId ${leadId}`
            );
            await this.db
              .collection("conversations")
              .doc(existingConversationId)
              .update({
                leadId: leadId,
                updatedAt: new Date(),
              });
          }
        }

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

      // If we don't have a leadId, we need to create a temporary lead
      if (!leadId) {
        console.log(
          `⚠️ No lead ID for ${phoneNumber}, creating temporary lead for new conversation`
        );

        // Create a new lead for this unknown contact
        try {
          const leadData = {
            name: contactName || `Unknown Contact ${phoneNumber.slice(-4)}`,
            phone: phoneNumber,
            status: "CONTACTED",
            source: "WHATSAPP",
            isTemporary: true, // Mark as temporary lead
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            notes: "Automatically created from direct WhatsApp message",
          };

          // Create the lead
          const leadRef = await this.db.collection("leads").add(leadData);
          leadId = leadRef.id;

          console.log(`✅ Created temporary lead ${leadId} for ${phoneNumber}`);
        } catch (leadError) {
          console.error(
            `❌ Failed to create temporary lead: ${leadError.message}`
          );
          // Even if lead creation fails, we'll create a conversation without a lead ID
          // to ensure we don't lose the conversation
        }
      }

      // Create new conversation with lead information if available
      const conversationData = {
        phoneNumber: phoneNumber,
        leadId: leadId, // Use leadId (might be null in error cases)
        contactName: contactName || `Contact ${phoneNumber.slice(-4)}`,
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
          senderType: messageIsAI ? "ai" : "admin", // For frontend color coding: green for AI, blue for admin
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
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      console.error(
        "❌ WhatsApp API Error:",
        error.response?.data || error.message
      );

      // Log specific error details for 24-hour window errors
      if (
        errorMessage &&
        (errorMessage.includes("24 hour") ||
          errorMessage.includes("outside the allowed window") ||
          errorMessage.includes("template message") ||
          errorMessage.includes("131047")) // WhatsApp error code for 24-hour window
      ) {
        console.log(
          "📍 24-hour window policy error detected. Number is valid but can't send free-form message."
        );
      }

      // Log specific error details for invalid number errors
      if (
        errorMessage &&
        (errorMessage.includes("131026") || // Message undeliverable - not on WhatsApp
          errorMessage.includes("131051") || // Invalid/Unsupported recipient
          errorMessage.includes("Message undeliverable"))
      ) {
        console.log(
          "❌ Invalid WhatsApp number detected. Number is not registered on WhatsApp."
        );
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Send WhatsApp validation message without creating conversation
   * Used for phone number validation - only creates conversation after validation succeeds
   */
  async sendValidationMessage(phoneNumber, message) {
    try {
      // Directly send WhatsApp message without creating conversation
      const whatsappResult = await this.sendWhatsAppMessage(
        phoneNumber,
        message
      );

      if (whatsappResult.success) {
        console.log(
          `📤 Sent validation message to ${phoneNumber}: "${message}"`
        );
        return {
          success: true,
          messageId: whatsappResult.messageId,
          whatsappMessageId: whatsappResult.whatsappMessageId,
        };
      } else {
        console.log(
          `❌ WhatsApp validation message failed for ${phoneNumber}: ${whatsappResult.error}`
        );
        return {
          success: false,
          error: whatsappResult.error,
        };
      }
    } catch (error) {
      console.error("❌ Error sending validation message:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Create conversation after successful validation and store the validation message
   * This should only be called after WhatsApp validation has succeeded
   */
  async createConversationWithValidationMessage(
    phoneNumber,
    message,
    leadId = null,
    contactName = null,
    messageId = null
  ) {
    try {
      // Create or get conversation now that we know the number is valid
      const conversationId = await this.createOrGetConversation(
        phoneNumber,
        leadId,
        contactName
      );

      // Store the validation message that was already sent
      if (messageId) {
        const messageDoc = {
          messageId: messageId,
          conversationId: conversationId,
          from: process.env.WHATSAPP_PHONE_NUMBER_ID,
          to: phoneNumber,
          content: message,
          messageType: "text",
          senderType: "admin", // Validation message is from admin
          direction: "outgoing",
          timestamp: new Date(),
          status: "sent",
          createdAt: new Date(),
          isAI: false,
          automated: true, // Validation messages are automated
          senderName: "System",
        };

        await this.db.collection("messages").add(messageDoc);

        // Update conversation with the validation message
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

        console.log(
          `📝 Stored validation message in conversation ${conversationId} for ${phoneNumber}`
        );
      }

      return {
        success: true,
        conversationId: conversationId,
      };
    } catch (error) {
      console.error(
        "❌ Error creating conversation with validation message:",
        error
      );
      return {
        success: false,
        error: error.message,
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
   * Get active conversations with pagination and optimization
   *
   * IMPORTANT: Lead status filtering uses Option B approach:
   * 1. Query leads by status first (leads.status field)
   * 2. Extract phone numbers from matching leads
   * 3. Find conversations by phone numbers
   * 4. Return filtered conversations
   *
   * This avoids the complexity of syncing leadStatus fields in conversations
   * and ensures we always get accurate, up-to-date lead status information.
   */
  async getActiveConversations(options = {}) {
    try {
      const {
        limit = 25, // Further reduced for better performance
        offset = 0,
        status = "active",
        includeClosed = false,
        leadStatus = null, // New: filter by lead status
      } = options;

      console.log(
        `📋 Fetching conversations (limit: ${limit}, offset: ${offset}, leadStatus: ${leadStatus})...`
      );

      // Option B: Query leads directly first, then find their conversations
      if (leadStatus && leadStatus !== "NO_LEAD") {
        // Step 1: Query leads by status
        const LeadService = require("./leadService");
        const leadService = new LeadService(this.db);

        const leadsWithStatus = await leadService.getLeadsByStatus(
          leadStatus,
          200
        ); // Get more leads to account for conversations
        console.log(
          `📋 Found ${leadsWithStatus.length} leads with status: ${leadStatus}`
        );

        if (leadsWithStatus.length === 0) {
          // No leads with this status, return empty result
          return {
            conversations: [],
            totalCount: 0,
            hasMore: false,
            limit,
            offset,
            pagination: {
              currentPage: 1,
              totalFetched: 0,
              totalAvailable: 0,
              hasMore: false,
              nextOffset: 0,
            },
          };
        }

        // Step 2: Get phone numbers from leads to find conversations
        const phoneNumbers = leadsWithStatus
          .map((lead) => lead.phone || lead.phoneNumber)
          .filter((phone) => phone); // Remove null/undefined phones

        console.log(
          `📋 Looking for conversations with ${phoneNumbers.length} phone numbers`
        );

        if (phoneNumbers.length === 0) {
          return {
            conversations: [],
            totalCount: 0,
            hasMore: false,
            limit,
            offset,
            pagination: {
              currentPage: 1,
              totalFetched: 0,
              totalAvailable: 0,
              hasMore: false,
              nextOffset: 0,
            },
          };
        }

        // Step 3: Query conversations by phone numbers (in batches due to Firestore limitations)
        let allConversations = [];
        const batchSize = 10; // Firestore 'in' query limit

        for (let i = 0; i < phoneNumbers.length; i += batchSize) {
          const phoneBatch = phoneNumbers.slice(i, i + batchSize);

          let conversationQuery = this.db
            .collection("conversations")
            .where("phoneNumber", "in", phoneBatch);

          // Add status filter
          if (!includeClosed) {
            conversationQuery = conversationQuery.where("status", "in", [
              "active",
              null,
            ]);
          }

          const snapshot = await conversationQuery.get();

          const batchConversations = [];

          for (const doc of snapshot.docs) {
            const data = doc.data();

            // Find the corresponding lead to get the name
            const correspondingLead = leadsWithStatus.find(
              (lead) => (lead.phone || lead.phoneNumber) === data.phoneNumber
            );

            batchConversations.push({
              id: doc.id,
              phoneNumber: data.phoneNumber,
              contactName:
                correspondingLead?.name ||
                data.contactName ||
                data.profileName ||
                `Contact ${data.phoneNumber?.slice(-4) || "Unknown"}`,
              leadName: correspondingLead?.name || null,
              leadId: data.leadId,
              leadStatus: leadStatus, // We know the lead status from our query
              status: data.status || "active",
              lastMessageTime:
                this._convertTimestamp(data.lastMessageTime) || new Date(),
              messageCount: data.messageCount || 0,
              unreadCount: data.unreadCount || 0,
              lastMessage: data.lastMessage || "",
              updatedAt: this._convertTimestamp(data.updatedAt) || new Date(),
            });
          }

          allConversations.push(...batchConversations);
        }

        // Step 4: Sort by lastMessageTime and apply pagination
        allConversations.sort((a, b) => {
          const timeA =
            a.lastMessageTime instanceof Date
              ? a.lastMessageTime
              : new Date(a.lastMessageTime || 0);
          const timeB =
            b.lastMessageTime instanceof Date
              ? b.lastMessageTime
              : new Date(b.lastMessageTime || 0);
          return timeB.getTime() - timeA.getTime();
        });

        // Apply offset and limit
        const startIndex = offset;
        const endIndex = startIndex + limit;
        const paginatedConversations = allConversations.slice(
          startIndex,
          endIndex
        );

        console.log(
          `✅ Returning ${
            paginatedConversations.length
          } conversations for lead status: ${leadStatus} (hasMore: ${
            endIndex < allConversations.length
          })`
        );

        return {
          conversations: paginatedConversations,
          totalCount: allConversations.length,
          hasMore: endIndex < allConversations.length,
          limit,
          offset,
          pagination: {
            currentPage: Math.floor(offset / limit) + 1,
            totalFetched: paginatedConversations.length,
            totalAvailable: allConversations.length,
            hasMore: endIndex < allConversations.length,
            nextOffset: offset + limit,
          },
        };
      }

      // Handle NO_LEAD case or when no leadStatus filter is specified
      let query = this.db.collection("conversations");

      if (leadStatus === "NO_LEAD") {
        // For conversations without leads - now using composite index
        query = query.where("leadId", "==", null);
      }

      // Add status filter (now works with composite index)
      if (!includeClosed) {
        query = query.where("status", "in", ["active", null]);
      }

      // Order by lastMessageTime for better performance (composite index supports this)
      query = query.orderBy("lastMessageTime", "desc").limit(limit);

      // Add offset support using startAfter for better performance
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

      // Convert to objects with optimized data structure
      const conversations = [];

      for (const doc of conversationsQuery.docs) {
        const data = doc.data();

        // Get lead name if leadId exists
        let leadName = null;
        if (data.leadId) {
          leadName = await this.getLeadName(data.leadId);
        }

        // Calculate display name with priority: Lead Name > Contact Name > Profile Name > Generic
        const displayName =
          leadName ||
          data.contactName ||
          data.profileName ||
          `Contact ${data.phoneNumber?.slice(-4) || "Unknown"}`;

        conversations.push({
          id: doc.id,
          phoneNumber: data.phoneNumber,
          contactName: displayName,
          leadName: leadName, // Include lead name separately for reference
          contactId: data.contactId,
          lastMessage: data.lastMessage || "",
          lastMessageTime:
            this._convertTimestamp(data.lastMessageTime) ||
            this._convertTimestamp(data.createdAt) ||
            new Date(),
          lastMessageFrom: data.lastMessageFrom,
          status: data.status || "active",
          messageCount: data.messageCount || 0,
          unreadCount: data.unreadCount || 0,
          leadStatus: data.leadStatus || "NO_LEAD", // Include lead status
          leadId: data.leadId || null,
          aiEnabled: data.aiEnabled !== false, // Default to true
          createdAt: this._convertTimestamp(data.createdAt),
          updatedAt: this._convertTimestamp(data.updatedAt),
        });
      }

      // Calculate pagination info correctly
      const totalFetched = conversations.length;
      const hasMore = totalFetched === limit; // If we got exactly 'limit' items, there might be more

      console.log(
        `✅ Returning ${totalFetched} conversations (hasMore: ${hasMore}, limit: ${limit}, offset: ${offset})`
      );

      return {
        conversations,
        totalCount: totalFetched, // Current page count
        hasMore,
        limit,
        offset,
        pagination: {
          currentPage: Math.floor(offset / limit) + 1,
          totalFetched,
          hasMore,
          nextOffset: offset + limit,
        },
      };
    } catch (error) {
      console.error("❌ Error fetching active conversations:", error);
      return {
        conversations: [],
        totalCount: 0,
        hasMore: false,
        limit: options.limit || 25,
        offset: options.offset || 0,
        pagination: {
          currentPage: 1,
          totalFetched: 0,
          hasMore: false,
          nextOffset: 0,
        },
      };
    }
  }

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

        // Determine message type and alignment for frontend display
        let messageType, alignment, sender;

        if (data.direction === "incoming") {
          messageType = "customer"; // White background, left alignment
          alignment = "left";
          sender = "customer";
        } else {
          alignment = "right";
          if (data.isAI === true || data.senderType === "ai") {
            messageType = "ai"; // Green background, right alignment
            sender = "ai";
          } else {
            messageType = "admin"; // Blue background, right alignment
            sender = "admin";
          }
        }

        return {
          id: doc.id,
          content: data.content || data.body || "",
          sender: sender,
          messageType: data.senderType
            ? data.senderType === "incoming"
              ? "customer"
              : data.senderType === "admin"
              ? "admin"
              : data.senderType
            : messageType,
          alignment: alignment,
          timestamp: timestamp,
          isAI: data.isAI === true,
          direction: data.direction,
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

  async getConversationMessages(conversationId, options = {}) {
    try {
      const { limit = 50, offset = 0 } = options;

      console.log(
        `📋 Fetching messages for conversation ${conversationId} (limit: ${limit}, offset: ${offset})...`
      );

      // First, get the conversation to know the contact ID and lead ID
      const conversationDoc = await this.db
        .collection("conversations")
        .doc(conversationId)
        .get();

      let contactNameFromDatabase = null;
      let leadNameFromDatabase = null;

      if (conversationDoc.exists) {
        const conversationData = conversationDoc.data();

        // Fetch contact name from contacts collection
        if (conversationData.contactId) {
          contactNameFromDatabase = await this.getContactName(
            conversationData.contactId
          );
          console.log(
            `🔍 Contact lookup: Found "${contactNameFromDatabase}" in contacts collection for ID: ${conversationData.contactId}`
          );
        }

        // Fetch lead name from leads collection
        if (conversationData.leadId) {
          leadNameFromDatabase = await this.getLeadName(
            conversationData.leadId
          );
          console.log(
            `🔍 Lead lookup: Found "${leadNameFromDatabase}" in leads collection for ID: ${conversationData.leadId}`
          );
        }
      }

      // Build query with pagination
      let messagesQuery = this.db
        .collection("messages")
        .where("conversationId", "==", conversationId)
        .orderBy("timestamp", "desc") // Order by timestamp for pagination
        .limit(limit);

      // Add offset support using startAfter
      if (offset > 0) {
        const offsetQuery = await this.db
          .collection("messages")
          .where("conversationId", "==", conversationId)
          .orderBy("timestamp", "desc")
          .limit(offset)
          .get();

        if (!offsetQuery.empty) {
          const lastDoc = offsetQuery.docs[offsetQuery.docs.length - 1];
          messagesQuery = messagesQuery.startAfter(lastDoc);
        }
      }

      const messagesSnapshot = await messagesQuery.get();

      const messages = messagesSnapshot.docs.map((doc) => {
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

        // Determine if message is from AI - check stored flag first, then content patterns
        const isAI =
          data.isAI === true ||
          data.senderType === "ai" ||
          (data.direction === "outgoing" &&
            data.content &&
            (data.content.includes("AI assistant") ||
              data.content.includes("I'm Miryam") ||
              data.content.includes("university family") ||
              data.content.includes("Welcome to International University")));

        // Determine message type and sender info for frontend
        let senderName = "";
        let messageType = "";
        let alignment = "";

        if (data.direction === "incoming") {
          // Incoming messages: left alignment, white background
          // Priority: Lead Name > Contact Name > WhatsApp Profile Name > Generic fallback
          senderName =
            leadNameFromDatabase ||
            contactNameFromDatabase ||
            data.profileName ||
            "Unknown Contact";
          messageType = "customer"; // For consistency with frontend expectations
          alignment = "left";
          console.log(
            `👤 Incoming message from: Lead="${leadNameFromDatabase}" vs Contact="${contactNameFromDatabase}" vs WhatsApp="${data.profileName}" -> Using: "${senderName}"`
          );
        } else {
          // Outgoing messages: right alignment
          alignment = "right";
          if (isAI) {
            senderName = "Miryam";
            messageType = "ai"; // Green light background
          } else {
            senderName = "Admin";
            messageType = "admin"; // Blue light background
          }
        }

        // Use stored senderType if available and valid, otherwise use computed messageType
        let finalMessageType = messageType;
        if (data.senderType) {
          if (data.senderType === "incoming") {
            finalMessageType = "customer";
          } else if (data.senderType === "ai") {
            finalMessageType = "ai";
          } else if (data.senderType === "admin") {
            finalMessageType = "admin";
          } else {
            finalMessageType = data.senderType;
          }
        }

        return {
          id: doc.id,
          ...data,
          timestamp: timestamp,
          isAI: isAI,
          senderName: senderName,
          messageType: finalMessageType, // 'customer' (left, white), 'ai' (right, green), 'admin' (right, blue)
          alignment: alignment, // 'left' for incoming, 'right' for outgoing
          direction: data.direction, // Preserve original direction
          sender: finalMessageType, // Frontend expects this field for styling
        };
      });

      // Sort in memory by timestamp (ascending - oldest first)
      // Note: We fetched in DESC order for pagination, but display in ASC order
      const sortedMessages = messages.reverse();

      // Calculate pagination info
      const hasMore = messagesSnapshot.docs.length === limit;
      const total = sortedMessages.length; // This is just the current page count

      console.log(
        `✅ Found ${sortedMessages.length} messages for conversation (hasMore: ${hasMore})`
      );

      return {
        messages: sortedMessages,
        hasMore,
        total,
        limit,
        offset,
      };
    } catch (error) {
      console.error("❌ Error getting messages:", error);
      return {
        messages: [],
        hasMore: false,
        total: 0,
        limit: options.limit || 50,
        offset: options.offset || 0,
      };
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
   * Get lead name by lead ID
   */
  async getLeadName(leadId) {
    try {
      if (!leadId) {
        return null;
      }

      console.log(`🔍 Fetching lead name for ID: ${leadId}`);

      const leadDoc = await this.db.collection("leads").doc(leadId).get();

      if (leadDoc.exists) {
        const leadData = leadDoc.data();
        const leadName = leadData.name;
        console.log(`✅ Found lead name: ${leadName} for ID: ${leadId}`);
        return leadName;
      }

      console.log(`❌ No lead found for ID: ${leadId}`);
      return null;
    } catch (error) {
      console.error("❌ Error fetching lead:", error);
      return null;
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

  /**
   * Update lead status in conversation for faster filtering
   */
  async updateConversationLeadStatus(phoneNumber, leadId, leadStatus) {
    try {
      console.log(
        `🔄 Updating conversation lead status: ${phoneNumber} -> ${leadStatus}`
      );

      const conversationId = await this.findConversationByPhone(phoneNumber);
      if (!conversationId) {
        console.log(`⚠️ No conversation found for ${phoneNumber}`);
        return false;
      }

      await this.db.collection("conversations").doc(conversationId).update({
        leadStatus: leadStatus,
        leadId: leadId,
        updatedAt: new Date(),
      });

      console.log(
        `✅ Updated conversation ${conversationId} with lead status: ${leadStatus}`
      );
      return true;
    } catch (error) {
      console.error("❌ Error updating conversation lead status:", error);
      return false;
    }
  }

  /**
   * Bulk update lead statuses for multiple conversations
   */
  async bulkUpdateLeadStatuses(phoneToStatusMap) {
    try {
      console.log(
        `🔄 Bulk updating ${
          Object.keys(phoneToStatusMap).length
        } conversation lead statuses`
      );

      const batch = this.db.batch();
      let updateCount = 0;

      for (const [phoneNumber, { leadId, leadStatus }] of Object.entries(
        phoneToStatusMap
      )) {
        const conversationId = await this.findConversationByPhone(phoneNumber);
        if (conversationId) {
          const conversationRef = this.db
            .collection("conversations")
            .doc(conversationId);
          batch.update(conversationRef, {
            leadStatus: leadStatus,
            leadId: leadId,
            updatedAt: new Date(),
          });
          updateCount++;
        }
      }

      if (updateCount > 0) {
        await batch.commit();
        console.log(
          `✅ Bulk updated ${updateCount} conversation lead statuses`
        );
      }

      return updateCount;
    } catch (error) {
      console.error(
        "❌ Error bulk updating conversation lead statuses:",
        error
      );
      return 0;
    }
  }
}

module.exports = ConversationService;
