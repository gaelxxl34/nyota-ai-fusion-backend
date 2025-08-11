const nodemailer = require("nodemailer");
const logger = require("../utils/logger");

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  initializeTransporter() {
    try {
      this.transporter = nodemailer.createTransport({
        service: "gmail",
        host: "smtp.gmail.com",
        port: 587,
        secure: false, // true for 465, false for other ports
        auth: {
          user: process.env.EMAIL_USER, // your iuea.ac.ug email
          pass: process.env.EMAIL_APP_PASSWORD, // App password from Google
        },
        tls: {
          rejectUnauthorized: false,
        },
      });

      // Verify connection configuration
      this.transporter.verify((error, success) => {
        if (error) {
          logger.error("Email service connection failed:", error);
        } else {
          logger.info("Email service ready to send messages");
        }
      });
    } catch (error) {
      logger.error("Failed to initialize email transporter:", error);
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

      const mailOptions = {
        from: {
          name: "IUEA Nyota AI System",
          address: process.env.EMAIL_USER,
        },
        to,
        subject,
        text,
        html,
        attachments,
        cc,
        bcc,
      };

      const result = await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent successfully to ${to}`, {
        messageId: result.messageId,
      });
      return {
        success: true,
        messageId: result.messageId,
        response: result.response,
      };
    } catch (error) {
      logger.error("Failed to send email:", error);
      throw new Error(`Email sending failed: ${error.message}`);
    }
  }

  // Predefined email templates for common notifications
  async sendWelcomeEmail(userEmail, userName) {
    const emailOptions = {
      to: userEmail,
      subject: "Welcome to IUEA Nyota AI System",
      html: `
                <h2>Welcome to IUEA Nyota AI System</h2>
                <p>Dear ${userName},</p>
                <p>Welcome to the IUEA Nyota AI System. Your account has been successfully created.</p>
                <p>You can now access the system and explore its features.</p>
                <br>
                <p>Best regards,<br>
                IUEA Nyota AI Team</p>
            `,
      text: `Welcome to IUEA Nyota AI System\n\nDear ${userName},\n\nWelcome to the IUEA Nyota AI System. Your account has been successfully created.\n\nYou can now access the system and explore its features.\n\nBest regards,\nIUEA Nyota AI Team`,
    };

    return await this.sendEmail(emailOptions);
  }

  async sendPasswordResetEmail(userEmail, resetToken, userName) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    const emailOptions = {
      to: userEmail,
      subject: "Password Reset Request - IUEA Nyota AI",
      html: `
                <h2>Password Reset Request</h2>
                <p>Dear ${userName},</p>
                <p>You have requested to reset your password for your IUEA Nyota AI account.</p>
                <p>Click the link below to reset your password:</p>
                <p><a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
                <p>If the button doesn't work, copy and paste this link into your browser:</p>
                <p>${resetUrl}</p>
                <p>This link will expire in 1 hour for security reasons.</p>
                <p>If you didn't request this password reset, please ignore this email.</p>
                <br>
                <p>Best regards,<br>
                IUEA Nyota AI Team</p>
            `,
      text: `Password Reset Request\n\nDear ${userName},\n\nYou have requested to reset your password for your IUEA Nyota AI account.\n\nClick this link to reset your password: ${resetUrl}\n\nThis link will expire in 1 hour for security reasons.\n\nIf you didn't request this password reset, please ignore this email.\n\nBest regards,\nIUEA Nyota AI Team`,
    };

    return await this.sendEmail(emailOptions);
  }

  async sendApplicationStatusEmail(
    userEmail,
    userName,
    applicationStatus,
    courseName
  ) {
    const emailOptions = {
      to: userEmail,
      subject: `Application Status Update - ${courseName}`,
      html: `
                <h2>Application Status Update</h2>
                <p>Dear ${userName},</p>
                <p>Your application status for <strong>${courseName}</strong> has been updated.</p>
                <p><strong>Current Status:</strong> ${applicationStatus}</p>
                ${
                  applicationStatus.toLowerCase() === "approved"
                    ? "<p>Congratulations! Your application has been approved. You will receive further instructions soon.</p>"
                    : applicationStatus.toLowerCase() === "rejected"
                    ? "<p>We regret to inform you that your application was not successful at this time.</p>"
                    : "<p>Your application is currently under review. We will notify you of any updates.</p>"
                }
                <br>
                <p>Best regards,<br>
                IUEA Admissions Team</p>
            `,
      text: `Application Status Update\n\nDear ${userName},\n\nYour application status for ${courseName} has been updated.\n\nCurrent Status: ${applicationStatus}\n\n${
        applicationStatus.toLowerCase() === "approved"
          ? "Congratulations! Your application has been approved. You will receive further instructions soon."
          : applicationStatus.toLowerCase() === "rejected"
          ? "We regret to inform you that your application was not successful at this time."
          : "Your application is currently under review. We will notify you of any updates."
      }\n\nBest regards,\nIUEA Admissions Team`,
    };

    return await this.sendEmail(emailOptions);
  }

  async sendLeadNotificationEmail(adminEmail, leadData) {
    const emailOptions = {
      to: adminEmail,
      subject: "New Lead Generated - IUEA Nyota AI",
      html: `
                <h2>New Lead Generated</h2>
                <p>A new lead has been generated through the IUEA Nyota AI system:</p>
                <ul>
                    <li><strong>Name:</strong> ${leadData.name}</li>
                    <li><strong>Email:</strong> ${leadData.email}</li>
                    <li><strong>Phone:</strong> ${
                      leadData.phone || "Not provided"
                    }</li>
                    <li><strong>Interest:</strong> ${
                      leadData.interest || "General inquiry"
                    }</li>
                    <li><strong>Generated:</strong> ${new Date().toLocaleString()}</li>
                </ul>
                <p>Please follow up with this lead as soon as possible.</p>
                <br>
                <p>Best regards,<br>
                IUEA Nyota AI System</p>
            `,
      text: `New Lead Generated\n\nA new lead has been generated through the IUEA Nyota AI system:\n\nName: ${
        leadData.name
      }\nEmail: ${leadData.email}\nPhone: ${
        leadData.phone || "Not provided"
      }\nInterest: ${
        leadData.interest || "General inquiry"
      }\nGenerated: ${new Date().toLocaleString()}\n\nPlease follow up with this lead as soon as possible.\n\nBest regards,\nIUEA Nyota AI System`,
    };

    return await this.sendEmail(emailOptions);
  }
}

module.exports = new EmailService();
