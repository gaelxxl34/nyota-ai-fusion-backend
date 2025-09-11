#!/usr/bin/env node

/**
 * Script to send welcome email and WhatsApp messages to all leads with "CONTACTED" status
 * Also creates conversations and leads as needed
 * Uses the welcome_to_iuea template for WhatsApp messages
 */

// Load environment variables
require("dotenv").config();

const admin = require("firebase-admin");
const path = require("path");

// Initialize Firebase Admin only if not already initialized
let db;
try {
  // Try to get existing app
  const app = admin.app();
  db = app.firestore();
  console.log("✅ Using existing Firebase Admin app");
} catch (error) {
  // No app exists, create a new one
  try {
    const serviceAccount = require("../../serviceAccountKey.json");
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    db = admin.firestore();
    console.log("✅ Initialized new Firebase Admin app");
  } catch (initError) {
    console.error("❌ Failed to initialize Firebase:", initError.message);
    throw new Error(`Firebase initialization failed: ${initError.message}`);
  }
}

// Import required services
const LeadService = require("../services/leadService");
const ConversationService = require("../services/conversationService");
const emailService = require("../services/emailService");
const WhatsAppMessageService = require("../services/whatsappMessageService");
const FacebookLeadWelcomeService = require("../services/facebookLeadWelcomeService");
const { LEAD_STATUSES } = require("../config/lead.constants");

class ContactedLeadsMessenger {
  constructor(campaignRef = null) {
    this.leadService = new LeadService(db);
    this.conversationService = new ConversationService();
    this.emailService = emailService;
    this.whatsappService = new WhatsAppMessageService();
    this.campaignRef = campaignRef;
    this.results = {
      totalLeads: 0,
      emailsSent: 0,
      emailsFailed: 0,
      whatsappSent: 0,
      whatsappFailed: 0,
      conversationsCreated: 0,
      leadsProcessed: 0, // Changed from leadsUpdated since we don't update status
      leadsSkipped: 0,
      errors: [],
    };
  }

  /**
   * Log a message to campaign if available
   */
  async logToCampaign(type, message, leadId = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type,
      message,
      ...(leadId && { leadId }),
    };

    console.log(`📝 [${type.toUpperCase()}] ${message}`);

