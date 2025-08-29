const emailService = require("./emailService");
const conversationService = require("./conversationService");
const WhatsAppMessageService = require("./whatsappMessageService");
const logger = require("../utils/logger");

class WelcomeService {
  constructor() {
    this.conversationService = new conversationService();
    this.whatsappMessageService = new WhatsAppMessageService();
  }

  /**
   * Send welcome email to a user
   */
  async sendWelcomeEmail({ userEmail, userName, isFirstLogin = true }) {
    return await this._sendEmailInternal({ userEmail, userName, isFirstLogin });
  }

  /**
   * Send welcome WhatsApp message to a user
   */
  async sendWelcomeWhatsApp({ phoneNumber, userName, isFirstLogin = true }) {
    return await this._sendWhatsAppInternal({
      phoneNumber,
      userName,
      isFirstLogin,
    });
  }

  /**
   * Internal method to send email (actual implementation)
   */
  async _sendEmailInternal({ userEmail, userName, isFirstLogin = true }) {
    try {
      const portalUrl =
        process.env.STUDENT_PORTAL_URL || "https://applicant.iuea.ac.ug";

      const subject = isFirstLogin
        ? "Welcome to IUEA Application Portal!"
        : "Welcome Back to IUEA Application Portal!";
      const welcomeMessage = isFirstLogin
        ? "Thank you for joining the International University of East Africa (IUEA) community! We're excited to have you as part of our academic family."
        : "Welcome back! We're glad to see you again in the IUEA Application Portal.";

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to IUEA Application Portal</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 30px; border-radius: 10px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <img src="https://nyotatranslate.com/iuea-Logo.png" alt="IUEA - International University of East Africa" style="max-width: 200px; height: auto; margin-bottom: 15px;" />
              <h2 style="color: #7a0000; margin: 0; font-size: 24px;">Application Portal</h2>
            </div>
            
            <div style="background-color: white; padding: 30px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #7a0000; margin-top: 0;">Dear ${userName},</h2>
              <p style="font-size: 16px; margin-bottom: 20px;">${welcomeMessage}</p>
              
              <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="color: #333; margin-top: 0;">Your Application Portal Features:</h3>
                <ul style="color: #666; line-height: 1.8;">
                  <li>📝 Submit and track your applications</li>
                  <li>📊 View application status and progress</li>
                  <li>📅 Check important deadlines and dates</li>
                  <li>💬 Connect with AI-powered admission support</li>
                  <li>📄 Upload required documents and transcripts</li>
                  <li>📞 Contact admissions and support staff</li>
                </ul>
              </div>

              ${
                isFirstLogin
                  ? `
              <div style="background-color: #d4edda; border-left: 4px solid #28a745; padding: 20px; border-radius: 5px; margin: 20px 0;">
                <h4 style="color: #155724; margin-top: 0;">Getting Started:</h4>
                <ol style="color: #155724; line-height: 1.6;">
                  <li>Complete your application profile</li>
                  <li>Upload required documents</li>
                  <li>Submit your course applications</li>
                  <li>Track your application status</li>
                </ol>
              </div>
              `
                  : ""
              }

              <div style="text-align: center; margin: 30px 0;">
                <a href="${portalUrl}/" 
                   style="background-color: #7a0000; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; display: inline-block;">
                  Access Application Portal
                </a>
              </div>

              <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h4 style="color: #856404; margin-top: 0;">Need Help?</h4>
                <p style="color: #856404; margin-bottom: 10px;">Our admissions team is here to assist you:</p>
                <ul style="color: #856404; margin-bottom: 0;">
                  <li>📧 Email: apply@iuea.ac.ug</li>
                  <li>📞 Phone: +256 790 002 000</li>
                  <li>💬 WhatsApp: +256 790 002 000</li>
                  <li>🌐 Website: www.iuea.ac.ug</li>
                </ul>
              </div>
            </div>

            <div style="text-align: center; color: #666; font-size: 14px;">
              <p>Best regards,<br>
              <strong>IUEA Admissions Team</strong><br>
              International University of East Africa</p>
              
              <p style="margin-top: 20px;">
                <em>Learning to succeed.</em>
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      const textContent = `
Welcome to IUEA Application Portal

Dear ${userName},

${welcomeMessage}

Your Application Portal Features:
• Submit and track your applications
• View application status and progress
• Check important deadlines and dates
• Connect with AI-powered admission support
• Upload required documents and transcripts
• Contact admissions and support staff

${
  isFirstLogin
    ? `
Getting Started:
1. Complete your application profile
2. Upload required documents
3. Submit your course applications
4. Track your application status
`
    : ""
}

Access your Application Portal: ${portalUrl}/

Need Help?
Email: apply@iuea.ac.ug
Phone: +256 790 002 000
WhatsApp: +256 790 002 000
Website: www.iuea.ac.ug

Best regards,
IUEA Admissions Team
International University of East Africa

Learning to succeed.
      `;

      const emailOptions = {
        to: userEmail,
        subject: subject,
        html: htmlContent,
        text: textContent,
      };

      const result = await emailService.sendEmail(emailOptions);
      return result;
    } catch (error) {
      logger.error("Welcome email service error:", error);
      return {
        success: false,
        error: error.message || "Failed to send welcome email",
        provider: "unknown",
        skipped: false,
      };
    }
  }

