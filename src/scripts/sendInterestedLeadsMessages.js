#!/usr/bin/env node

/**
 * Script to send email and WhatsApp messages to all leads with "INTERESTED" status
 * Uses the whatsapp_validation template for WhatsApp messages
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
  constructor() {
    this.leadService = new LeadService(db);
    this.emailService = emailService; // Use the singleton instance
    this.whatsappService = new WhatsAppMessageService();
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
   * Main function to process all interested leads
   */
  async processInterestedLeads() {
    try {
      console.log(
        "🚀 Starting process to send messages to interested leads..."
      );

      // Find all leads with INTERESTED status
      const interestedLeads = await this.leadService.findLeadsByStatus(
        LEAD_STATUSES.INTERESTED
      );
      this.results.totalLeads = interestedLeads.length;

      console.log(
        `📊 Found ${interestedLeads.length} leads with INTERESTED status`
      );

      if (interestedLeads.length === 0) {
        console.log("ℹ️ No interested leads found. Exiting...");
        return this.results;
      }

      // Process each lead
      for (let i = 0; i < interestedLeads.length; i++) {
        const lead = interestedLeads[i];
        console.log(
          `\n📋 Processing lead ${i + 1}/${interestedLeads.length}: ${
            lead.name
          } (${lead.id})`
        );

        await this.processLead(lead);

        // Add a small delay between processing leads to avoid rate limiting
        await this.delay(1000);
      }

      this.printSummary();
      return this.results;
    } catch (error) {
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
        console.log(`⚠️ No email address for lead ${lead.name}`);
      }

      // Send WhatsApp message if lead has phone number
      if (lead.phone || lead.whatsappNumber) {
        await this.sendWhatsAppToLead(lead);
      } else {
        console.log(`⚠️ No phone number for lead ${lead.name}`);
      }
    } catch (error) {
      console.error(`❌ Error processing lead ${lead.name}:`, error);
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
      const subject = "Thank you for your interest in IUEA";
      const emailContent = this.generateEmailContent(lead);

      console.log(`📧 Sending email to ${lead.email}...`);

      const result = await this.emailService.sendEmail({
        to: lead.email,
        subject: subject,
        html: emailContent.html,
        text: emailContent.text,
        replyTo: "apply@iuea.ac.ug", // Set reply-to address
      });

      if (result.success) {
        console.log(`✅ Email sent successfully to ${lead.email}`);
        this.results.emailsSent++;

        // Add interaction to lead timeline
        await this.leadService.addInteraction(lead.id, {
          type: "EMAIL",
          content: `Email sent: ${subject}`,
          channel: "EMAIL",
          automated: true,
          direction: "outgoing",
          metadata: {
            messageId: result.messageId,
            provider: result.provider,
          },
        });
      } else {
        console.log(
          `❌ Failed to send email to ${lead.email}: ${result.error}`
        );
        this.results.emailsFailed++;
      }
    } catch (error) {
      console.error(`❌ Email error for ${lead.email}:`, error);
      this.results.emailsFailed++;
    }
  }

  /**
   * Send WhatsApp message to a lead using whatsapp_validation template
   */
  async sendWhatsAppToLead(lead) {
    try {
      // Use whatsappNumber if available, otherwise use phone
      const phoneNumber = lead.whatsappNumber || lead.phone;

      // Clean phone number (remove any non-digit characters except +)
      const cleanedPhone = phoneNumber.replace(/[^\d+]/g, "");

      console.log(
        `📱 Sending WhatsApp validation message to ${cleanedPhone}...`
      );

      // Prepare the whatsapp_validation template payload
      const templatePayload = {
        messaging_product: "whatsapp",
        to: cleanedPhone.replace(/^\+/, ""), // Remove + for API
        type: "template",
        template: {
          name: "whatsapp_validation",
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
        }
      );

      if (result.success) {
        console.log(`✅ WhatsApp message sent successfully to ${cleanedPhone}`);
        this.results.whatsappSent++;

        // Add interaction to lead timeline
        await this.leadService.addInteraction(lead.id, {
          type: "WHATSAPP",
          content: "WhatsApp validation template sent",
          channel: "WHATSAPP",
          automated: true,
          direction: "outgoing",
          metadata: {
            messageId: result.messageId,
            templateName: "whatsapp_validation",
            campaignType: "interested_leads",
          },
        });
      } else {
        console.log(
          `❌ Failed to send WhatsApp message to ${cleanedPhone}: ${result.error}`
        );
        this.results.whatsappFailed++;
      }
    } catch (error) {
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
    <title>Thank you for your interest in IUEA</title>
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
            <h1>Thank You for Your Interest!</h1>
            <p>International University of East Africa (IUEA)</p>
        </div>
        
        <div class="content">
            <p>Dear ${lead.name || "Prospective Student"},</p>
            
            <p>Thank you for showing interest in the International University of East Africa (IUEA). We're excited about the possibility of having you join our vibrant academic community!</p>
            
            <div class="highlight">
                <h3>Why Choose IUEA?</h3>
                <ul>
                    <li>🎓 Internationally recognized degree programs</li>
                    <li>🌍 Diverse, multicultural learning environment</li>
                    <li>👨‍🏫 Experienced faculty and industry experts</li>
                    <li>🏢 Modern facilities and state-of-the-art technology</li>
                    <li>💼 Strong industry connections and internship opportunities</li>
                </ul>
            </div>
            
            <p>Our admissions team is ready to guide you through the application process and answer any questions you may have about our programs, campus life, or admission requirements.</p>
            
            <p style="text-align: center;">
                <a href="https://applicant.iuea.ac.ug/login" class="cta-button">Continue Your Application</a>
            </p>
            
            <p>We look forward to hearing from you soon and hope to welcome you to the IUEA family!</p>
            
            <p>Best regards,<br>
            <strong>IUEA Admissions Office</strong><br>
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

Thank you for showing interest in the International University of East Africa (IUEA). We're excited about the possibility of having you join our vibrant academic community!

Why Choose IUEA?
- Internationally recognized degree programs
- Diverse, multicultural learning environment
- Experienced faculty and industry experts
- Modern facilities and state-of-the-art technology
- Strong industry connections and internship opportunities

Our admissions team is ready to guide you through the application process and answer any questions you may have about our programs, campus life, or admission requirements.

Continue your application: https://applicant.iuea.ac.ug/login

We look forward to hearing from you soon and hope to welcome you to the IUEA family!

Best regards,
IUEA Admissions Office
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
}

// Main execution function
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