    if (this.campaignRef) {
      try {
        await this.campaignRef.update({
          logs: admin.firestore.FieldValue.arrayUnion(logEntry),
        });
      } catch (error) {
        console.error("Failed to log to campaign:", error);
      }
    }
  }

  /**
   * Update campaign progress
   */
  async updateCampaignProgress() {
    if (this.campaignRef) {
      try {
        await this.campaignRef.update({
          "results.totalLeads": this.results.totalLeads,
          "results.emailsSent": this.results.emailsSent,
          "results.emailsFailed": this.results.emailsFailed,
          "results.whatsappSent": this.results.whatsappSent,
          "results.whatsappFailed": this.results.whatsappFailed,
          "results.conversationsCreated": this.results.conversationsCreated,
          "results.leadsProcessed": this.results.leadsProcessed,
          "results.leadsSkipped": this.results.leadsSkipped,
          "results.errors": this.results.errors,
        });
      } catch (error) {
        console.error("Failed to update campaign progress:", error);
      }
    }
  }

  /**
   * Main function to process all contacted leads
   */
  async processContactedLeads() {
    try {
      await this.logToCampaign(
        "info",
        "🚀 Starting process to send welcome messages to contacted leads..."
      );

      // Find all leads with CONTACTED status
      const contactedLeads = await this.leadService.findLeadsByStatus(
        LEAD_STATUSES.CONTACTED
      );
      this.results.totalLeads = contactedLeads.length;

      await this.logToCampaign(
        "info",
        `📊 Found ${contactedLeads.length} leads with CONTACTED status`
      );

      if (contactedLeads.length === 0) {
        await this.logToCampaign(
          "info",
          "ℹ️ No contacted leads found. Exiting..."
        );
        return this.results;
      }

      // Process each lead
      for (let i = 0; i < contactedLeads.length; i++) {
        const lead = contactedLeads[i];
        await this.logToCampaign(
          "info",
          `📋 Processing lead ${i + 1}/${contactedLeads.length}: ${
            lead.name || lead.email || lead.phone
          } (${lead.id})`,
          lead.id
        );

        await this.processLead(lead);
        await this.updateCampaignProgress();

        // Add a small delay between processing leads to avoid rate limiting
        await this.delay(1000);
      }

      this.printSummary();
      return this.results;
    } catch (error) {
      await this.logToCampaign(
        "error",
        `❌ Error processing contacted leads: ${error.message}`
      );
      console.error("❌ Error processing contacted leads:", error);
      throw error;
    }
  }

  /**
   * Check if a lead has received recent campaign messages (within last 7 days)
   */
  async hasRecentCampaignMessages(lead) {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Check lead timeline for recent automated messages from contacted_leads campaigns
      const recentCampaignInteractions = (lead.timeline || []).filter(
        (entry) => {
          // Check if it's an interaction with campaign metadata
          if (entry.action !== "INTERACTION" || !entry.metadata) return false;

          // Check if it's from a contacted leads campaign
          const isContactedLeadsCampaign =
            entry.metadata.campaignType === "contacted_leads_welcome" ||
            entry.metadata.campaignType === "contacted_leads";

          // Check if it's automated (campaign message)
          const isAutomated = entry.metadata.automated === true;

          // Check if it's recent (within last 7 days)
          const interactionDate = new Date(entry.timestamp);
          const isRecent = interactionDate > sevenDaysAgo;

          return isContactedLeadsCampaign && isAutomated && isRecent;
        }
      );

      if (recentCampaignInteractions.length > 0) {
        const lastCampaignDate = new Date(
          Math.max(
            ...recentCampaignInteractions.map((i) => new Date(i.timestamp))
          )
        );

        return {
          hasRecent: true,
          lastCampaignDate,
          count: recentCampaignInteractions.length,
        };
      }

      return { hasRecent: false };
    } catch (error) {
      console.error(
        `Error checking recent campaign messages for lead ${lead.id}:`,
        error
      );
      return { hasRecent: true, error: error.message };
    }
  }

  /**
   * Process a single lead - send welcome email and WhatsApp message, create conversation
   */
  async processLead(lead) {
    try {
      // Check if lead has received recent campaign messages
      const recentCheck = await this.hasRecentCampaignMessages(lead);

      if (recentCheck.hasRecent) {
        this.results.leadsSkipped++;

        if (recentCheck.error) {
          await this.logToCampaign(
            "warning",
            `⚠️ Skipping lead ${
              lead.name || lead.email || lead.phone
            } - Error checking recent messages: ${recentCheck.error}`,
            lead.id
          );
        } else {
          const daysSince = Math.floor(
            (new Date() - recentCheck.lastCampaignDate) / (1000 * 60 * 60 * 24)
          );
          await this.logToCampaign(
            "info",
            `⏭️ Skipping lead ${
              lead.name || lead.email || lead.phone
            } - Already received campaign message ${daysSince} days ago (${
              recentCheck.count
            } recent messages)`,
            lead.id
          );
        }
        return;
      }

      // Send welcome email if lead has email
      if (lead.email) {
        await this.sendWelcomeEmailToLead(lead);
      } else {
        await this.logToCampaign(
          "warning",
          `⚠️ No email address for lead ${lead.name || lead.phone || lead.id}`,
          lead.id
        );
      }

      // Send WhatsApp welcome message and create conversation if lead has phone
      if (lead.phone || lead.whatsappNumber) {
        await this.sendWelcomeWhatsAppToLead(lead);
        await this.createOrUpdateConversation(lead);
      } else {
        await this.logToCampaign(
          "warning",
          `⚠️ No phone number for lead ${lead.name || lead.email || lead.id}`,
          lead.id
        );
      }

      // Note: CONTACTED leads maintain their status after welcome campaign
      // They should naturally progress to INTERESTED when they engage with portal
      await this.logToCampaign(
        "info",
        `✅ Welcome campaign completed for ${
          lead.name || lead.email || lead.phone
        } - Status remains CONTACTED`,
        lead.id
      );

      this.results.leadsProcessed++;
    } catch (error) {
      const errorMessage = `❌ Error processing lead ${
        lead.name || lead.email || lead.id
      }: ${error.message}`;
      await this.logToCampaign("error", errorMessage, lead.id);
      console.error(errorMessage, error);

      this.results.errors.push({
        leadId: lead.id,
        leadName: lead.name || lead.email || lead.phone,
        error: error.message,
      });
    }
  }

  /**
   * Send welcome email to a lead using shared service
   */
  async sendWelcomeEmailToLead(lead) {
    try {
      await this.logToCampaign(
        "info",
        `📧 Sending welcome email to ${lead.email}...`,
        lead.id
      );

      const result = await FacebookLeadWelcomeService.sendWelcomeEmail(
        lead.email,
        lead.name || "Prospective Student"
      );

      if (result.success) {
        this.results.emailsSent++;
        await this.logToCampaign(
          "success",
          `✅ Welcome email sent successfully to ${lead.email}`,
          lead.id
        );

        // Add interaction to lead timeline
        await this.leadService.addInteraction(lead.id, {
          type: "EMAIL",
          content:
            "Welcome email sent: Welcome to IUEA! Your journey to success starts here 🎓",
          channel: "EMAIL",
          direction: "outgoing",
          automated: true,
          timestamp: new Date(),
          metadata: {
            campaignType: "contacted_leads_welcome",
            emailAddress: lead.email,
            subject: "Welcome to IUEA! Your journey to success starts here 🎓",
            messageType: "welcome_email",
            automated: true,
          },
        });
      } else {
        this.results.emailsFailed++;
        const errorMsg = result.error || "Unknown error";
        await this.logToCampaign(
          "error",
          `❌ Failed to send welcome email to ${lead.email}: ${errorMsg}`,
          lead.id
        );

        this.results.errors.push({
          leadId: lead.id,
          type: "email",
          error: errorMsg,
        });
      }
    } catch (error) {
      this.results.emailsFailed++;
      await this.logToCampaign(
        "error",
        `❌ Error sending welcome email to ${lead.email}: ${error.message}`,
        lead.id
      );

      this.results.errors.push({
        leadId: lead.id,
        type: "email",
        error: error.message,
      });
    }
  }

  /**
   * Send welcome WhatsApp message to a lead using shared service
   */
  async sendWelcomeWhatsAppToLead(lead) {
    try {
      const phoneNumber = lead.phone || lead.whatsappNumber;

      await this.logToCampaign(
        "info",
        `📱 Sending welcome WhatsApp message to ${phoneNumber}...`,
        lead.id
      );

      // Get the WhatsApp payload from the service
      const payload =
        FacebookLeadWelcomeService.getWelcomeWhatsAppPayload(phoneNumber);

      const result = await this.whatsappService.sendTemplateMessage(
        phoneNumber,
        payload,
        { leadId: lead.id }
      );

      if (result.success && result.messageId) {
        this.results.whatsappSent++;
        await this.logToCampaign(
          "success",
          `✅ Welcome WhatsApp message sent successfully to ${phoneNumber} (Message ID: ${result.messageId})`,
          lead.id
        );

        // Add interaction to lead timeline
        await this.leadService.addInteraction(lead.id, {
          type: "WHATSAPP",
          content: `Welcome WhatsApp message sent using ${FacebookLeadWelcomeService.getWelcomeWhatsAppTemplate()} template`,
          channel: "WHATSAPP",
          direction: "outgoing",
          automated: true,
          timestamp: new Date(),
          messageId: result.messageId,
          metadata: {
            campaignType: "contacted_leads_welcome",
            phoneNumber: phoneNumber,
            templateName:
              FacebookLeadWelcomeService.getWelcomeWhatsAppTemplate(),
            messageType: "template",
            automated: true,
          },
        });
      } else {
        this.results.whatsappFailed++;
        const errorMsg = result.error || "Unknown error";
        await this.logToCampaign(
          "error",
          `❌ Failed to send welcome WhatsApp to ${phoneNumber}: ${errorMsg}`,
          lead.id
        );

        this.results.errors.push({
          leadId: lead.id,
          type: "whatsapp",
          error: errorMsg,
        });
      }
    } catch (error) {
      this.results.whatsappFailed++;
      await this.logToCampaign(
        "error",
        `❌ Error sending welcome WhatsApp to ${
          lead.phone || lead.whatsappNumber
        }: ${error.message}`,
        lead.id
      );

      this.results.errors.push({
        leadId: lead.id,
        type: "whatsapp",
        error: error.message,
      });
    }
  }

  /**
   * Create or update conversation for the lead
   */
  async createOrUpdateConversation(lead) {
    try {
      const phoneNumber = lead.phone || lead.whatsappNumber;
      const cleanPhone = phoneNumber.replace(/[^\d]/g, "");

      await this.logToCampaign(
        "info",
        `💬 Creating/updating conversation for ${phoneNumber}...`,
        lead.id
      );

      const conversationId =
        await this.conversationService.createOrGetConversation(
          cleanPhone,
          lead.id,
          lead.name || null
        );

      if (conversationId) {
        this.results.conversationsCreated++;
        await this.logToCampaign(
          "success",
          `✅ Conversation created/updated: ${conversationId} for ${phoneNumber}`,
          lead.id
        );
      }
    } catch (error) {
      await this.logToCampaign(
        "warning",
        `⚠️ Error creating conversation for ${
          lead.phone || lead.whatsappNumber
        }: ${error.message}`,
        lead.id
      );
    }
  }

  /**
   * Print final summary
   */
  printSummary() {
    console.log("\n" + "=".repeat(50));
    console.log("📊 CONTACTED LEADS CAMPAIGN SUMMARY");
    console.log("=".repeat(50));
    console.log(`📋 Total Leads Processed: ${this.results.totalLeads}`);
    console.log(`📧 Emails Sent: ${this.results.emailsSent}`);
    console.log(`❌ Emails Failed: ${this.results.emailsFailed}`);
    console.log(`📱 WhatsApp Messages Sent: ${this.results.whatsappSent}`);
    console.log(`❌ WhatsApp Messages Failed: ${this.results.whatsappFailed}`);
    console.log(
      `💬 Conversations Created: ${this.results.conversationsCreated}`
    );
    console.log(
      `✅ Leads Successfully Processed: ${this.results.leadsProcessed}`
    );
    console.log(`⏭️ Leads Skipped: ${this.results.leadsSkipped}`);
    console.log(`⚠️ Total Errors: ${this.results.errors.length}`);
    console.log(
      "\n📝 Note: CONTACTED leads maintain their status after welcome campaign."
    );
    console.log(
      "   They will naturally progress to INTERESTED when they engage with the portal."
    );
    console.log("=".repeat(50));
  }

  /**
   * Simple delay function
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export the class for use in other modules
module.exports = ContactedLeadsMessenger;

// If this script is run directly (not imported), execute the campaign
if (require.main === module) {
  (async () => {
    try {
      const messenger = new ContactedLeadsMessenger();
      await messenger.processContactedLeads();
      console.log("✅ Contacted leads campaign completed successfully!");
      process.exit(0);
    } catch (error) {
      console.error("❌ Campaign failed:", error);
      process.exit(1);
    }
  })();
}
