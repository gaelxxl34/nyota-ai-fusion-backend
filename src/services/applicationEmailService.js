const emailService = require("./emailService");
const logger = require("../utils/logger");

class ApplicationEmailService {
  /**
   * Send application status change notification to applicant
   * @param {Object} applicationData - Application data
   * @param {string} applicationData.applicantEmail - Applicant's email
   * @param {string} applicationData.applicantName - Applicant's name
   * @param {string} applicationData.courseName - Course name
   * @param {string} applicationData.status - New status (pending, approved, rejected, interview_scheduled, etc.)
   * @param {string} applicationData.additionalInfo - Additional information or comments
   */
  async sendStatusChangeNotification(applicationData) {
    try {
      const {
        applicantEmail,
        applicantName,
        courseName,
        status,
        additionalInfo,
        interviewDate,
        interviewTime,
        interviewLocation,
      } = applicationData;

      const statusMessages = {
        applied: {
          subject: "Application Received - Thank You for Applying!",
          message:
            "Thank you for applying! Your application has been received and is being processed.",
          style: "background-color: #007bff; color: white;",
        },
        APPLIED: {
          subject: "Application Received - Thank You for Applying!",
          message:
            "Thank you for applying! Your application has been received and is being processed.",
          style: "background-color: #007bff; color: white;",
        },
        IN_REVIEW: {
          subject: "Application Received - Under Review",
          message:
            "Your application has been received and is currently under review.",
          style: "background-color: #ffc107; color: #000;",
        },
        QUALIFIED: {
          subject: "Congratulations! Application Qualified",
          message: "Congratulations! Your application has been qualified.",
          style: "background-color: #28a745; color: white;",
        },
        APPROVED: {
          subject: "Congratulations! Application Approved",
          message: "Congratulations! Your application has been approved.",
          style: "background-color: #28a745; color: white;",
        },
        REJECTED: {
          subject: "Application Status Update",
          message:
            "We regret to inform you that your application was not successful at this time.",
          style: "background-color: #dc3545; color: white;",
        },
        DOCUMENTS_REQUIRED: {
          subject: "Additional Documents Required",
          message:
            "Additional documents are required to complete your application.",
          style: "background-color: #fd7e14; color: white;",
        },
        ON_HOLD: {
          subject: "Application On Hold",
          message: "Your application is currently on hold.",
          style: "background-color: #6c757d; color: white;",
        },
      };

      const statusInfo = statusMessages[status] ||
        statusMessages[status.toUpperCase()] || {
          subject: "Application Status Update",
          message: `Your application status has been updated to: ${status}`,
          style: "background-color: #007bff; color: white;",
        };

      // Build HTML email content
      let htmlContent = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="text-align: center; margin-bottom: 30px;">
                        <h1 style="color: #333; margin-bottom: 10px;">IUEA - International University of East Africa</h1>
                        <p style="color: #666; margin: 0;">Application Status Update</p>
                    </div>
                    
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <h2 style="color: #333; margin-top: 0;">Dear ${applicantName},</h2>
                        <p style="color: #666; line-height: 1.6;">
                            We are writing to inform you about an update regarding your application for 
                            <strong>${courseName}</strong>.
                        </p>
                    </div>

                    <div style="text-align: center; margin: 30px 0;">
                        <div style="display: inline-block; padding: 15px 30px; border-radius: 5px; ${
                          statusInfo.style
                        }">
                            <h3 style="margin: 0; font-size: 18px;">Status: ${status.toUpperCase()}</h3>
                        </div>
                    </div>

                    <div style="background-color: #ffffff; border: 1px solid #dee2e6; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <p style="color: #333; line-height: 1.6; margin-bottom: 15px;">
                            ${statusInfo.message}
                        </p>
            `;

      // Add status-specific content
      if (
        status === "QUALIFIED" ||
        status === "APPROVED" ||
        status === "ADMITTED" ||
        status === "ENROLLED"
      ) {
        htmlContent += `
                        <div style="background-color: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px; margin: 15px 0;">
                            <h4 style="color: #155724; margin-top: 0;">Next Steps:</h4>
                            <ul style="color: #155724; margin-bottom: 0;">
                                <li>You will receive admission documents within 3-5 business days</li>
                                <li>Payment instructions will be provided separately</li>
                                <li>Please check your email regularly for further communication</li>
                                <li>Access your application portal for updates and documents</li>
                            </ul>
                        </div>
                `;
      }

      if (status === "DOCUMENTS_REQUIRED") {
        htmlContent += `
                        <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 15px 0;">
                            <h4 style="color: #856404; margin-top: 0;">Required Actions:</h4>
                            <p style="color: #856404; margin-bottom: 0;">
                                Please submit the required documents as soon as possible to avoid delays in processing your application.
                            </p>
                        </div>
                `;
      }

      if (additionalInfo) {
        htmlContent += `
                        <div style="border-left: 4px solid #007bff; padding-left: 15px; margin: 15px 0;">
                            <h4 style="color: #007bff; margin-top: 0;">Additional Information:</h4>
                            <p style="color: #333; margin-bottom: 0;">${additionalInfo}</p>
                        </div>
                `;
      }

      htmlContent += `
                    </div>

                    <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #007bff; border-radius: 8px;">
                        <h4 style="color: white; margin-top: 0;">🎓 Application Portal Access</h4>
                        <p style="color: white; margin-bottom: 15px;">Track your application status, upload documents, and access important updates</p>
                        <a href="https://applicant.iuea.ac.ug/" style="background-color: white; color: #007bff; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; display: inline-block;">Access Application Portal</a>
                    </div>

                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 30px;">
                        <h4 style="color: #333; margin-top: 0;">Need Help?</h4>
                        <p style="color: #666; margin-bottom: 10px;">
                            If you have any questions about your application, please don't hesitate to contact us:
                        </p>
                        <ul style="color: #666; margin-bottom: 0;">
                            <li>Email: apply@iuea.ac.ug</li>
                            <li>Phone: +256 790 002 000</li>
                            <li>Website: www.iuea.ac.ug</li>
                            <li>Application Portal: <a href="https://applicant.iuea.ac.ug/" style="color: #007bff;">https://applicant.iuea.ac.ug/</a></li>
                        </ul>
                    </div>

                    <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
                        <p style="color: #666; font-size: 14px; margin: 0;">
                            Best regards,<br>
                            <strong>IUEA Admissions Team</strong><br>
                            International University of East Africa
                        </p>
                    </div>
                </div>
            `;

      // Text version for email clients that don't support HTML
      let textContent = `
IUEA - International University of East Africa
Application Status Update

Dear ${applicantName},

We are writing to inform you about an update regarding your application for ${courseName}.

STATUS: ${status.toUpperCase()}

${statusInfo.message}
            `;

      if (
        status === "QUALIFIED" ||
        status === "APPROVED" ||
        status === "ADMITTED" ||
        status === "ENROLLED"
      ) {
        textContent += `

Next Steps:
- You will receive admission documents within 3-5 business days
- Payment instructions will be provided separately
- Please check your email regularly for further communication
- Access your application portal for updates and documents
                `;
      }

      if (additionalInfo) {
        textContent += `

Additional Information:
${additionalInfo}
                `;
      }

      textContent += `

Application Portal:
Track your application status and access important updates at: https://applicant.iuea.ac.ug/

Need Help?
If you have any questions about your application, please contact us:
- Email: apply@iuea.ac.ug
- Phone: +256 790 002 000
- Website: www.iuea.ac.ug
- Application Portal: https://applicant.iuea.ac.ug/

Best regards,
IUEA Admissions Team
International University of East Africa
            `;

      const emailOptions = {
        to: applicantEmail,
        subject: `${statusInfo.subject} - ${courseName}`,
        html: htmlContent,
        text: textContent,
      };

      const result = await emailService.sendEmail(emailOptions);

      if (result.success) {
        logger.info(
          `✅ Status change email sent successfully to ${applicantEmail}`,
          {
            applicantEmail,
            status,
            courseName,
            messageId: result.messageId,
            provider: result.provider,
          }
        );
      } else if (result.skipped) {
        logger.warn(
          `Email service not available, status notification skipped`,
          {
            applicantEmail,
            status,
            courseName,
            reason: result.error,
          }
        );
      } else {
        logger.error(`Failed to send application status email`, {
          applicantEmail,
          status,
          courseName,
          error: result.error,
          provider: result.provider,
        });
      }

      return result;
    } catch (error) {
      logger.error("Failed to send application status email:", error);
      // Return a failed result instead of throwing to allow graceful degradation
      return {
        success: false,
        error: error.message,
        provider: "unknown",
        skipped: false,
      };
    }
  }

  /**
   * Send bulk status notifications to multiple applicants
   * @param {Array} applications - Array of application data objects
   */
  async sendBulkStatusNotifications(applications) {
    const results = [];
    const errors = [];

    for (const app of applications) {
      try {
        const result = await this.sendStatusChangeNotification(app);
        results.push({ success: true, email: app.applicantEmail, result });
      } catch (error) {
        errors.push({
          success: false,
          email: app.applicantEmail,
          error: error.message,
        });
        logger.error(`Failed to send email to ${app.applicantEmail}:`, error);
      }
    }

    return {
      successful: results,
      failed: errors,
      totalSent: results.length,
      totalFailed: errors.length,
    };
  }

  /**
   * Send payment reminder email
   * @param {Object} paymentData - Payment information
   */
  async sendPaymentReminder(paymentData) {
    try {
      const {
        applicantEmail,
        applicantName,
        courseName,
        amountDue,
        dueDate,
        paymentInstructions,
      } = paymentData;

      const emailOptions = {
        to: applicantEmail,
        subject: `Payment Reminder - ${courseName}`,
        html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="text-align: center; margin-bottom: 30px;">
                        <h1 style="color: #333; margin-bottom: 10px;">IUEA - International University of East Africa</h1>
                        <p style="color: #666; margin: 0;">Payment Reminder</p>
                    </div>
                    <h2 style="color: #333;">Payment Reminder</h2>
                    <p>Dear ${applicantName},</p>
                    <p>This is a friendly reminder that your payment for <strong>${courseName}</strong> is due.</p>
                    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <h3 style="color: #007bff; margin-top: 0;">Payment Details:</h3>
                        <ul>
                            <li><strong>Amount Due:</strong> ${amountDue}</li>
                            <li><strong>Due Date:</strong> ${dueDate}</li>
                        </ul>
                    </div>
                    ${
                      paymentInstructions
                        ? `<p><strong>Payment Instructions:</strong><br>${paymentInstructions}</p>`
                        : ""
                    }
                    <p>Please ensure payment is made by the due date to secure your admission.</p>
                    
                    <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #007bff; border-radius: 8px;">
                        <h4 style="color: white; margin-top: 0;">💳 Make Payment Online</h4>
                        <p style="color: white; margin-bottom: 15px;">Access your application portal to view payment options and track your payment status</p>
                        <a href="https://applicant.iuea.ac.ug/" style="background-color: white; color: #007bff; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; display: inline-block;">Application Portal</a>
                    </div>
                    
                    <br>
                    <p>Best regards,<br>IUEA Finance Department</p>
                </div>
            `,
        text: `Payment Reminder\n\nDear ${applicantName},\n\nThis is a friendly reminder that your payment for ${courseName} is due.\n\nAmount Due: ${amountDue}\nDue Date: ${dueDate}\n\n${
          paymentInstructions
            ? `Payment Instructions: ${paymentInstructions}\n\n`
            : ""
        }Please ensure payment is made by the due date to secure your admission.\n\nFor payment options and to track your payment status, visit our application portal: https://applicant.iuea.ac.ug/\n\nBest regards,\nIUEA Finance Department`,
      };

      const result = await emailService.sendEmail(emailOptions);

      if (result.success) {
        logger.info(
          `✅ Payment reminder email sent successfully to ${applicantEmail}`,
          {
            applicantEmail,
            courseName,
            messageId: result.messageId,
            provider: result.provider,
          }
        );
      } else if (result.skipped) {
        logger.warn(`Email service not available, payment reminder skipped`, {
          applicantEmail,
          courseName,
          reason: result.error,
        });
      } else {
        logger.error(`Failed to send payment reminder email`, {
          applicantEmail,
          courseName,
          error: result.error,
          provider: result.provider,
        });
      }

      return result;
    } catch (error) {
      logger.error("Failed to send payment reminder email:", error);
      // Return a failed result instead of throwing to allow graceful degradation
      return {
        success: false,
        error: error.message,
        provider: "unknown",
        skipped: false,
      };
    }
  }
}

module.exports = new ApplicationEmailService();