  /**
   * Internal method to send WhatsApp (actual implementation)
   */
  async _sendWhatsAppInternal({ phoneNumber, userName, isFirstLogin = true }) {
    try {
      const portalUrl =
        process.env.STUDENT_PORTAL_URL || "https://applicant.iuea.ac.ug";

      if (isFirstLogin) {
        // For first login, use the whatsapp_validation template
        const templatePayload = {
          messaging_product: "whatsapp",
          to: phoneNumber.replace(/[^\d]/g, ""), // Clean phone number
          type: "template",
          template: {
            name: "whatsapp_validation",
            language: {
              code: "en_US",
            },
          },
        };

        const templateResult =
          await this.whatsappMessageService.sendTemplateMessage(
            phoneNumber.replace(/[^\d]/g, ""),
            templatePayload,
            {
              contactName: userName,
              validationType: "welcome",
              automated: true,
            }
          );

        // Wait 2 seconds before sending the second message
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Second message: Custom message for application completion
        const customMessage = `Hi ${userName}! 👋

Your IUEA Application Portal account is ready. Please complete your application:

📝 Complete your profile
📄 Upload required documents  
🎓 Submit course applications

Portal: ${portalUrl}/

Need help? We're here to assist! 📞`;

        const secondResult = await this.conversationService.sendMessage(
          phoneNumber,
          customMessage,
          null, // leadId
          userName, // contactName
          false, // isAI
          true // automated
        );

        // Return success if at least one message was sent successfully
        if (templateResult.success || secondResult.success) {
          return {
            success: true,
            messageId:
              secondResult.whatsappMessageId ||
              secondResult.messageId ||
              templateResult.messageId,
            message: "Welcome WhatsApp messages sent successfully",
            details: {
              templateMessage: templateResult.success,
              customMessage: secondResult.success,
            },
          };
        } else {
          return {
            success: false,
            error: `Failed to send WhatsApp messages. Template: ${templateResult.error}, Custom: ${secondResult.error}`,
          };
        }
      } else {
        // For returning users, send a simple welcome back message
        const welcomeBackMessage = `Welcome back, ${userName}! 👋

Your IUEA Application Portal is ready for you.

Continue your application process:
Portal: ${portalUrl}/

Questions? Contact our admissions team! 📞`;

        const result = await this.conversationService.sendMessage(
          phoneNumber,
          welcomeBackMessage,
          null, // leadId
          userName, // contactName
          false, // isAI
          true // automated
        );

        return {
          success: result.success,
          messageId: result.whatsappMessageId || result.messageId,
          message: result.success
            ? "Welcome back message sent successfully"
            : "Failed to send welcome back message",
          error: result.success ? undefined : result.error,
        };
      }
    } catch (error) {
      logger.error("Welcome WhatsApp service error:", error);
      return {
        success: false,
        error: error.message || "Failed to send welcome WhatsApp messages",
      };
    }
  }
}

module.exports = new WelcomeService();
