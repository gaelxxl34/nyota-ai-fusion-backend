const sgMail = require("@sendgrid/mail");
const logger = require("../utils/logger");

class SendGridEmailService {
  constructor() {
    this.initializeSendGrid();
  }

  initializeSendGrid() {
    try {
      if (!process.env.SENDGRID_API_KEY) {
        throw new Error("SendGrid API key not found in environment variables");
      }

      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      logger.info("SendGrid email service initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize SendGrid:", error);
      throw error;
    }
  }

  async sendEmail(emailOptions) {
    try {
      const {
        to,
        subject,
        text,
        html,
        attachments = [],
        cc,
        bcc,
      } = emailOptions;

      const msg = {
        to: to,
        from: {
          email: "gongoriko10@gmail.com",
          name: "IUEA Admissions Office",
        },
        replyTo: {
          email: "gongoriko10@gmail.com",
          name: "IUEA Admissions Office",
        },
        subject: subject,
        text: text,
        html: html,
      };

      // Add optional fields if provided
      if (cc) msg.cc = cc;
      if (bcc) msg.bcc = bcc;

      // Handle attachments if provided
      if (attachments && attachments.length > 0) {
        msg.attachments = attachments.map((attachment) => ({
          content: attachment.content,
          filename: attachment.filename,
          type: attachment.contentType || "application/octet-stream",
          disposition: "attachment",
        }));
      }

      logger.info(`Sending email via SendGrid to ${to}`);

      const result = await sgMail.send(msg);

      logger.info(`Email sent successfully via SendGrid to ${to}`, {
        messageId: result[0].headers["x-message-id"],
        statusCode: result[0].statusCode,
      });

      return {
        success: true,
        messageId: result[0].headers["x-message-id"],
        response: result[0].statusCode,
        provider: "sendgrid",
      };
    } catch (error) {
      logger.error("SendGrid email sending failed:", {
        error: error.message,
        code: error.code,
        to: emailOptions.to,
        subject: emailOptions.subject,
      });

      // If SendGrid fails, log the error details
      if (error.response) {
        logger.error("SendGrid API Response:", error.response.body);
      }

      throw new Error(`SendGrid email sending failed: ${error.message}`);
    }
  }

  // Predefined email templates for common notifications
  async sendWelcomeEmail(userEmail, userName) {
    const emailOptions = {
      to: userEmail,
      subject: "Welcome to IUEA Nyota AI System",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to IUEA Nyota AI</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 30px; border-radius: 10px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #7a0000; margin-bottom: 5px;">International University of East Africa</h1>
              <p style="color: #666; margin: 0; font-size: 14px;">Ggaba Street, Kansanga, Kampala, Uganda</p>
            </div>
            <h2 style="color: #7a0000; margin-bottom: 20px;">Welcome to IUEA Nyota AI System</h2>
            <p style="font-size: 16px;">Dear <strong>${userName}</strong>,</p>
            <p style="font-size: 16px;">Welcome to the IUEA Nyota AI System. Your account has been successfully created and you're now part of our innovative educational platform.</p>
            <p style="font-size: 16px;">You can now access the system and explore its features to enhance your educational journey.</p>
            <div style="margin: 30px 0; padding: 20px; background-color: #f8f9fa; border-left: 4px solid #7a0000; border-radius: 5px;">
              <p style="margin: 0; font-size: 16px; font-weight: bold; color: #7a0000;">What's Next?</p>
              <p style="margin: 10px 0 0 0;">Log in to your account and start exploring the AI-powered features designed to support your academic success.</p>
            </div>
            <p style="font-size: 16px;">If you have any questions or need assistance, feel free to reach out to our support team at <a href="mailto:info@iuea.ac.ug" style="color: #7a0000;">info@iuea.ac.ug</a>.</p>
            <br>
            <p style="font-size: 16px;">Best regards,<br>
            <strong>IUEA Nyota AI Team</strong><br>
            <span style="font-size: 14px; color: #666;">International University of East Africa</span></p>
          </div>
        </body>
        </html>
      `,
      text: `International University of East Africa
Ggaba Street, Kansanga, Kampala, Uganda

Welcome to IUEA Nyota AI System

Dear ${userName},

Welcome to the IUEA Nyota AI System. Your account has been successfully created and you're now part of our innovative educational platform.

You can now access the system and explore its features to enhance your educational journey.

What's Next?
Log in to your account and start exploring the AI-powered features designed to support your academic success.

If you have any questions or need assistance, feel free to reach out to our support team at info@iuea.ac.ug.

Best regards,
IUEA Nyota AI Team
International University of East Africa`,
    };

    return await this.sendEmail(emailOptions);
  }

  async sendPasswordResetEmail(userEmail, resetToken, userName) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    const emailOptions = {
      to: userEmail,
      subject: "Password Reset Request - IUEA Nyota AI",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset Request</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 30px; border-radius: 10px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #7a0000; margin-bottom: 5px;">International University of East Africa</h1>
              <p style="color: #666; margin: 0; font-size: 14px;">Ggaba Street, Kansanga, Kampala, Uganda</p>
            </div>
            <h2 style="color: #dc3545; margin-bottom: 20px;">Password Reset Request</h2>
            <p style="font-size: 16px;">Dear <strong>${userName}</strong>,</p>
            <p style="font-size: 16px;">You have requested to reset your password for your IUEA Nyota AI account.</p>
            <p style="font-size: 16px;">Click the button below to reset your password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="background-color: #7a0000; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; display: inline-block;">Reset Password</a>
            </div>
            <p style="font-size: 14px; color: #666;">If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="font-size: 14px; color: #7a0000; word-break: break-all;">${resetUrl}</p>
            <div style="margin: 30px 0; padding: 20px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 5px;">
              <p style="margin: 0; font-size: 14px; color: #856404;"><strong>Security Notice:</strong> This link will expire in 1 hour for security reasons.</p>
            </div>
            <p style="font-size: 16px;">If you didn't request this password reset, please ignore this email and your password will remain unchanged.</p>
            <p style="font-size: 16px;">For any assistance, contact us at <a href="mailto:info@iuea.ac.ug" style="color: #7a0000;">info@iuea.ac.ug</a>.</p>
            <br>
            <p style="font-size: 16px;">Best regards,<br>
            <strong>IUEA Nyota AI Team</strong><br>
            <span style="font-size: 14px; color: #666;">International University of East Africa</span></p>
          </div>
        </body>
        </html>
      `,
      text: `International University of East Africa
Ggaba Street, Kansanga, Kampala, Uganda

Password Reset Request

Dear ${userName},

You have requested to reset your password for your IUEA Nyota AI account.

Click this link to reset your password: ${resetUrl}

Security Notice: This link will expire in 1 hour for security reasons.

If you didn't request this password reset, please ignore this email and your password will remain unchanged.

For any assistance, contact us at info@iuea.ac.ug.

Best regards,
IUEA Nyota AI Team
International University of East Africa`,
    };

    return await this.sendEmail(emailOptions);
  }

