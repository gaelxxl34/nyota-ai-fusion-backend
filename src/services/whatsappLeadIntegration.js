/**
 * WhatsApp Lead Integration
 * Connects WhatsApp messages with lead management
 */

const { LEAD_STATUSES, LEAD_SOURCES } = require("../config/lead.constants");

class WhatsAppLeadIntegration {
  constructor(leadService, db) {
    this.leadService = leadService;
    this.db = db;
  }

  /**
   * Process incoming WhatsApp message and create/update lead
   */
  async processIncomingMessage(messageData) {
    try {
      const { phoneNumber, messageContent, profileName } = messageData;

      // Try to find existing lead
      let lead = await this.leadService.findLeadByPhone(phoneNumber);

      if (!lead) {
        // Create new lead from WhatsApp contact
        console.log(`📝 Creating new lead from WhatsApp: ${phoneNumber}`);

        lead = await this.leadService.createLead(
          {
            name: profileName || "WhatsApp User",
            phone: phoneNumber,
            whatsappNumber: phoneNumber,
          },
          LEAD_SOURCES.WHATSAPP
        );
      }

      // Add interaction to timeline
      await this.leadService.addInteraction(lead.id, {
        type: "WHATSAPP",
        content: messageContent,
        channel: "WHATSAPP",
        automated: false,
        direction: "incoming",
        messageId: messageData.messageId,
        timestamp: messageData.timestamp,
        metadata: {
          profileName: profileName,
          messageType: messageData.type || "text",
          isBusinessMessage: messageData.isBusinessMessage || false,
          whatsappMessageId: messageData.messageId,
        },
      });

      // Update engagement based on message
      await this.updateEngagementBasedOnMessage(lead.id, messageContent);

      console.log(`📱 WhatsApp message processed for lead: ${lead.id}`);
      return lead;
    } catch (error) {
      console.error("❌ Error processing WhatsApp message for lead:", error);
      throw error;
    }
  }

  /**
   * Update lead engagement based on message content
   */
  async updateEngagementBasedOnMessage(leadId, messageContent) {
    try {
      const lead = await this.leadService.getLeadById(leadId);
      if (!lead) return;

      // Get interactions from timeline
      const whatsappInteractions = (lead.timeline || []).filter(
        (entry) =>
          entry.action === "INTERACTION" &&
          entry.metadata?.type === "WHATSAPP" &&
          !entry.metadata?.automated &&
          entry.metadata?.direction === "incoming"
      );

      const message = messageContent.toLowerCase();
      let statusUpdate = null;
      let notes = "";

      // Update status based on content and interaction count
      if (
        lead.status === LEAD_STATUSES.INQUIRY &&
        whatsappInteractions.length >= 3
      ) {
        if (this.isApplicationInquiry(message)) {
          statusUpdate = LEAD_STATUSES.PRE_QUALIFIED;
          notes = "Auto-qualified: Showed interest in application process";
        } else if (this.isProgramInquiry(message)) {
          statusUpdate = LEAD_STATUSES.PRE_QUALIFIED;
          notes = "Auto-qualified: Asked about specific programs";
        } else if (this.isFeesInquiry(message)) {
          statusUpdate = LEAD_STATUSES.PRE_QUALIFIED;
          notes = "Auto-qualified: Inquired about fees/tuition";
        }
      }

      // Update status if needed
      if (statusUpdate && lead.status !== statusUpdate) {
        await this.leadService.updateLeadStatus(
          leadId,
          statusUpdate,
          notes,
          "SYSTEM"
        );
        console.log(`📊 Lead ${leadId} auto-qualified to ${statusUpdate}`);
      }

      // Set follow-up if no recent follow-up
      if (
        !lead.nextFollowUpDate ||
        new Date(lead.nextFollowUpDate) < new Date()
      ) {
        const followUpDate = new Date();
        followUpDate.setHours(followUpDate.getHours() + 2); // 2 hours follow-up

        await this.leadService.setFollowUpDate(leadId, followUpDate);
      }
    } catch (error) {
      console.error("❌ Error updating lead engagement:", error);
    }
  }

  /**
   * Check if message indicates application interest
   */
  isApplicationInquiry(message) {
    const keywords = [
      "apply",
      "application",
      "admission",
      "enroll",
      "register",
      "how to apply",
      "application form",
      "requirements",
    ];
    return keywords.some((keyword) => message.includes(keyword));
  }

