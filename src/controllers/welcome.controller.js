const welcomeService = require("../services/welcomeService");
const logger = require("../utils/logger");

class WelcomeController {
  /**
   * Send welcome email to a user
   */
  async sendWelcomeEmail(req, res) {
    try {
      const { userEmail, userName, isFirstLogin = true } = req.body;

      // Validation
      if (!userEmail || !userName) {
        return res.status(400).json({
          success: false,
          error: "User email and name are required",
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(userEmail)) {
        return res.status(400).json({
          success: false,
          error: "Invalid email format",
        });
      }

      // Send welcome email
      const result = await welcomeService.sendWelcomeEmail({
        userEmail,
        userName,
        isFirstLogin,
      });

      if (result.success) {
        logger.info(`Welcome email sent successfully to ${userEmail}`, {
          userEmail,
          userName,
          messageId: result.messageId,
          provider: result.provider,
        });

        return res.json({
          success: true,
          message: "Welcome email sent successfully",
          messageId: result.messageId,
          provider: result.provider,
        });
      } else {
        logger.error(`Failed to send welcome email to ${userEmail}`, {
          userEmail,
          userName,
          error: result.error,
          provider: result.provider,
        });

        return res.status(500).json({
          success: false,
          error: result.error || "Failed to send welcome email",
          provider: result.provider,
        });
      }
    } catch (error) {
      logger.error("Welcome email controller error:", error);
      return res.status(500).json({
        success: false,
        error: "Server error while sending welcome email",
      });
    }
  }

  /**
   * Send welcome WhatsApp message to a user
   */
  async sendWelcomeWhatsApp(req, res) {
    try {
      const { phoneNumber, userName, isFirstLogin = true } = req.body;

      // Validation
      if (!phoneNumber || !userName) {
        return res.status(400).json({
          success: false,
          error: "Phone number and user name are required",
        });
      }

      // Validate phone number format (basic validation)
      const cleanPhoneNumber = phoneNumber.replace(/[^\d]/g, "");
      if (cleanPhoneNumber.length < 10) {
        return res.status(400).json({
          success: false,
          error: "Invalid phone number format",
        });
      }

      // Send welcome WhatsApp message
      const result = await welcomeService.sendWelcomeWhatsApp({
        phoneNumber: cleanPhoneNumber,
        userName,
        isFirstLogin,
      });

      if (result.success) {
        logger.info(
          `Welcome WhatsApp message sent successfully to ${phoneNumber}`,
          {
            phoneNumber,
            userName,
            messageId: result.messageId,
          }
        );

        return res.json({
          success: true,
          message: "Welcome WhatsApp message sent successfully",
          messageId: result.messageId,
        });
      } else {
        logger.error(
          `Failed to send welcome WhatsApp message to ${phoneNumber}`,
          {
            phoneNumber,
            userName,
            error: result.error,
          }
        );

        return res.status(500).json({
          success: false,
          error: result.error || "Failed to send welcome WhatsApp message",
        });
      }
    } catch (error) {
      logger.error("Welcome WhatsApp controller error:", error);
      return res.status(500).json({
        success: false,
        error: "Server error while sending welcome WhatsApp message",
      });
    }
  }
}

module.exports = new WelcomeController();
