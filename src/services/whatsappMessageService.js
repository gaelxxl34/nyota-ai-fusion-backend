/**
 * WhatsApp Message Service
 * Handles WhatsApp message processing, AI responses, and broadcasting
 */

const { getFirestore } = require("firebase-admin/firestore");
const aiService = require("./ai.service");
const ConversationService = require("./conversationService");
const { broadcastMessage } = require("./broadcastService");
const WhatsAppLeadIntegration = require("./whatsappLeadIntegration");
const LeadService = require("./leadService");

class WhatsAppMessageService {
  /**
   * Send a WhatsApp template message using the Cloud API
   * @param {string} phoneNumber - Recipient phone number (international format, no +)
   * @param {object} templatePayload - The template message payload (see WhatsApp Cloud API docs)
   * @param {object} metadata - Additional metadata (leadId, applicationId, etc.)
   * @returns {Promise<object>} - { success, messageId, error, conversationId }
   */
  async sendTemplateMessage(phoneNumber, templatePayload, metadata = {}) {
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

    // Check if this is a validation message
    const isValidationMessage =
      metadata?.validationType === "initial_validation" ||
      templatePayload.template?.name === "whatsapp_validation";

    // Check if this is an application received message
    const isApplicationReceivedMessage =
      templatePayload.template?.name === "application_received";

    // Check if this is a status update message
    const isStatusUpdateMessage =
      metadata?.statusUpdate === true ||
      [
        "application_in_review",
        "application_qualified",
        "application_admitted",
        "application_deferred",
      ].includes(templatePayload.template?.name);

    try {
      // Extract template information for logging
      const templateName = templatePayload.template?.name || "unknown_template";
      const templateLanguage =
        templatePayload.template?.language?.code || "en_US";
      console.log(`📱 Sending template "${templateName}" to ${phoneNumber}`);

      // Send message to WhatsApp API
      const response = await axios.post(url, templatePayload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });

      // WhatsApp API returns messageId in response.data.messages[0].id
      const messageId = response.data?.messages?.[0]?.id;

      // If we have a message ID, handle the message
      if (messageId) {
        // For validation messages, we'll handle them differently but still create conversation
        if (isValidationMessage) {
          console.log(
            `📱 Processing validation template message ${messageId} for phone ${phoneNumber} - creating conversation`
          );

          // Store validation message info
          this.validationMessages.set(messageId, {
            phoneNumber: phoneNumber,
            timestamp: new Date(),
            metadata: metadata || {},
            templateName: templateName,
            templateLanguage: templateLanguage,
            status: "sent",
          });

          try {
            // Extract leadId from metadata or try to find existing lead
            let leadId = metadata?.leadId;

            // If no leadId provided but we have a phone number, try to find the lead
            if (!leadId && phoneNumber) {
              try {
                // Validate that required services are available
                if (
                  !this.leadService ||
                  typeof this.leadService.findLeadByPhone !== "function"
                ) {
                  console.log(
                    "Lead service not available for validation message"
                  );
                } else {
                  const normalizedPhone = phoneNumber.replace(/[^\d+]/g, "");
                  const phoneWithoutPlus = phoneNumber.replace(/[^\d]/g, "");

                  // Try to find lead by phone number
                  const existingLead =
                    (await this.leadService.findLeadByPhone(normalizedPhone)) ||
                    (await this.leadService.findLeadByPhone(
                      phoneWithoutPlus
                    )) ||
                    (await this.leadService.findLeadByPhone(
                      `+${phoneWithoutPlus}`
                    ));

                  if (existingLead) {
                    leadId = existingLead.id;
                    console.log(
                      `📱 Found lead ${leadId} for validation template to ${phoneNumber}`
                    );
                  }
                }
              } catch (leadLookupError) {
                console.warn(
                  `⚠️ Error finding lead for validation template: ${leadLookupError.message}`
                );
              }
            }

            // Create or get conversation for validation template
            const conversationId =
              await this.conversationService.createOrGetConversation(
                phoneNumber,
                leadId,
                metadata?.contactName || null
              );

            // Define the welcome message content that should be stored
            const welcomeMessageContent = `Hello👋

Thank you for your interest in IUEA! 🎓
We've received your message and we're here to help.😊

Is there a specific program you're interested in, or would you like some help with the admission process?`;

            // Store the welcome message in our database (this represents what the user sees)
            const messageDoc = {
              messageId: messageId,
              conversationId: conversationId,
              from: process.env.WHATSAPP_PHONE_NUMBER_ID,
              to: phoneNumber,
              content: welcomeMessageContent,
              messageType: "template",
              templateName: templateName,
              templateLanguage: templateLanguage,
              senderType: "outgoing",
              direction: "outgoing",
              timestamp: new Date(),
              status: "sent",
              metadata: metadata || {},
              createdAt: new Date(),
            };

            // Add to messages collection
            const messageRef = await this.db
              .collection("messages")
              .add(messageDoc);

            // Update conversation with latest message
            await this.db
              .collection("conversations")
              .doc(conversationId)
              .update({
                lastMessage: "Hello👋 Thank you for your interest in IUEA! 🎓",
                lastMessageTime: new Date(),
                lastMessageFrom: "business",
                updatedAt: new Date(),
              });

            console.log(
              `💾 Validation template message ${messageId} saved to conversation ${conversationId} with welcome content`
            );

            return {
              success: true,
              messageId,
              conversationId,
              savedMessageId: messageRef.id,
              isValidation: true,
            };
          } catch (error) {
            console.error(
              `❌ Error storing validation template message: ${error.message}`
            );
            // Return success since the WhatsApp API call worked, but note the storage error
            return {
              success: true,
              messageId,
              isValidation: true,
              error: `Message sent but not saved: ${error.message}`,
            };
          }
        }

        // For application received messages, create conversation and store application confirmation message
        if (isApplicationReceivedMessage) {
          console.log(
            `📱 Processing application received template message ${messageId} for phone ${phoneNumber} - creating conversation`
          );

          // Store application message info
          this.validationMessages.set(messageId, {
            phoneNumber: phoneNumber,
            timestamp: new Date(),
            metadata: metadata || {},
            templateName: templateName,
            templateLanguage: templateLanguage,
            status: "sent",
          });

          try {
            // Extract leadId from metadata or try to find existing lead
            let leadId = metadata?.leadId;

            // If no leadId provided but we have a phone number, try to find the lead
            if (!leadId && phoneNumber) {
              try {
                // Validate that required services are available
                if (
                  !this.leadService ||
                  typeof this.leadService.findLeadByPhone !== "function"
                ) {
                  console.log(
                    "Lead service not available for application received message"
                  );
                } else {
                  const normalizedPhone = phoneNumber.replace(/[^\d+]/g, "");
                  const phoneWithoutPlus = phoneNumber.replace(/[^\d]/g, "");

                  // Try to find lead by phone number
                  const existingLead =
                    (await this.leadService.findLeadByPhone(normalizedPhone)) ||
                    (await this.leadService.findLeadByPhone(
                      phoneWithoutPlus
                    )) ||
                    (await this.leadService.findLeadByPhone(
                      `+${phoneWithoutPlus}`
                    ));

                  if (existingLead) {
                    leadId = existingLead.id;
                    console.log(
                      `📱 Found lead ${leadId} for application received template to ${phoneNumber}`
                    );
                  }
                }
              } catch (leadLookupError) {
                console.warn(
                  `⚠️ Error finding lead for application received template: ${leadLookupError.message}`
                );
              }
            }

            // Create or get conversation for application received template
            const conversationId =
              await this.conversationService.createOrGetConversation(
                phoneNumber,
                leadId,
                metadata?.contactName || null
              );

            // Define the application confirmation message content that should be stored
            const applicationConfirmationContent = `Hello 👋
Thank you for applying to IUEA! 🎓
We've received your application and we're excited to have you take this big step toward your academic journey with us. ✅
Our admissions team is currently reviewing your application, and we'll be in touch shortly with the next steps. In the meantime, if you have any questions or need assistance, let me know how I can support you. 😊
Welcome to the IUEA family! 🌍✨`;

            // Store the application confirmation message in our database (this represents what the user sees)
            const messageDoc = {
              messageId: messageId,
              conversationId: conversationId,
              from: process.env.WHATSAPP_PHONE_NUMBER_ID,
              to: phoneNumber,
              content: applicationConfirmationContent,
              messageType: "template",
              templateName: templateName,
              templateLanguage: templateLanguage,
              senderType: "outgoing",
              direction: "outgoing",
              timestamp: new Date(),
              status: "sent",
              metadata: metadata || {},
              createdAt: new Date(),
            };

            // Add to messages collection
            const messageRef = await this.db
              .collection("messages")
              .add(messageDoc);

            // Update conversation with latest message
            await this.db
              .collection("conversations")
              .doc(conversationId)
              .update({
                lastMessage: "Hello 👋 Thank you for applying to IUEA! 🎓",
                lastMessageTime: new Date(),
                lastMessageFrom: "business",
                updatedAt: new Date(),
              });

            console.log(
              `💾 Application received template message ${messageId} saved to conversation ${conversationId} with confirmation content`
            );

            return {
              success: true,
              messageId,
              conversationId,
              savedMessageId: messageRef.id,
              isApplicationReceived: true,
            };
          } catch (error) {
            console.error(
              `❌ Error storing application received template message: ${error.message}`
            );
            // Return success since the WhatsApp API call worked, but note the storage error
            return {
              success: true,
              messageId,
              isApplicationReceived: true,
              error: `Message sent but not saved: ${error.message}`,
            };
          }
        }

        // For status update messages, create conversation and store status update content
        if (isStatusUpdateMessage) {
          console.log(
            `📱 Processing status update template message ${messageId} for phone ${phoneNumber}`
          );

          try {
            // Extract leadId from metadata or try to find existing lead
            let leadId = metadata?.leadId;

            if (!leadId && phoneNumber) {
              try {
                const normalizedPhone = phoneNumber.replace(/[^\d+]/g, "");
                const phoneWithoutPlus = phoneNumber.replace(/[^\d]/g, "");

                const existingLead =
                  (await this.leadService.findLeadByPhone(normalizedPhone)) ||
                  (await this.leadService.findLeadByPhone(phoneWithoutPlus)) ||
                  (await this.leadService.findLeadByPhone(
                    `+${phoneWithoutPlus}`
                  ));

                if (existingLead) {
                  leadId = existingLead.id;
                  console.log(
                    `📱 Found lead ${leadId} for status update template to ${phoneNumber}`
                  );
                }
              } catch (leadLookupError) {
                console.warn(
                  `⚠️ Error finding lead for status update template: ${leadLookupError.message}`
                );
              }
            }

            // Create or get conversation for status update template
            const conversationId =
              await this.conversationService.createOrGetConversation(
                phoneNumber,
                leadId,
                metadata?.contactName || null
              );

            // Define status update message content based on template
            const statusMessages = {
              application_in_review: `Hello 👋
Your application is currently under review 📑
Our admissions team is carefully checking your details and documents.
👉 Visit your portal anytime for updates: https://applicant.iuea.ac.ug/`,
              application_qualified: `Great news🎉
Your application has met all requirements, and you are qualified for admission.
👉 Check your portal now for the next steps: https://applicant.iuea.ac.ug/`,
              application_admitted: `Congratulations 🎓🎉
You've been officially admitted to IUEA!
👉 Download your admission letter and complete enrollment here: https://applicant.iuea.ac.ug/
Welcome to the IUEA family 🌍`,
              application_deferred: `Hello 👋
Your application has been deferred to a later intake ⏳
This means your admission process is postponed for now.
👉 Stay updated by checking your portal: https://applicant.iuea.ac.ug/`,
            };

            const statusUpdateContent =
              statusMessages[templateName] || `Status update: ${templateName}`;

            // Store the status update message in our database
            const messageDoc = {
              messageId: messageId,
              conversationId: conversationId,
              from: process.env.WHATSAPP_PHONE_NUMBER_ID,
              to: phoneNumber,
              content: statusUpdateContent,
              messageType: "template",
              templateName: templateName,
              templateLanguage: templateLanguage,
              senderType: "outgoing",
              direction: "outgoing",
              timestamp: new Date(),
              status: "sent",
              metadata: metadata || {},
              createdAt: new Date(),
              isStatusUpdate: true,
              applicationStatus: metadata?.status || "unknown",
            };

            // Add to messages collection
            const messageRef = await this.db
              .collection("messages")
              .add(messageDoc);

            // Update conversation with latest message
            await this.db
              .collection("conversations")
              .doc(conversationId)
              .update({
                lastMessage: statusUpdateContent.split("\n")[0], // First line as preview
                lastMessageTime: new Date(),
                lastMessageFrom: "business",
                updatedAt: new Date(),
              });

            console.log(
              `💾 Status update template message ${messageId} saved to conversation ${conversationId}`
            );

            return {
              success: true,
              messageId,
              conversationId,
              savedMessageId: messageRef.id,
              isStatusUpdate: true,
              templateName: templateName,
              applicationStatus: metadata?.status,
            };
          } catch (error) {
            console.error(
              `❌ Error storing status update template message: ${error.message}`
            );
            // Return success since the WhatsApp API call worked, but note the storage error
            return {
              success: true,
              messageId,
              isStatusUpdate: true,
              error: `Message sent but not saved: ${error.message}`,
            };
          }
        }

        try {
          // For non-validation messages, process normally
          // Extract leadId from metadata or look it up if needed
          let leadId = metadata?.leadId;

          // If no leadId provided but we have a phone number, try to find the lead
          if (!leadId && phoneNumber) {
            try {
              // Validate that required services are available
              if (
                !this.leadService ||
                typeof this.leadService.findLeadByPhone !== "function"
              ) {
                throw new Error("Lead service not properly initialized");
              }

              const normalizedPhone = phoneNumber.replace(/[^\d+]/g, "");
              const phoneWithoutPlus = phoneNumber.replace(/[^\d]/g, "");

              console.log(
                `🔍 Searching for lead with phone formats: ${normalizedPhone}, ${phoneWithoutPlus}, +${phoneWithoutPlus}, ${phoneNumber}`
              );

              // Try to find lead by phone number
              const existingLead =
                (await this.leadService.findLeadByPhone(normalizedPhone)) ||
                (await this.leadService.findLeadByPhone(phoneWithoutPlus)) ||
                (await this.leadService.findLeadByPhone(
                  `+${phoneWithoutPlus}`
                ));

              if (existingLead) {
                leadId = existingLead.id;
                console.log(
                  `📱 Found lead ${leadId} for template message to ${phoneNumber}`
                );
              } else {
                console.log(
                  `⚠️ No existing lead found for phone ${phoneNumber}`
                );
              }
            } catch (leadLookupError) {
              console.warn(
                `⚠️ Error finding lead for template message: ${leadLookupError.message}`
              );
            }
          }

          // Create or get conversation, linking it to the lead if possible
          const conversationId =
            await this.conversationService.createOrGetConversation(
              phoneNumber,
              leadId,
              metadata?.contactName || null
            );

          // Prepare a readable version of the template for storing
          const templateContent = `Template: ${templateName} (${templateLanguage})`;
          const components = templatePayload.template?.components || [];

          // Store the message in our database
          const messageDoc = {
            messageId: messageId,
            conversationId: conversationId,
            from: process.env.WHATSAPP_PHONE_NUMBER_ID,
            to: phoneNumber,
            content: templateContent,
            messageType: "template",
            templateName: templateName,
            templateLanguage: templateLanguage,
            senderType: "outgoing",
            direction: "outgoing",
            timestamp: new Date(),
            status: "sent",
            metadata: metadata || {},
            createdAt: new Date(),
          };

          // Add to messages collection
          const messageRef = await this.db
            .collection("messages")
            .add(messageDoc);

          // Update conversation with latest message
          await this.db.collection("conversations").doc(conversationId).update({
            lastMessage: templateContent,
            lastMessageTime: new Date(),
            lastMessageFrom: "business",
            updatedAt: new Date(),
          });

          console.log(
            `💾 Template message ${messageId} saved to conversation ${conversationId}`
          );

          return {
            success: true,
            messageId,
            conversationId,
            savedMessageId: messageRef.id,
          };
        } catch (error) {
          console.error(`❌ Error storing template message: ${error.message}`);
          // We still return success since the WhatsApp API call worked
          return {
            success: true,
            messageId,
            error: `Message sent but not saved: ${error.message}`,
          };
        }
      }

      return { success: true, messageId };
    } catch (error) {
      let errMsg = error.response?.data?.error?.message || error.message;
      console.error(`❌ Error sending template message: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }
  constructor(firestore, leadService, conversationService) {
    // Accept dependencies via constructor to avoid circular dependencies
    this.db = firestore || getFirestore();
    this.leadService = leadService || new LeadService(this.db);
    this.conversationService =
      conversationService || new ConversationService(this.db);
    this.leadIntegration = new WhatsAppLeadIntegration(
      this.leadService,
      this.db
    );

    // Store validation message IDs for tracking without creating conversations
    this.validationMessages = new Map(); // messageId -> {phone, timestamp, metadata}
  }

  /**
   * Link a previously created conversation (during validation) to a newly created lead
   * @param {string} phoneNumber - The phone number used for validation
   * @param {string} leadId - The newly created lead ID to link to the conversation
   * @returns {Promise<boolean>} - Success status
   */
  async updateConversationWithLead(phoneNumber, leadId) {
    try {
      if (!phoneNumber || !leadId) {
        console.warn(`⚠️ Cannot update conversation: missing phone or leadId`);
        return false;
      }

      // Normalize the phone number
      const normalizedPhone = phoneNumber.replace(/[^\d+]/g, "");

      // First check if we have a stored validation conversation
      let conversationId =
        this.validationMessages.get(normalizedPhone)?.messageId;

      // If not found in the map, try to find it in the database
      if (!conversationId) {
        console.log(
          `🔍 Looking up conversation for ${normalizedPhone} in database`
        );
        conversationId = await this.conversationService.findConversationByPhone(
          normalizedPhone
        );
      }

      if (!conversationId) {
        console.log(
          `⚠️ No conversation found for ${normalizedPhone}, creating a new one`
        );

        // Create a new conversation since one doesn't exist
        try {
          // Try to get the lead info to use the contact name
          let contactName = null;
          try {
            const leadDoc = await this.db.collection("leads").doc(leadId).get();
            if (leadDoc.exists) {
              const leadData = leadDoc.data();
              contactName = leadData.name || leadData.firstName || null;
            }
          } catch (err) {
            console.warn(`⚠️ Could not get lead name: ${err.message}`);
          }

          // Create conversation with the lead ID
          conversationId =
            await this.conversationService.createOrGetConversation(
              normalizedPhone,
              leadId,
              contactName
            );

          console.log(
            `✅ Created new conversation ${conversationId} for lead ${leadId}`
          );
          return true;
        } catch (createError) {
          console.error(
            `❌ Error creating conversation: ${createError.message}`
          );
          return false;
        }
      }

      console.log(
        `🔄 Updating conversation ${conversationId} with lead ID ${leadId}`
      );

      // Update the conversation with the lead ID
      await this.db.collection("conversations").doc(conversationId).update({
        leadId: leadId,
        updatedAt: new Date(),
      });

      console.log(
        `✅ Successfully linked conversation ${conversationId} to lead ${leadId}`
      );

      // Remove from the map after successful update
      this.validationMessages.delete(normalizedPhone);

      return true;
    } catch (error) {
      console.error(
        `❌ Error updating conversation with lead: ${error.message}`
      );
      return false;
    }
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
        email, // Email might be included if extracted from conversation
      } = messageData;

      // Store message in database
      const messageDbId = await this.storeIncomingMessage(messageData);
      console.log(`💾 Stored incoming message with ID: ${messageDbId}`);

      // Process lead integration (find existing lead but don't create new ones)
      // This will only update the lead if one already exists
      const existingLead = await this.leadIntegration.processIncomingMessage({
        messageId,
        phoneNumber,
        messageContent,
        profileName,
        email, // Pass email if available
        messageType,
        timestamp: new Date().toISOString(),
      });

      if (existingLead) {
        console.log(
          `✅ Message associated with existing lead: ${existingLead.id}`
        );
      } else {
        console.log(`ℹ️ Message stored in conversation only (no lead created)`);
      }

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
   * Handle AI auto-reply logic with enhanced context
   */
  async handleAIAutoReply(phoneNumber, messageContent, profileName) {
    console.log("🤖 AI Auto-Reply is enabled, generating response...");

    try {
      // Start typing indicator
      this.broadcastAITyping(phoneNumber, profileName, true);

      // Fetch recent messages for context with enhanced analysis
      const recentMessages =
        await this.conversationService.getRecentMessagesForContext(
          phoneNumber,
          10
        );
      console.log(
        `📚 Got ${recentMessages.length} recent messages for AI context`
      );

      // Debug: Log the conversation history structure
      if (recentMessages.length > 0) {
        console.log(`🔍 Sample message structure:`, {
          hasMessage: !!recentMessages[0].message,
          hasSenderName: !!recentMessages[0].sender_name,
          hasIsFromUser: typeof recentMessages[0].is_from_user !== "undefined",
          hasAnalysis: !!recentMessages.conversationAnalysis,
          sample: recentMessages[0],
        });
      }

      // Get comprehensive user context
      const userContext = await this.getUserContext(phoneNumber);
      console.log(`👤 User context for ${phoneNumber}:`, {
        leadStatus: userContext.leadStatus,
        hasApplications: userContext.applications?.length > 0,
        conversationStage:
          recentMessages.conversationAnalysis?.conversationFlow,
        discussedTopics: recentMessages.conversationAnalysis?.discussedTopics,
      });

      // Generate AI response with enhanced context
      const aiResponse = await aiService.generateResponse(
        messageContent,
        recentMessages, // Enhanced conversation history with analysis
        userContext.leadStatus, // Lead status for application awareness
        userContext // Additional user context
      );

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
   * Get comprehensive user context for AI decision making
   */
  async getUserContext(phoneNumber) {
    try {
      const context = {
        leadStatus: null,
        applications: [],
        conversationHistory: [],
        lastInteraction: null,
        engagementLevel: "new", // new, engaged, returning
        preferences: {},
      };

      // Get lead status
      context.leadStatus = await this.getLeadStatus(phoneNumber);

      // Get application information if lead exists
      if (context.leadStatus) {
        try {
          const normalizedPhone = phoneNumber
            .replace(/[^\d]/g, "")
            .replace(/^0+/, "");

          const axios = require("axios");

          // Get applications for this phone number
          const applicationsResponse = await axios.get(
            `${
              process.env.BACKEND_URL || "http://localhost:3000"
            }/api/applications/phone/${normalizedPhone}`,
            { timeout: 3000 }
          );

          if (applicationsResponse.data.success) {
            context.applications = applicationsResponse.data.applications || [];
            console.log(
              `📋 Found ${context.applications.length} applications for ${phoneNumber}`
            );
          }
        } catch (appError) {
          console.log(`⚠️ Could not fetch applications: ${appError.message}`);
        }
      }

      // Determine engagement level based on conversation history
      const conversationId =
        await this.conversationService.findConversationByPhone(phoneNumber);
      if (conversationId) {
        try {
          const conversationDoc = await this.db
            .collection("conversations")
            .doc(conversationId)
            .get();
          if (conversationDoc.exists) {
            const conversationData = conversationDoc.data();
            context.lastInteraction = conversationData.lastMessageTime;
            context.messageCount = conversationData.messageCount || 0;

            // Determine engagement level
            if (context.messageCount > 10) {
              context.engagementLevel = "highly_engaged";
            } else if (context.messageCount > 3) {
              context.engagementLevel = "engaged";
            } else if (
              context.lastInteraction &&
              Date.now() - new Date(context.lastInteraction).getTime() >
                86400000
            ) {
              // 24 hours
              context.engagementLevel = "returning";
            }
          }
        } catch (convError) {
          console.log(
            `⚠️ Could not fetch conversation details: ${convError.message}`
          );
        }
      }

      return context;
    } catch (error) {
      console.error("❌ Error getting user context:", error);
      return {
        leadStatus: null,
        applications: [],
        engagementLevel: "new",
      };
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

      // Check if this is a validation message that we're tracking
      const isValidationMessage = this.validationMessages.has(messageId);

      if (isValidationMessage) {
        console.log(
          `📱 Status update for validation message ${messageId}: ${statusType}`
        );

        // Update status in our tracking map
        const validationData = this.validationMessages.get(messageId);
        validationData.status = statusType;
        validationData.statusTimestamp = timestamp;

        if (errors.length > 0) {
          validationData.error = {
            code: errors[0]?.code,
            title: errors[0]?.title || "Unknown error",
            details: errors[0]?.error_data?.details || "",
          };
        }

        this.validationMessages.set(messageId, validationData);

        // Handle validation failure
        if (statusType === "failed" && recipientId && errors.length > 0) {
          const errorCode = errors[0]?.code;
          const errorTitle = errors[0]?.title || "Unknown error";
          const errorDetails = errors[0]?.error_data?.details || "";

          console.log(
            `❌ WhatsApp validation failed for ${recipientId} - Error ${errorCode}: ${errorTitle} (${errorDetails})`
          );

          // Broadcast validation failure
          broadcastMessage(
            {
              messageId: messageId,
              phoneNumber: validationData.phoneNumber,
              status: "validation_failed",
              error: {
                code: errorCode,
                title: errorTitle,
                details: errorDetails,
              },
              timestamp: timestamp,
            },
            "validation_status"
          );
        } else if (statusType === "delivered" && recipientId) {
          console.log(
            `✅ WhatsApp validation successful for ${recipientId} - Message delivered`
          );

          // Broadcast validation success
          broadcastMessage(
            {
              messageId: messageId,
              phoneNumber: validationData.phoneNumber,
              status: "validation_success",
              timestamp: timestamp,
            },
            "validation_status"
          );

          // AUTOMATIC CONVERSATION CREATION:
          // Create conversation automatically when validation message is delivered
          // This ensures we always have a conversation for each validated number
          try {
            console.log(
              `📞 Validation successful for ${recipientId}: ${statusType}`
            );

            // Create conversation for the validated number
            const conversationResult =
              await this.createConversationForValidatedNumber(messageId, {
                contactName: validationData.metadata?.contactName || null,
                source: validationData.metadata?.source || "whatsapp",
                // leadId will be linked later when lead is created
              });

            if (conversationResult.success) {
              console.log(
                `✅ Automatically created conversation for validated number ${recipientId}`
              );
            } else {
              console.warn(
                `⚠️ Could not automatically create conversation: ${conversationResult.error}`
              );
            }
          } catch (convError) {
            console.error(
              `❌ Error creating conversation for validated number: ${convError.message}`
            );
          }
        }

        // For validation messages, we don't update status in database since there's no entry
      } else {
        // Regular (non-validation) message - update status in database
        await this.conversationService.updateMessageStatus(
          messageId,
          statusType,
          timestamp
        );
      }

      // Always broadcast status update to clients
      broadcastMessage(
        {
          messageId: messageId,
          status: statusType,
          timestamp: timestamp,
          isValidation: isValidationMessage,
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
      // Use template message but with validation flag to avoid database entry
      const templatePayload = {
        messaging_product: "whatsapp",
        to: phoneNumber,
        type: "template",
        template: {
          name: "whatsapp_validation",
          language: { code: "en_US" },
          components: [],
        },
      };

      // Send as validation message (won't create conversation)
      return await this.sendTemplateMessage(phoneNumber, templatePayload, {
        ...metadata,
        validationType: "initial_validation",
      });
    } catch (error) {
      console.error("❌ Error sending validation message:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create conversation for a validated phone number
   * Should be called only after validation message has been confirmed as delivered
   * @param {string} messageId - The ID of the validation message that was delivered
   * @param {object} metadata - Additional data like leadId, contactName
   * @returns {Promise<object>} - { success, conversationId, error }
   */
  async createConversationForValidatedNumber(messageId, metadata = {}) {
    try {
      // Find the validation message in our map
      const validationData = this.validationMessages.get(messageId);

      if (!validationData) {
        console.warn(`⚠️ No validation data found for messageId ${messageId}`);
        return { success: false, error: "Validation message not found" };
      }

      const { phoneNumber, templateName, templateLanguage } = validationData;
      const leadId = metadata.leadId || validationData.metadata?.leadId;
      const contactName =
        metadata.contactName || validationData.metadata?.contactName;

      console.log(
        `✅ Creating conversation for validated number ${phoneNumber} with lead ${leadId}`
      );

      // Create the conversation
      const conversationId =
        await this.conversationService.createOrGetConversation(
          phoneNumber,
          leadId,
          contactName
        );

      // Store the validation message in the conversation
      const templateContent = `Template: ${templateName} (${templateLanguage})`;

      // Store the message in our database
      const messageDoc = {
        messageId: messageId,
        conversationId: conversationId,
        from: process.env.WHATSAPP_PHONE_NUMBER_ID,
        to: phoneNumber,
        content: templateContent,
        messageType: "template",
        templateName: templateName,
        templateLanguage: templateLanguage,
        senderType: "outgoing",
        direction: "outgoing",
        timestamp: validationData.timestamp,
        status: validationData.status,
        metadata: validationData.metadata || {},
        createdAt: new Date(),
      };

      // Add to messages collection
      const messageRef = await this.db.collection("messages").add(messageDoc);

      // Update conversation with latest message
      await this.db.collection("conversations").doc(conversationId).update({
        lastMessage: templateContent,
        lastMessageTime: validationData.timestamp,
        lastMessageFrom: "business",
        updatedAt: new Date(),
      });

      console.log(
        `💾 Validation message ${messageId} saved to new conversation ${conversationId}`
      );

      // Remove from validation messages map
      this.validationMessages.delete(messageId);

      return {
        success: true,
        conversationId,
        messageId,
        savedMessageId: messageRef.id,
        leadId,
      };
    } catch (error) {
      console.error(
        "❌ Error creating conversation for validated number:",
        error
      );
      return { success: false, error: error.message };
    }
  }
}

module.exports = WhatsAppMessageService;