  /**
   * Check if message is about programs
   */
  isProgramInquiry(message) {
    const keywords = [
      "program",
      "course",
      "degree",
      "bachelor",
      "master",
      "mba",
      "information technology",
      "business",
      "engineering",
      "mit",
      "bit",
    ];
    return keywords.some((keyword) => message.includes(keyword));
  }

  /**
   * Check if message is about fees
   */
  isFeesInquiry(message) {
    const keywords = [
      "fee",
      "cost",
      "price",
      "tuition",
      "money",
      "payment",
      "how much",
      "expensive",
      "affordable",
    ];
    return keywords.some((keyword) => message.includes(keyword));
  }

  /**
   * Handle AI response sent to lead
   */
  async handleAIResponse(phoneNumber, aiResponse) {
    try {
      const lead = await this.leadService.findLeadByPhone(phoneNumber);

      if (lead) {
        await this.leadService.addInteraction(lead.id, {
          type: "AI_RESPONSE",
          content: aiResponse,
          channel: "WHATSAPP",
          automated: true,
        });

        console.log(`🤖 AI response logged for lead: ${lead.id}`);
      }
    } catch (error) {
      console.error("❌ Error handling AI response for lead:", error);
    }
  }

  /**
   * Get lead context for AI (recent interactions and status)
   */
  async getLeadContextForAI(phoneNumber) {
    try {
      const lead = await this.leadService.findLeadByPhone(phoneNumber);

      if (!lead) {
        return null;
      }

      // Get recent timeline entries
      const recentTimeline = (lead.timeline || [])
        .slice(-5) // Last 5 entries
        .map((entry) => ({
          date: entry.date,
          action: entry.action,
          notes: entry.notes,
        }));

      // Count WhatsApp interactions
      const whatsappInteractions = (lead.timeline || []).filter(
        (entry) =>
          entry.action === "INTERACTION" &&
          entry.metadata?.type === "WHATSAPP" &&
          !entry.metadata?.automated
      ).length;

      return {
        leadId: lead.id,
        status: lead.status,
        recentTimeline,
        isNewLead: whatsappInteractions <= 1,
      };
    } catch (error) {
      console.error("❌ Error getting lead context for AI:", error);
      return null;
    }
  }

  /**
   * Recheck qualifications for existing leads
   * This method should be called periodically to ensure leads are properly qualified
   */
  async recheckLeadQualifications() {
    try {
      console.log("🔄 Starting periodic lead qualification check...");

      // Get all leads in INQUIRY status
      const leads = await this.leadService.findLeadsByStatus(
        LEAD_STATUSES.INQUIRY
      );
      let updatedCount = 0;

      for (const lead of leads) {
        console.log(`Checking lead: ${lead.id}`);

        // Get interactions from timeline
        const whatsappInteractions = (lead.timeline || []).filter(
          (entry) =>
            entry.action === "INTERACTION" &&
            entry.metadata?.type === "WHATSAPP" &&
            !entry.metadata?.automated &&
            entry.metadata?.direction === "incoming"
        );

        // If we have enough interactions, check content
        if (whatsappInteractions.length >= 3) {
          // Check if any messages indicate specific interests
          const hasQualifyingContent = whatsappInteractions.some(
            (entry) =>
              this.isApplicationInquiry(entry.content || "") ||
              this.isProgramInquiry(entry.content || "") ||
              this.isFeesInquiry(entry.content || "")
          );

          // Update status if qualifying content found
          if (hasQualifyingContent) {
            await this.leadService.updateLeadStatus(
              lead.id,
              LEAD_STATUSES.PRE_QUALIFIED,
              "Auto-qualified based on WhatsApp interaction history",
              "SYSTEM"
            );
            updatedCount++;
            console.log(
              `📈 Updated lead ${lead.id} to PRE_QUALIFIED based on message history`
            );
          }
        }
      }

      console.log(
        `✅ Lead qualification check completed. Updated ${updatedCount} leads.`
      );
      return updatedCount;
    } catch (error) {
      console.error("❌ Error in periodic lead qualification check:", error);
      throw error;
    }
  }
}

module.exports = WhatsAppLeadIntegration;
