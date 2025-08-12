const nodemailer = require("nodemailer");
const logger = require("../utils/logger");

// Use production email service if in production environment
if (process.env.NODE_ENV === "production") {
  logger.info("Loading production email service for better reliability");
  module.exports = require("./emailService.production");
} else {
  // Development email service
  class EmailService {
    constructor() {
      this.transporter = null;
      this.initializeTransporter();
    }

    initializeTransporter() {
      try {
        // Primary configuration with extended timeouts for production
        const primaryConfig = {
          service: "gmail",
          host: "smtp.gmail.com",
          port: 587,
          secure: false, // true for 465, false for other ports
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_APP_PASSWORD,
          },
          tls: {
            rejectUnauthorized: false,
          },
          // Extended timeouts for production environments
          connectionTimeout: 60000, // 60 seconds
          socketTimeout: 60000, // 60 seconds
          greetingTimeout: 30000, // 30 seconds
          // Connection pool settings
          pool: true,
          maxConnections: 5,
          maxMessages: 100,
          // Retry settings
          retry: {
            attempts: 3,
            delay: 3000,
          },
        };

        // Fallback configuration using port 465 (SSL)
        this.fallbackConfig = {
          service: "gmail",
          host: "smtp.gmail.com",
          port: 465,
          secure: true, // true for 465, false for other ports
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_APP_PASSWORD,
          },
          tls: {
            rejectUnauthorized: false,
          },
          connectionTimeout: 60000,
          socketTimeout: 60000,
          greetingTimeout: 30000,
          pool: true,
          maxConnections: 5,
          maxMessages: 100,
        };

        this.transporter = nodemailer.createTransport(primaryConfig);

        // Verify connection configuration with timeout
        const verifyPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Connection verification timeout"));
          }, 30000); // 30 second timeout

          this.transporter.verify((error, success) => {
            clearTimeout(timeout);
            if (error) {
              reject(error);
            } else {
              resolve(success);
            }
          });
        });

        verifyPromise
          .then(() => {
            logger.info(
              "Email service ready to send messages (Primary config)"
            );
          })
          .catch((error) => {
            logger.error(
              "Primary email service connection failed, will use fallback:",
              error
            );
            // Don't immediately switch to fallback, let individual sends handle it
          });
      } catch (error) {
        logger.error("Failed to initialize email transporter:", error);
      }
    }

    async sendEmail(emailOptions) {
      const maxRetries = 3;
      let lastError;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
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

          logger.info(
            `Attempting to send email (attempt ${attempt}/${maxRetries}) to ${to}`
          );

          // Add timeout to the send operation
          const sendPromise = this.transporter.sendMail(mailOptions);
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error("Email send operation timeout")),
              45000
            ); // 45 second timeout
          });

          const result = await Promise.race([sendPromise, timeoutPromise]);

          logger.info(
            `Email sent successfully to ${to} on attempt ${attempt}`,
            {
              messageId: result.messageId,
            }
          );

          return {
            success: true,
            messageId: result.messageId,
            response: result.response,
          };
        } catch (error) {
          lastError = error;
          logger.error(`Email send attempt ${attempt} failed:`, error);

          // If this is a connection timeout or connection error, try fallback config
          if (
            (error.code === "ETIMEDOUT" ||
              error.code === "ECONNECTION" ||
              error.message.includes("timeout")) &&
            attempt === 2
          ) {
            logger.info("Switching to fallback email configuration (port 465)");
            try {
              this.transporter = nodemailer.createTransport(
                this.fallbackConfig
              );
            } catch (fallbackError) {
              logger.error(
                "Failed to switch to fallback configuration:",
                fallbackError
              );
            }
          }

          // If this is the last attempt, throw the error
          if (attempt === maxRetries) {
            break;
          }

          // Wait before retrying (exponential backoff)
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          logger.info(`Waiting ${delay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      throw new Error(
        `Email sending failed after ${maxRetries} attempts: ${lastError.message}`
      );
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
}
