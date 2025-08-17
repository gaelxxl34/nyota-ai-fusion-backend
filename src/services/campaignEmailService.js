const logger = require("../utils/logger");
const emailTracker = require("./emailTracker");

class CampaignEmailService {
  constructor() {
    this.sgMail = null;
    this.isInitialized = false;
    this.initializeSendGrid();
  }

  initializeSendGrid() {
    try {
      // Try to require SendGrid - make it optional
      try {
        this.sgMail = require("@sendgrid/mail");
      } catch (requireError) {
        logger.warn(
          "SendGrid package not found. Campaign email functionality will be disabled.",
          {
            error: requireError.message,
            code: requireError.code,
          }
        );
        this.isInitialized = false;
        return;
      }

      if (!process.env.SENDGRID_API_KEY) {
        logger.warn(
          "SendGrid API key not found in environment variables. Campaign email functionality will be disabled."
        );
        this.isInitialized = false;
        return;
      }

      this.sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      this.isInitialized = true;
      logger.info("Campaign SendGrid email service initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize Campaign SendGrid:", error);
      this.isInitialized = false;
    }
  }

  /**
   * Get the IUEA campaign email template with inline styles for better email client compatibility
   */
  getCampaignTemplate() {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Welcome to IUEA – Your August 2025 Orientation Week</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" crossorigin="anonymous" />
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap" rel="stylesheet" />
    <style>
      body {
        font-family: "Montserrat", Arial, sans-serif;
        line-height: 1.5;
        margin: 0;
        padding: 20px;
        background-color: #f8f9fa;
      }
      .email-container {
        max-width: 600px;
        margin: 0 auto;
        background-color: #ffffff;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      }
      .header {
        text-align: center;
        padding: 32px 0;
        background-color: #ffffff;
      }
      .logo {
        height: 80px;
        width: auto;
      }
      .main-content {
        padding: 24px 32px;
      }
      .greeting {
        font-size: 20px;
        font-weight: bold;
        color: #1f2937;
        margin-bottom: 24px;
      }
      .main-message {
        color: #374151;
        font-size: 14px;
        line-height: 1.6;
        margin-bottom: 16px;
      }
      .section-title {
        font-size: 18px;
        font-weight: bold;
        color: #000000;
        margin: 32px 0 16px 0;
      }
      .section-content {
        color: #374151;
        font-size: 14px;
      }
      .list-item {
        display: flex;
        align-items: flex-start;
        margin-bottom: 8px;
      }
      .bullet {
        width: 8px;
        height: 8px;
        background-color: #8b0000;
        border-radius: 50%;
        margin-top: 8px;
        margin-right: 12px;
        flex-shrink: 0;
      }
      .zoom-section {
        margin-top: 24px;
      }
      .zoom-link {
        display: inline-block;
        background-color: #8b0000;
        color: white !important;
        padding: 12px 24px;
        text-decoration: none;
        border-radius: 0;
        font-size: 14px;
        font-weight: 600;
        margin-top: 12px;
      }
      .zoom-link:hover {
        background-color: #660000;
        text-decoration: none;
      }
      .table {
        width: 100%;
        border: 1px solid #e5e7eb;
        border-collapse: collapse;
        font-size: 14px;
        margin-top: 16px;
      }
      .table-header {
        background-color: #8b0000;
        color: white;
      }
      .table-header th {
        padding: 12px 16px;
        text-align: left;
        font-weight: 600;
        border: 1px solid #8b0000;
      }
      .table-row td {
        padding: 12px 16px;
        border: 1px solid #e5e7eb;
      }
      .table-row:nth-child(even) {
        background-color: #f9f9f9;
      }
      .contact-info {
        margin-top: 32px;
        color: #374151;
        font-size: 14px;
        line-height: 1.6;
      }
      .contact-info p {
        margin-bottom: 16px;
      }
      .email-link {
        color: #8b0000;
        font-weight: 600;
        text-decoration: none;
      }
      .email-link:hover {
        text-decoration: underline;
      }
      .closing {
        margin-top: 32px;
        color: #374151;
        font-size: 14px;
      }
      .closing p {
        margin-bottom: 8px;
      }
      .footer {
        background-color: #EEEEEE;
        padding: 24px 32px;
        margin-top: 32px;
      }
      .social-icons {
        display: block;
        text-align: center;
        margin-bottom: 24px;
      }
      .social-icon {
        display: inline-block;
        text-align: center;
        color: #8b0000;
        text-decoration: none;
        font-size: 24px;
        margin: 0 12px;
        vertical-align: middle;
      }
      .address {
        text-align: center;
        font-size: 12px;
        color: #6b7280;
        line-height: 1.4;
      }
      .address p {
        margin-bottom: 4px;
      }
      .unsubscribe {
        text-align: center;
        margin-top: 16px;
      }
      .unsubscribe p {
        font-size: 12px;
        color: #9ca3af;
      }
      .unsubscribe a {
        color: #6b7280;
        text-decoration: underline;
      }
      .unsubscribe a:hover {
        color: #8b0000;
      }
      .highlight {
        font-weight: 600;
        color: #8b0000;
      }
      .bold {
        font-weight: 600;
      }
      .note {
        font-size: 12px;
        color: #6b7280;
        margin-top: 12px;
      }
    </style>
  </head>
  <body>
    <div class="email-container">
      <!-- Header with Logo -->
      <div class="header">
        <img
          src="https://iuea.ac.ug/sitepad-data/uploads/2020/11/Website-Logo.png"
          alt="IUEA Logo"
          class="logo"
        />
      </div>

      <!-- Main Content -->
      <div class="main-content">
        <!-- Greeting -->
        <h1 class="greeting">Dear IUEA Student,</h1>

        <!-- Main Message -->
        <div class="main-message">
          <p>
            Thank you for applying to the International University of East Africa (IUEA).
          </p>
          <p>
            We have reviewed your documents and found that all are incomplete and do not meet the admission requirements.
          </p>
          <p>
            If you provide corrected documents, you will be able to join us for <span class="highlight">Orientation Week</span> and secure your place in the August 2025 Intake.
          </p>
        </div>

        <!-- Orientation Details -->
        <div>
          <h2 class="section-title">📅 Orientation Week Details</h2>
          <div class="section-content">
            <div class="list-item">
              <span class="bullet"></span>
              <span
                ><span class="bold">Dates:</span> Monday 18th – Friday 22nd August 2025</span
              >
            </div>
            <div class="list-item">
              <span class="bullet"></span>
              <span><span class="bold">Time:</span> 10:00am – 1:00pm daily</span>
            </div>
            <div class="list-item">
              <span class="bullet"></span>
              <span
                ><span class="bold">Venue:</span> SmartRoom 1, IUEA Main Campus, Kansanga, Kampala</span
              >
            </div>
            <div class="list-item">
              <span class="bullet"></span>
              <span><span class="bold">Zoom:</span> Meeting ID – 884 0031 9626</span>
            </div>
          </div>
        </div>

        <!-- Daily Schedule -->
        <div style="margin-top: 32px">
          <h2 class="section-title">What's Happening Each Day:</h2>
          <div class="section-content">
            <div class="list-item">
              <span class="bullet"></span>
              <span><span class="bold">Day 1:</span> Meet the Vice Chancellor, DVC, Deans, Admissions, Academic Registrar, Library, and Finance teams + Q&A.</span>
            </div>
            <div class="list-item">
              <span class="bullet"></span>
              <span><span class="bold">Day 2:</span> Security briefing, ICT session, LMS training.</span>
            </div>
            <div class="list-item">
              <span class="bullet"></span>
              <span><span class="bold">Day 3:</span> LMS training, Guild introductions, campus tour.</span>
            </div>
            <div class="list-item">
              <span class="bullet"></span>
              <span><span class="bold">Day 4:</span> Guild activities, personal awareness session with International Speaker Mr John Jacob, fun activities.</span>
            </div>
            <div class="list-item">
              <span class="bullet"></span>
              <span><span class="bold">Day 5:</span> Campus tours and a meet-and-greet with musician Gabzy.</span>
            </div>
          </div>
        </div>

        <!-- Full Schedule Button -->
        <div class="zoom-section">
          <a
            href="https://drive.google.com/file/d/1wff87ASHhO9JMxEf-FmSQB8YRvAmOEjW/view?usp=sharing"
            class="zoom-link"
            target="_blank"
            rel="noopener noreferrer"
            style="text-decoration: none;"
            >📄 View Full Orientation Schedule</a
          >
        </div>

        <!-- Discount Information -->
        <div style="margin-top: 32px">
          <h2 class="section-title">
            💡 Special Tuition Discount – Save up to <span class="highlight">10%</span>
          </h2>
          <div class="section-content" style="margin-bottom: 16px">
            <p>Clear 100% of your tuition fees early and enjoy:</p>
          </div>
          <table class="table">
            <thead>
              <tr class="table-header">
                <th>DISCOUNT</th>
                <th>PAYMENT TERMS</th>
              </tr>
            </thead>
            <tbody>
              <tr class="table-row">
                <td>5% off</td>
                <td>Pay for one semester in full</td>
              </tr>
              <tr class="table-row">
                <td>10% off</td>
                <td>Pay for the whole year in full</td>
              </tr>
            </tbody>
          </table>
          <p class="note">
            <span class="bold">Offer valid until:</span> <span class="highlight">29th August 2025</span>
          </p>
        </div>

        <!-- Contact Information -->
        <div class="contact-info">
          <p>
            We look forward to having you join us once your application is corrected.
          </p>
          <p>
            📧 <a href="mailto:apply@iuea.ac.ug" class="email-link">apply@iuea.ac.ug</a> | 
            <a href="mailto:info@iuea.ac.ug" class="email-link">info@iuea.ac.ug</a>
          </p>
          <p>
            📱 WhatsApp: +256 705 722 300 | Call: +256 790 002 000
          </p>
        </div>

        <!-- Closing -->
        <div class="closing">
          <p>Warm regards,</p>
          <p class="bold">Admissions Team</p>
          <p class="bold">International University of East Africa</p>
        </div>
      </div>

      <!-- Footer -->
      <div class="footer">
        <!-- Social Media Icons -->
        <div class="social-icons">
          <a href="https://facebook.com/iuea" class="social-icon" title="Facebook">
            <i class="fab fa-facebook-f" style="color: #8b0000;"></i>
          </a>
          <a href="https://linkedin.com/company/iuea" class="social-icon" title="LinkedIn">
            <i class="fab fa-linkedin-in" style="color: #8b0000;"></i>
          </a>
          <a href="https://twitter.com/iuea" class="social-icon" title="Twitter">
            <i class="fab fa-x-twitter" style="color: #8b0000;"></i>
          </a>
          <a href="https://instagram.com/iuea" class="social-icon" title="Instagram">
            <i class="fab fa-instagram" style="color: #8b0000;"></i>
          </a>
          <a href="https://tiktok.com/@iuea" class="social-icon" title="TikTok">
            <i class="fab fa-tiktok" style="color: #8b0000;"></i>
          </a>
        </div>

        <!-- University Address -->
        <div class="address">
          <p>
            International University of East Africa, Plot No. 1112/1121,
            Kansanga Ggaba Rd, P.O.Box 35502,
          </p>
          <p>Kampala, Uganda P.O Box 35502, Uganda. 0705722300</p>
        </div>

        <!-- Unsubscribe -->
        <div class="unsubscribe">
          <p>To unsubscribe, <a href="#">click here</a></p>
        </div>
      </div>
    </div>
  </body>
</html>`;
  }

  /**
   * Send individual campaign email using the template
   */
  async sendCampaignEmail({
    to,
    subject,
    studentName,
    content,
    campaignId = null,
  }) {
    try {
      if (!this.isInitialized || !this.sgMail) {
        throw new Error("Campaign email service not initialized");
      }

      // Check if email should be suppressed
      const suppressionCheck = emailTracker.shouldSuppressEmail(to);
      if (suppressionCheck.suppress) {
        console.log(
          `🚫 Email suppressed for ${to}: ${suppressionCheck.reason}`
        );
        return {
          success: false,
          message: `Email suppressed: ${suppressionCheck.reason}`,
          suppressed: true,
        };
      }

      // Get the beautiful template
      let emailTemplate = this.getCampaignTemplate();

      // Replace placeholders in the template with dynamic content
      if (studentName && studentName !== "IUEA Student") {
        emailTemplate = emailTemplate.replace(
          "Dear IUEA Student,",
          `Dear ${studentName},`
        );
      }

      // If custom content is provided, replace the main message sections
      if (content) {
        // Replace main message content
        if (content.mainMessage) {
          const currentMainMessage = `<p>What could make a morning of fun and laughter more amazing? Prizes! Day 3 of orientation is tomorrow and we have incredible <span class="highlight">cash prizes</span> waiting for you, the kind never before seen in an IUEA orientation.</p>
                <p>And the best part? The games are so much fun that simply participating is worth getting excited about! They are both fun and inclusive, designed to ensure everyone has a chance to win. So don't miss out on this chance to start your semester with a smile on your face and a large amount of cash in your pocket.</p>`;

          emailTemplate = emailTemplate.replace(
            currentMainMessage,
            `<p>${content.mainMessage}</p>`
          );
        }

        // Replace additional info if provided
        if (content.additionalInfo) {
          const currentContactInfo = `<p>Got questions? Need more info? We've got you covered! Just shoot us an email at <a href="mailto:info@iuea.ac.ug" class="email-link">info@iuea.ac.ug</a>, and we'll get back to you ASAP.</p>
                <p>See you tomorrow—same time, same place!</p>`;

          emailTemplate = emailTemplate.replace(
            currentContactInfo,
            `<p>${content.additionalInfo}</p>`
          );
        }

        // Add call to action if provided
        if (content.callToAction) {
          const closingSection = `<div class="closing">
                <p>Warm Regards</p>
                <p class="bold">IUEA Marketing Team</p>
            </div>`;

          emailTemplate = emailTemplate.replace(
            closingSection,
            `<div class="main-message">
                <p>${content.callToAction}</p>
            </div>
            ${closingSection}`
          );
        }
      }

