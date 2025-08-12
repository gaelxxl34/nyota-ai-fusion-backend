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
        in_review: {
          subject: "Application Received - Under Review",
          message:
            "Your application has been received and is currently under review.",
          style: "background-color: #ffc107; color: #000;",
        },
        approved: {
          subject: "Congratulations! Application Approved",
          message: "Congratulations! Your application has been approved.",
          style: "background-color: #28a745; color: white;",
        },
        rejected: {
          subject: "Application Status Update",
          message:
            "We regret to inform you that your application was not successful at this time.",
          style: "background-color: #dc3545; color: white;",
        },
        documents_required: {
          subject: "Additional Documents Required",
          message:
            "Additional documents are required to complete your application.",
          style: "background-color: #fd7e14; color: white;",
        },
        on_hold: {
          subject: "Application On Hold",
          message: "Your application is currently on hold.",
          style: "background-color: #6c757d; color: white;",
        },
      };

      const statusInfo = statusMessages[status.toLowerCase()] || {
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
      if (status.toLowerCase() === "approved") {
        htmlContent += `
                        <div style="background-color: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px; margin: 15px 0;">
                            <h4 style="color: #155724; margin-top: 0;">Next Steps:</h4>
                            <ul style="color: #155724; margin-bottom: 0;">
                                <li>You will receive admission documents within 3-5 business days</li>
                                <li>Payment instructions will be provided separately</li>
                                <li>Please check your email regularly for further communication</li>
                            </ul>
                        </div>
                `;
      }

      if (status.toLowerCase() === "interview_scheduled" && interviewDate) {
        htmlContent += `
                        <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 5px; margin: 15px 0;">
                            <h4 style="color: #0c5460; margin-top: 0;">Interview Details:</h4>
                            <ul style="color: #0c5460; margin-bottom: 0;">
                                <li><strong>Date:</strong> ${interviewDate}</li>
                                ${
                                  interviewTime
                                    ? `<li><strong>Time:</strong> ${interviewTime}</li>`
                                    : ""
                                }
                                ${
                                  interviewLocation
                                    ? `<li><strong>Location:</strong> ${interviewLocation}</li>`
                                    : ""
                                }
                                <li>Please arrive 15 minutes early</li>
                                <li>Bring a valid ID and any requested documents</li>
                            </ul>
                        </div>
                `;
      }

      if (status.toLowerCase() === "documents_required") {
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

                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 30px;">
                        <h4 style="color: #333; margin-top: 0;">Need Help?</h4>
                        <p style="color: #666; margin-bottom: 10px;">
                            If you have any questions about your application, please don't hesitate to contact us:
                        </p>
                        <ul style="color: #666; margin-bottom: 0;">
                            <li>Email: admissions@iuea.ac.ug</li>
                            <li>Phone: +256 414 373 747</li>
                            <li>Website: www.iuea.ac.ug</li>
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

      if (status.toLowerCase() === "approved") {
        textContent += `

Next Steps:
- You will receive admission documents within 3-5 business days
- Payment instructions will be provided separately
- Please check your email regularly for further communication
                `;
      }

      if (status.toLowerCase() === "interview_scheduled" && interviewDate) {
        textContent += `

Interview Details:
- Date: ${interviewDate}
${interviewTime ? `- Time: ${interviewTime}` : ""}
${interviewLocation ? `- Location: ${interviewLocation}` : ""}
- Please arrive 15 minutes early
- Bring a valid ID and any requested documents
                `;
      }

      if (additionalInfo) {
        textContent += `

Additional Information:
${additionalInfo}
                `;
      }

      textContent += `

Need Help?
If you have any questions about your application, please contact us:
- Email: admissions@iuea.ac.ug
- Phone: +256 414 373 747
- Website: www.iuea.ac.ug

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
        logger.info(`Application status email sent successfully`, {
          applicantEmail,
          status,
          courseName,
          messageId: result.messageId,
          provider: result.provider,
        });
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
                    <br>
                    <p>Best regards,<br>IUEA Finance Department</p>
                </div>
            `,
        text: `Payment Reminder\n\nDear ${applicantName},\n\nThis is a friendly reminder that your payment for ${courseName} is due.\n\nAmount Due: ${amountDue}\nDue Date: ${dueDate}\n\n${
          paymentInstructions
            ? `Payment Instructions: ${paymentInstructions}\n\n`
            : ""
        }Please ensure payment is made by the due date to secure your admission.\n\nBest regards,\nIUEA Finance Department`,
      };

      const result = await emailService.sendEmail(emailOptions);

      if (result.success) {
        logger.info(`Payment reminder email sent successfully`, {
          applicantEmail,
          courseName,
          messageId: result.messageId,
          provider: result.provider,
        });
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