  async sendApplicationStatusEmail(
    userEmail,
    userName,
    applicationStatus,
    courseName
  ) {
    const statusColor =
      applicationStatus.toLowerCase() === "approved"
        ? "#28a745"
        : applicationStatus.toLowerCase() === "rejected"
        ? "#dc3545"
        : "#ffc107";

    const statusMessage =
      applicationStatus.toLowerCase() === "approved"
        ? "Congratulations! Your application has been approved. You will receive further instructions soon."
        : applicationStatus.toLowerCase() === "rejected"
        ? "We regret to inform you that your application was not successful at this time. We encourage you to consider other programs or reapply in the future."
        : "Your application is currently under review. We will notify you of any updates as soon as possible.";

    const emailOptions = {
      to: userEmail,
      subject: `Application Status Update - ${courseName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Application Status Update</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 30px; border-radius: 10px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #7a0000; margin-bottom: 5px;">International University of East Africa</h1>
              <p style="color: #666; margin: 0; font-size: 14px;">Ggaba Street, Kansanga, Kampala, Uganda</p>
            </div>
            <h2 style="color: ${statusColor}; margin-bottom: 20px;">Application Status Update</h2>
            <p style="font-size: 16px;">Dear <strong>${userName}</strong>,</p>
            <p style="font-size: 16px;">Your application status for <strong>${courseName}</strong> has been updated.</p>
            <div style="margin: 20px 0; padding: 20px; background-color: white; border-left: 4px solid ${statusColor}; border-radius: 5px;">
              <p style="margin: 0; font-size: 18px; font-weight: bold; color: ${statusColor};">Current Status: ${applicationStatus.toUpperCase()}</p>
            </div>
            <p style="font-size: 16px;">${statusMessage}</p>
            ${
              applicationStatus.toLowerCase() === "approved"
                ? '<div style="margin: 30px 0; padding: 20px; background-color: #d4edda; border-left: 4px solid #28a745; border-radius: 5px;"><p style="margin: 0; font-size: 16px; color: #155724;">Next Steps: Please check your email regularly for enrollment instructions and required documentation.</p></div>'
                : ""
            }
            <p style="font-size: 16px;">If you have any questions about your application status, please don't hesitate to contact our admissions office at <a href="mailto:info@iuea.ac.ug" style="color: #7a0000;">info@iuea.ac.ug</a> or call us at +256 414 373 747.</p>
            <br>
            <p style="font-size: 16px;">Best regards,<br>
            <strong>IUEA Admissions Team</strong><br>
            <span style="font-size: 14px; color: #666;">International University of East Africa</span></p>
          </div>
        </body>
        </html>
      `,
      text: `Application Status Update\n\nDear ${userName},\n\nYour application status for ${courseName} has been updated.\n\nCurrent Status: ${applicationStatus.toUpperCase()}\n\n${statusMessage}\n\n${
        applicationStatus.toLowerCase() === "approved"
          ? "Next Steps: Please check your email regularly for enrollment instructions and required documentation.\n\n"
          : ""
      }If you have any questions about your application status, please don't hesitate to contact our admissions office.\n\nBest regards,\nIUEA Admissions Team`,
    };

    return await this.sendEmail(emailOptions);
  }

