#!/usr/bin/env node

/**
 * Script to send email and WhatsApp messages to all leads with "INTERESTED" status
 * Uses the application_followup_iuea template for WhatsApp messages
 */

// Load environment variables
require("dotenv").config();

const admin = require("firebase-admin");
const path = require("path");

// Initialize Firebase Admin
const serviceAccount = require("../../serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Import required services
const LeadService = require("../services/leadService");
const emailService = require("../services/emailService"); // This is already an instance
const WhatsAppMessageService = require("../services/whatsappMessageService");
const { LEAD_STATUSES } = require("../config/lead.constants");

class InterestedLeadsMessenger {
  constructor(campaignRef = null) {
    this.leadService = new LeadService(db);
    this.emailService = emailService; // Use the singleton instance
    this.whatsappService = new WhatsAppMessageService();
    this.campaignRef = campaignRef; // For real-time updates
    this.results = {
      totalLeads: 0,
      emailsSent: 0,
      emailsFailed: 0,
      whatsappSent: 0,
      whatsappFailed: 0,
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
          "results.errors": this.results.errors,
        });
      } catch (error) {
        console.error("Failed to update campaign progress:", error);
      }
    }
  }

  /**
   * Main function to process all interested leads
   */
  async processInterestedLeads() {
    try {
      await this.logToCampaign(
        "info",
        "🚀 Starting process to send messages to interested leads..."
      );

      // Find all leads with INTERESTED status
      const interestedLeads = await this.leadService.findLeadsByStatus(
        LEAD_STATUSES.INTERESTED
      );
      this.results.totalLeads = interestedLeads.length;

      await this.logToCampaign(
        "info",
        `📊 Found ${interestedLeads.length} leads with INTERESTED status`
      );

      if (interestedLeads.length === 0) {
        await this.logToCampaign(
          "info",
          "ℹ️ No interested leads found. Exiting..."
        );
        return this.results;
      }

      // Process each lead
      for (let i = 0; i < interestedLeads.length; i++) {
        const lead = interestedLeads[i];
        await this.logToCampaign(
          "info",
          `📋 Processing lead ${i + 1}/${interestedLeads.length}: ${
            lead.name
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
        `❌ Error processing interested leads: ${error.message}`
      );
      console.error("❌ Error processing interested leads:", error);
      throw error;
    }
  }

  /**
   * Process a single lead - send email and WhatsApp message
   */
  async processLead(lead) {
    try {
      // Send email if lead has email
      if (lead.email) {
        await this.sendEmailToLead(lead);
      } else {
        await this.logToCampaign(
          "warning",
          `⚠️ No email address for lead ${lead.name}`,
          lead.id
        );
      }

      // Send WhatsApp message if lead has phone number
      if (lead.phone || lead.whatsappNumber) {
        await this.sendWhatsAppToLead(lead);
      } else {
        await this.logToCampaign(
          "warning",
          `⚠️ No phone number for lead ${lead.name}`,
          lead.id
        );
      }
    } catch (error) {
      const errorMessage = `❌ Error processing lead ${lead.name}: ${error.message}`;
      await this.logToCampaign("error", errorMessage, lead.id);
      console.error(errorMessage, error);

      this.results.errors.push({
        leadId: lead.id,
        leadName: lead.name,
        error: error.message,
      });
    }
  }

  /**
   * Send email to a lead
   */
  async sendEmailToLead(lead) {
    try {
      const subject =
        "How's your IUEA application going? We're here to help! 🌟";
      const emailContent = this.generateEmailContent(lead);

      await this.logToCampaign(
        "info",
        `📧 Sending email to ${lead.email}...`,
        lead.id
      );

      const result = await this.emailService.sendEmail({
        to: lead.email,
        subject: subject,
        html: emailContent.html,
        text: emailContent.text,
        replyTo: "apply@iuea.ac.ug", // Set reply-to address
      });

      if (result.success) {
        await this.logToCampaign(
          "success",
          `✅ Email sent successfully to ${lead.email}`,
          lead.id
        );
        this.results.emailsSent++;

        // Add interaction to lead timeline
        await this.leadService.addInteraction(lead.id, {
          type: "EMAIL",
          content: emailContent.text, // Save the actual email content
          channel: "EMAIL",
          automated: true,
          direction: "outgoing",
          metadata: {
            messageId: result.messageId,
            provider: result.provider,
            subject: subject,
            campaignType: "interested_leads_followup",
          },
        });
      } else {
        await this.logToCampaign(
          "error",
          `❌ Failed to send email to ${lead.email}: ${result.error}`,
          lead.id
        );
        this.results.emailsFailed++;
      }
    } catch (error) {
      await this.logToCampaign(
        "error",
        `❌ Email error for ${lead.email}: ${error.message}`,
        lead.id
      );
      console.error(`❌ Email error for ${lead.email}:`, error);
      this.results.emailsFailed++;
    }
  }

  /**
   * Send WhatsApp message to a lead using application_followup_iuea template
   */
  async sendWhatsAppToLead(lead) {
    try {
      // Use whatsappNumber if available, otherwise use phone
      const phoneNumber = lead.whatsappNumber || lead.phone;

      // Clean phone number (remove any non-digit characters except +)
      const cleanedPhone = phoneNumber.replace(/[^\d+]/g, "");

      await this.logToCampaign(
        "info",
        `📱 Sending WhatsApp follow-up message to ${cleanedPhone}...`,
        lead.id
      );

      // Template message content
      const templateContent = `Hi there! 👋
Just checking in to see how things are going with your IUEA application.
We'd love to hear from you — if there's anything you need or any challenge you're facing, feel free to let us know. 😊
We're here to support you and are excited to have you on this journey! 🌟`;

      // Prepare the application_followup_iuea template payload
      const templatePayload = {
        messaging_product: "whatsapp",
        to: cleanedPhone.replace(/^\+/, ""), // Remove + for API
        type: "template",
        template: {
          name: "application_followup_iuea",
          language: { code: "en_US" },
          components: [],
        },
      };

      const result = await this.whatsappService.sendTemplateMessage(
        cleanedPhone.replace(/^\+/, ""),
        templatePayload,
        {
          leadId: lead.id,
          contactName: lead.name,
          validationType: "interested_leads_campaign",
          createConversation: true, // Ensure conversation is created
        }
      );

      if (result.success) {
        await this.logToCampaign(
          "success",
          `✅ WhatsApp message sent successfully to ${cleanedPhone}`,
          lead.id
        );
        this.results.whatsappSent++;

        // Add interaction to lead timeline with actual message content
        await this.leadService.addInteraction(lead.id, {
          type: "WHATSAPP",
          content: templateContent,
          channel: "WHATSAPP",
          automated: true,
          direction: "outgoing",
          metadata: {
            messageId: result.messageId,
            templateName: "application_followup_iuea",
            campaignType: "interested_leads",
            templateCategory: "Marketing",
          },
        });
      } else {
        await this.logToCampaign(
          "error",
          `❌ Failed to send WhatsApp message to ${cleanedPhone}: ${result.error}`,
          lead.id
        );
        this.results.whatsappFailed++;
      }
    } catch (error) {
      await this.logToCampaign(
        "error",
        `❌ WhatsApp error for ${lead.phone}: ${error.message}`,
        lead.id
      );
      console.error(`❌ WhatsApp error for ${lead.phone}:`, error);
      this.results.whatsappFailed++;
    }
  }

  /**
   * Generate email content for interested leads
   */
  generateEmailContent(lead) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>How's your IUEA application going?</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .logo { text-align: center; padding: 20px; background: #fff; }
        .logo img { max-width: 200px; height: auto; }
        .header { background: #7a0000; color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 28px; }
        .content { padding: 30px; }
        .highlight { background: #f8f9fa; padding: 20px; border-left: 4px solid #7a0000; margin: 20px 0; }
        .cta-button { display: inline-block; padding: 15px 30px; background: #7a0000; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
        .footer { background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #eee; }
        .footer p { margin: 5px 0; color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">
            <img src="https://iuea.ac.ug/sitepad-data/uploads/2020/11/Website-Logo.png" alt="IUEA Logo" />
        </div>
        
        <div class="header">
            <h1>How's Your Application Going? 👋</h1>
            <p>International University of East Africa (IUEA)</p>
        </div>
        
        <div class="content">
            <p>Dear ${lead.name || "Prospective Student"},</p>
            
            <p>We hope this email finds you well! 😊 We're just checking in to see how things are going with your IUEA application.</p>
            
            <p>We understand that the application process can sometimes feel overwhelming, and we want you to know that <strong>we're here to support you every step of the way!</strong></p>
            
            <div class="highlight">
                <h3>Need Help? We've Got You Covered! 🤝</h3>
                <p>If you're facing any challenges or have questions about:</p>
                <ul>
                    <li>📋 Application requirements or documents</li>
                    <li>💰 Tuition fees and payment options</li>
                    <li>� Accommodation and campus life</li>
                    <li>📚 Our academic programs</li>
                    <li>� Any other concerns</li>
                </ul>
                <p><strong>Please don't hesitate to reach out to us!</strong> Our admissions team is ready to assist you.</p>
            </div>
            
            <p>Remember, taking this step toward your education shows incredible determination, and we're excited to have you on this journey with us! 🌟</p>
            
            <p style="text-align: center;">
                <a href="https://applicant.iuea.ac.ug/login" class="cta-button">Continue Your Application</a>
            </p>
            
            <p>Feel free to reply to this email or call us directly if you need any assistance. We're here to help make your dream of joining IUEA a reality!</p>
            
            <p>Wishing you all the best,<br>
            <strong>IUEA Admissions Team</strong><br>
            International University of East Africa</p>
        </div>
        
        <div class="footer">
            <p><strong>Contact Information:</strong></p>
            <p>📞 Phone: +256 706 026496 | 📧 Email: apply@iuea.ac.ug</p>
            <p>🌐 Website: www.iuea.ac.ug | 📍 Kansanga, Kampala, Uganda</p>
        </div>
    </div>
</body>
</html>`;

    const text = `
Dear ${lead.name || "Prospective Student"},

We hope this email finds you well! 😊 We're just checking in to see how things are going with your IUEA application.

We understand that the application process can sometimes feel overwhelming, and we want you to know that we're here to support you every step of the way!

Need Help? We've Got You Covered! 🤝

If you're facing any challenges or have questions about:
- Application requirements or documents
- Tuition fees and payment options
- Accommodation and campus life
- Our academic programs
- Any other concerns

Please don't hesitate to reach out to us! Our admissions team is ready to assist you.

Remember, taking this step toward your education shows incredible determination, and we're excited to have you on this journey with us! 🌟

Continue your application: https://applicant.iuea.ac.ug/login

Feel free to reply to this email or call us directly if you need any assistance. We're here to help make your dream of joining IUEA a reality!

Wishing you all the best,
IUEA Admissions Team
International University of East Africa

Contact Information:
Phone: +256 706 026496
Email: apply@iuea.ac.ug
Website: www.iuea.ac.ug
Address: Kansanga, Kampala, Uganda
`;

    return { html, text };
  }

  /**
   * Add delay between operations
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Print summary of results
   */
  printSummary() {
    console.log("\n" + "=".repeat(60));
    console.log("📊 CAMPAIGN SUMMARY");
    console.log("=".repeat(60));
    console.log(`📋 Total leads processed: ${this.results.totalLeads}`);
    console.log(`📧 Emails sent successfully: ${this.results.emailsSent}`);
    console.log(`❌ Emails failed: ${this.results.emailsFailed}`);
    console.log(`📱 WhatsApp messages sent: ${this.results.whatsappSent}`);
    console.log(`❌ WhatsApp messages failed: ${this.results.whatsappFailed}`);

    if (this.results.errors.length > 0) {
      console.log(`\n⚠️ Errors encountered: ${this.results.errors.length}`);
      this.results.errors.forEach((error, index) => {
        console.log(
          `  ${index + 1}. ${error.leadName} (${error.leadId}): ${error.error}`
        );
      });
    }

    console.log("=".repeat(60));
  }
} // Main execution function
async function main() {
  try {
    console.log("🚨 PRODUCTION MODE ACTIVE 🚨");
    console.log(
      "This will send emails and WhatsApp messages to ALL interested leads in the database."
    );
    console.log("Press Ctrl+C within 5 seconds to cancel...\n");

    // Give user 5 seconds to cancel
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const messenger = new InterestedLeadsMessenger();
    const results = await messenger.processInterestedLeads();

    console.log("\n✅ Script completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = InterestedLeadsMessenger;