      const msg = {
        to: to,
        from: {
          email: "noreply@iuea.app",
          name: "IUEA Admissions Office",
        },
        replyTo: {
          email: process.env.EMAIL_REPLY_TO || "info@iuea.ac.ug",
          name: "IUEA Admissions Office",
        },
        subject: subject,
        html: emailTemplate,
        // Disable click tracking to prevent URL rewriting
        trackingSettings: {
          clickTracking: {
            enable: false,
          },
          openTracking: {
            enable: true,
          },
          subscriptionTracking: {
            enable: false,
          },
          ganalytics: {
            enable: false,
          },
        },
      };

      const result = await this.sgMail.send(msg);

      // Get the message ID from SendGrid response for tracking
      const messageId = result?.[0]?.headers?.["x-message-id"] || null;

      // Log the sent email for tracking
      if (messageId) {
        emailTracker.logSentEmail(messageId, to, subject, campaignId);
      }

      console.log(`✅ Campaign email sent to ${to}. Message ID: ${messageId}`);

      return {
        success: true,
        message: "Campaign email sent successfully",
        messageId: messageId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`❌ Error sending campaign email to ${to}:`, error);
      return {
        success: false,
        message: error.message || "Failed to send campaign email",
      };
    }
  }

  /**
   * Send campaign emails to multiple recipients (bulk send)
   */
  async sendBulkCampaignEmails({
    recipients,
    subject,
    content,
    batchSize = 10,
  }) {
    try {
      console.log(
        `📧 Starting bulk campaign email send to ${recipients.length} recipients`
      );

      if (!this.isInitialized || !this.sgMail) {
        throw new Error("Campaign email service not initialized");
      }

      const results = {
        total: recipients.length,
        successful: 0,
        failed: 0,
        errors: [],
      };

      // Process in batches to avoid rate limiting
      for (let i = 0; i < recipients.length; i += batchSize) {
        const batch = recipients.slice(i, i + batchSize);
        console.log(
          `📧 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
            recipients.length / batchSize
          )}`
        );

        // Process batch concurrently
        const batchPromises = batch.map(async (recipient) => {
          try {
            const result = await this.sendCampaignEmail({
              to: recipient.email,
              subject: subject,
              studentName:
                recipient.name || recipient.firstName || "IUEA Student",
              content: content,
              campaignId: `campaign_${Date.now()}`, // Generate campaign ID
            });

            if (result.success) {
              results.successful++;
              console.log(`✅ Campaign email sent to ${recipient.email}`);
            } else {
              results.failed++;
              results.errors.push(`${recipient.email}: ${result.message}`);
              console.error(
                `❌ Failed to send campaign email to ${recipient.email}: ${result.message}`
              );
            }
          } catch (error) {
            results.failed++;
            results.errors.push(`${recipient.email}: ${error.message}`);
            console.error(
              `❌ Error sending campaign email to ${recipient.email}:`,
              error.message
            );
          }
        });

        await Promise.all(batchPromises);

        // Add delay between batches to respect rate limits
        if (i + batchSize < recipients.length) {
          console.log(`⏱️ Waiting 1 second before next batch...`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      console.log(
        `📊 Bulk campaign email completed: ${results.successful} successful, ${results.failed} failed`
      );

      return results;
    } catch (error) {
      console.error(`❌ Error in bulk campaign email send:`, error);
      throw error;
    }
  }

  /**
   * Get email delivery statistics
   */
  getDeliveryStats() {
    return emailTracker.getDeliveryStats();
  }

  /**
   * Get campaign statistics
   */
  getCampaignStats(campaignId) {
    return emailTracker.getCampaignStats(campaignId);
  }

  /**
   * Get bounced emails
   */
  getBouncedEmails() {
    return emailTracker.getBouncedEmails();
  }

  /**
   * Check email status
   */
  getEmailStatus(messageId) {
    return emailTracker.getEmailStatus(messageId);
  }
}

module.exports = CampaignEmailService;