  async sendLeadNotificationEmail(adminEmail, leadData) {
    const emailOptions = {
      to: adminEmail,
      subject: "New Lead Generated - IUEA Nyota AI",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New Lead Generated</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 30px; border-radius: 10px;">
            <h2 style="color: #7a0000; margin-bottom: 20px;">🎯 New Lead Generated</h2>
            <p style="font-size: 16px;">A new lead has been generated through the IUEA Nyota AI system:</p>
            <div style="background-color: white; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr style="border-bottom: 1px solid #eee;">
                  <td style="padding: 10px 0; font-weight: bold; width: 30%;">Name:</td>
                  <td style="padding: 10px 0;">${leadData.name}</td>
                </tr>
                <tr style="border-bottom: 1px solid #eee;">
                  <td style="padding: 10px 0; font-weight: bold;">Email:</td>
                  <td style="padding: 10px 0;"><a href="mailto:${
                    leadData.email
                  }" style="color: #7a0000;">${leadData.email}</a></td>
                </tr>
                <tr style="border-bottom: 1px solid #eee;">
                  <td style="padding: 10px 0; font-weight: bold;">Phone:</td>
                  <td style="padding: 10px 0;">${
                    leadData.phone || "Not provided"
                  }</td>
                </tr>
                <tr style="border-bottom: 1px solid #eee;">
                  <td style="padding: 10px 0; font-weight: bold;">Interest:</td>
                  <td style="padding: 10px 0;">${
                    leadData.interest || "General inquiry"
                  }</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; font-weight: bold;">Generated:</td>
                  <td style="padding: 10px 0;">${new Date().toLocaleString()}</td>
                </tr>
              </table>
            </div>
            <div style="margin: 30px 0; padding: 20px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 5px;">
              <p style="margin: 0; font-size: 16px; font-weight: bold; color: #856404;">⚡ Action Required</p>
              <p style="margin: 10px 0 0 0; color: #856404;">Please follow up with this lead as soon as possible to maximize conversion potential.</p>
            </div>
            <br>
            <p style="font-size: 16px;">Best regards,<br>
            <strong>IUEA Nyota AI System</strong></p>
          </div>
        </body>
        </html>
      `,
      text: `New Lead Generated\n\nA new lead has been generated through the IUEA Nyota AI system:\n\nName: ${
        leadData.name
      }\nEmail: ${leadData.email}\nPhone: ${
        leadData.phone || "Not provided"
      }\nInterest: ${
        leadData.interest || "General inquiry"
      }\nGenerated: ${new Date().toLocaleString()}\n\nAction Required: Please follow up with this lead as soon as possible to maximize conversion potential.\n\nBest regards,\nIUEA Nyota AI System`,
    };

    return await this.sendEmail(emailOptions);
  }

  // Additional utility method for sending custom emails
  async sendCustomEmail(to, subject, content, isHtml = true) {
    const emailOptions = {
      to: to,
      subject: subject,
    };

    if (isHtml) {
      emailOptions.html = content;
    } else {
      emailOptions.text = content;
    }

    return await this.sendEmail(emailOptions);
  }

  // Method to verify SendGrid configuration
  async verifyConfiguration() {
    try {
      // Send a test email to verify configuration
      const testResult = await this.sendEmail({
        to: process.env.EMAIL_USER,
        subject: "SendGrid Configuration Test",
        text: "This is a test email to verify SendGrid configuration.",
        html: "<p>This is a test email to verify SendGrid configuration.</p>",
      });

      logger.info("SendGrid configuration verified successfully");
      return { success: true, result: testResult };
    } catch (error) {
      logger.error("SendGrid configuration verification failed:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new SendGridEmailService();
