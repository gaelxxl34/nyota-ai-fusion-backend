const emailService = require("./emailService");
const logger = require("../utils/logger");
const WhatsAppMessageService = require("./whatsappMessageService");
const { getFirestore } = require("firebase-admin/firestore");
const LeadService = require("./leadService");
const ConversationService = require("./conversationService");

class ApplicationEmailService {
  constructor() {
    // Initialize WhatsApp services for status notifications
    this.db = getFirestore();
    this.leadService = new LeadService(this.db);
    this.conversationService = new ConversationService(this.db);
    this.whatsappMessageService = new WhatsAppMessageService(
      this.db,
      this.leadService,
      this.conversationService
    );
  }
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

      // Helper function to format status names for display
      const formatStatusForDisplay = (status) => {
        const statusMap = {
          APPLIED: "Applied",
          IN_REVIEW: "In Review",
          QUALIFIED: "Qualified",
          APPROVED: "Approved",
          REJECTED: "Rejected",
          DOCUMENTS_REQUIRED: "Documents Required",
          MISSING_DOCUMENT: "Missing Documents",
          ON_HOLD: "On Hold",
          ADMITTED: "Admitted",
          ENROLLED: "Enrolled",
          DEFERRED: "Deferred",
        };
        return (
          statusMap[status?.toUpperCase()] ||
          status?.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) ||
          status
        );
      };

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
        MISSING_DOCUMENT: {
          subject: "Missing Documents - Action Required",
          message:
            "Some required documents are missing from your application. Please upload them as soon as possible to continue the review process.",
          style: "background-color: #dc3545; color: white;",
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
          message: `Your application status has been updated to: ${formatStatusForDisplay(
            status
          )}`,
          style: "background-color: #007bff; color: white;",
        };

      // Build HTML email content with modern IUEA branding
      let htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${statusInfo.subject} - IUEA</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
          <div style="background-color: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            
            <!-- Logo Section - Centered on top -->
            <div style="text-align: center; padding: 20px 20px 10px; background-color: white;">
              <div style="background-color: white; border-radius: 8px; width: 160px; height: 100px; margin: 0 auto; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);">
                <img src="https://nyotatranslate.com/iuea-Logo.png" alt="IUEA Logo" style="width: 120px; height: 120px; object-fit: contain; display: block;" />
              </div>
            </div>
            
            <!-- Header with IUEA Branding -->
            <div style="background: linear-gradient(135deg, #7a0000 0%, #a00000 100%); color: white; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: bold;">International University of East Africa</h1>
              <p style="margin: 10px 0 0; font-size: 16px; opacity: 0.9;">Application Status Update</p>
            </div>

            <!-- Main Content -->
            <div style="padding: 40px 30px;">
              <h2 style="color: #333; margin: 0 0 20px; font-size: 22px;">Dear ${applicantName},</h2>
              
              <p style="color: #666; line-height: 1.6; font-size: 16px; margin-bottom: 25px;">
                We are writing to inform you about an important update regarding your application for 
                <strong style="color: #7a0000;">${courseName}</strong>.
              </p>

              <!-- Status Badge -->
              <div style="text-align: center; margin: 30px 0;">
                <div style="display: inline-block; padding: 20px 40px; border-radius: 8px; ${
                  statusInfo.style
                } box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);">
                  <h3 style="margin: 0; font-size: 20px; font-weight: bold;">📋 ${formatStatusForDisplay(
                    status
                  )}</h3>
                </div>
              </div>

              <!-- Status Message -->
              <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #7a0000;">
                <p style="color: #333; line-height: 1.6; margin: 0; font-size: 16px;">
                  ${statusInfo.message}
                </p>
              </div>
            `;

      // Add status-specific content
      if (
        status === "QUALIFIED" ||
        status === "APPROVED" ||
        status === "ADMITTED" ||
        status === "ENROLLED"
      ) {
        htmlContent += `
              <!-- Next Steps for Successful Status -->
              <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 25px; border-radius: 8px; margin: 25px 0;">
                <h4 style="color: white; margin: 0 0 15px; font-size: 18px;">🎉 Congratulations! Next Steps:</h4>
                <ul style="color: white; margin: 0; padding-left: 20px; line-height: 1.8;">
                  <li>📄 You will receive admission documents within 3-5 business days</li>
                  <li>💳 Payment instructions will be provided separately</li>
                  <li>📧 Please check your email regularly for further communication</li>
                  <li>🌐 Access your application portal for updates and documents</li>
                </ul>
              </div>
        `;
      }

      if (status === "DOCUMENTS_REQUIRED") {
        htmlContent += `
              <!-- Documents Required Warning -->
              <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #ffc107;">
                <h4 style="color: #856404; margin: 0 0 15px; font-size: 18px;">⚠️ Action Required:</h4>
                <p style="color: #856404; margin: 0; font-size: 16px; line-height: 1.6;">
                  Please submit the required documents as soon as possible to avoid delays in processing your application. 
                  Log into your application portal to view specific document requirements.
                </p>
              </div>
        `;
      }

      if (status === "MISSING_DOCUMENT") {
        // Extract missing documents details from additionalInfo or use default message
        const missingDocumentsDetails =
          additionalInfo ||
          "Please check your application portal to see which documents are required.";

        // Check if the additionalInfo contains specific document information
        // If it's just a generic status update message, provide more helpful default text
        let documentDetails = missingDocumentsDetails;
        if (
          missingDocumentsDetails.includes("Status updated to") ||
          missingDocumentsDetails.includes(
            "Your application status has been updated"
          )
        ) {
          documentDetails =
            "Please check your application portal to see which specific documents are required for your application.";
        }

        htmlContent += `
              <!-- Missing Documents Warning -->
              <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #dc3545;">
                <h4 style="color: #721c24; margin: 0 0 15px; font-size: 18px;">📋 Missing Documents:</h4>
                <p style="color: #721c24; margin: 0 0 15px; font-size: 16px; line-height: 1.6;">
                  Your application is incomplete due to missing required documents. Please upload the missing documents immediately to avoid delays in processing.
                </p>
                <div style="background-color: rgba(255, 255, 255, 0.9); padding: 15px; border-radius: 5px; margin-top: 15px;">
                  <h5 style="color: #721c24; margin: 0 0 10px; font-size: 16px; font-weight: bold;">📄 Required Documents:</h5>
                  <p style="color: #721c24; margin: 0; font-size: 15px; line-height: 1.5;">${documentDetails}</p>
                </div>
                <p style="color: #721c24; margin: 15px 0 0; font-size: 16px; line-height: 1.6;">
                  Access your application portal below to upload the required documents directly.
                </p>
              </div>
        `;
      }

      if (additionalInfo) {
        htmlContent += `
              <!-- Additional Information -->
              <div style="background-color: #e8f4fd; border: 1px solid #bee5eb; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #007bff;">
                <h4 style="color: #0c5460; margin: 0 0 15px; font-size: 18px;">💬 Additional Information:</h4>
                <p style="color: #0c5460; margin: 0; font-size: 16px; line-height: 1.6;">${additionalInfo}</p>
              </div>
        `;
      }

      htmlContent += `
              <!-- Application Portal Access -->
              <div style="text-align: center; margin: 30px 0; padding: 25px; background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); border-radius: 8px;">
                <h4 style="color: white; margin: 0 0 15px; font-size: 18px;">🎓 Application Portal Access</h4>
                <p style="color: white; margin: 0 0 20px; font-size: 15px;">Track your application status, upload documents, and access important updates</p>
                <a href="https://applicant.iuea.ac.ug/" 
                   style="background-color: white; color: #007bff; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; display: inline-block; transition: all 0.3s ease;">
                  Access Portal
                </a>
              </div>

              <!-- Contact Information -->
              <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0;">
                <h4 style="color: #7a0000; margin: 0 0 15px; font-size: 18px;">📞 Need Help?</h4>
                <p style="color: #666; margin: 0 0 15px; font-size: 16px;">
                  If you have any questions about your application, our admissions team is here to help:
                </p>
                <div style="display: flex; flex-wrap: wrap; gap: 15px;">
                  <div style="flex: 1; min-width: 200px;">
                    <p style="margin: 5px 0; color: #666; font-size: 15px;">📧 <a href="mailto:apply@iuea.ac.ug" style="color: #7a0000; text-decoration: none;">apply@iuea.ac.ug</a></p>
                    <p style="margin: 5px 0; color: #666; font-size: 15px;">📱 <a href="tel:+256790002000" style="color: #7a0000; text-decoration: none;">+256 790 002 000</a></p>
                  </div>
                  <div style="flex: 1; min-width: 200px;">
                    <p style="margin: 5px 0; color: #666; font-size: 15px;">🌐 <a href="https://www.iuea.ac.ug" style="color: #7a0000; text-decoration: none;">www.iuea.ac.ug</a></p>
                    <p style="margin: 5px 0; color: #666; font-size: 15px;">📍 Ggaba Road, Kansanga, Kampala</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Footer -->
            <div style="background-color: #f8f9fa; padding: 30px 20px; text-align: center; border-top: 1px solid #dee2e6;">
              <p style="color: #666; font-size: 16px; margin: 0; font-weight: bold;">Best regards,</p>
              <p style="color: #7a0000; font-size: 18px; margin: 5px 0; font-weight: bold;">IUEA Admissions Team</p>
              <p style="color: #666; font-size: 14px; margin: 0;">International University of East Africa</p>
              <p style="color: #666; font-size: 14px; margin: 10px 0 0; font-style: italic;">Learning to succeed.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      // Text version for email clients that don't support HTML
      let textContent = `
INTERNATIONAL UNIVERSITY OF EAST AFRICA
Application Status Update

Dear ${applicantName},

We are writing to inform you about an important update regarding your application for ${courseName}.

📋 STATUS: ${formatStatusForDisplay(status)}

${statusInfo.message}
            `;

      if (
        status === "QUALIFIED" ||
        status === "APPROVED" ||
        status === "ADMITTED" ||
        status === "ENROLLED"
      ) {
        textContent += `

🎉 CONGRATULATIONS! NEXT STEPS:
• You will receive admission documents within 3-5 business days
• Payment instructions will be provided separately
• Please check your email regularly for further communication
• Access your application portal for updates and documents
                `;
      }

      if (status === "DOCUMENTS_REQUIRED") {
        textContent += `

⚠️ ACTION REQUIRED:
Please submit the required documents as soon as possible to avoid delays in processing your application. Log into your application portal to view specific document requirements.
                `;
      }

      if (status === "MISSING_DOCUMENT") {
        // Extract missing documents details from additionalInfo or use default message
        const missingDocumentsDetails =
          additionalInfo ||
          "Please check your application portal to see which documents are required.";

        textContent += `

📋 MISSING DOCUMENTS:
Your application is incomplete due to missing required documents. Please upload the missing documents immediately to avoid delays in processing.

📄 REQUIRED DOCUMENTS:
${missingDocumentsDetails}

Access your application portal to upload the required documents directly.
                `;
      }

      if (additionalInfo) {
        textContent += `

💬 ADDITIONAL INFORMATION:
${additionalInfo}
                `;
      }

      textContent += `

🎓 APPLICATION PORTAL:
Track your application status and access important updates at: https://applicant.iuea.ac.ug/

📞 NEED HELP?
If you have any questions about your application, our admissions team is here to help:
• Email: apply@iuea.ac.ug
• Phone: +256 790 002 000
• Website: www.iuea.ac.ug
• Address: Ggaba Road, Kansanga, Kampala, Uganda

Best regards,
IUEA Admissions Team
International University of East Africa
Learning to succeed.
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
   * Send WhatsApp status change notification to applicant
   * @param {Object} applicationData - Application data
   * @param {string} applicationData.applicantPhone - Applicant's phone number
   * @param {string} applicationData.applicantName - Applicant's name
   * @param {string} applicationData.status - New status
   * @param {string} applicationData.leadId - Lead ID (optional)
   */
  async sendWhatsAppStatusChangeNotification(applicationData) {
    try {
      const { applicantPhone, applicantName, status, leadId } = applicationData;

      if (!applicantPhone) {
        logger.warn(
          "No phone number provided for WhatsApp status notification"
        );
        return {
          success: false,
          error: "Phone number required",
          skipped: true,
        };
      }

      // Normalize phone number
      const normalizedPhone = applicantPhone.startsWith("+")
        ? applicantPhone
        : `+${applicantPhone}`;
      const cleanPhone = normalizedPhone.replace(/[^\d]/g, "");

      // Map status to template name and content
      const statusTemplates = {
        IN_REVIEW: {
          templateName: "application_in_review",
          content: `Hello 👋
Your application is currently under review 📑
Our admissions team is carefully checking your details and documents.
👉 Visit your portal anytime for updates: https://applicant.iuea.ac.ug/`,
        },
        QUALIFIED: {
          templateName: "application_qualified",
          content: `Great news🎉
Your application has met all requirements, and you are qualified for admission.
👉 Check your portal now for the next steps: https://applicant.iuea.ac.ug/`,
        },
        MISSING_DOCUMENT: {
          templateName: "application_missing_documents",
          content: `Important Update 📋
Your application requires additional documents to proceed.
Please upload the missing documents as soon as possible.
👉 Access your portal now: https://applicant.iuea.ac.ug/`,
        },
        ADMITTED: {
          templateName: "application_admitted",
          content: `Congratulations 🎓🎉
You've been officially admitted to IUEA!
👉 Download your admission letter and complete enrollment here: https://applicant.iuea.ac.ug/
Welcome to the IUEA family 🌍`,
        },
        DEFERRED: {
          templateName: "application_deferred",
          content: `Hello 👋
Your application has been deferred to a later intake ⏳
This means your admission process is postponed for now.
👉 Stay updated by checking your portal: https://applicant.iuea.ac.ug/`,
        },
      };

      const templateInfo =
        statusTemplates[status] || statusTemplates[status.toUpperCase()];

      if (!templateInfo) {
        logger.info(`No WhatsApp template defined for status: ${status}`);
        return {
          success: false,
          error: "No template for this status",
          skipped: true,
        };
      }

      // Prepare template payload
      const templatePayload = {
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "template",
        template: {
          name: templateInfo.templateName,
          language: { code: "en_US" },
          components: [],
        },
      };

      console.log(
        `📱 Sending WhatsApp status notification "${templateInfo.templateName}" to ${normalizedPhone}`
      );

      // Send template message
      const result = await this.whatsappMessageService.sendTemplateMessage(
        normalizedPhone,
        templatePayload,
        {
          leadId: leadId,
          contactName: applicantName,
          statusUpdate: true,
          status: status,
        }
      );

      if (result.success) {
        // Save the readable message content to conversation
        try {
          const conversationId =
            await this.conversationService.createOrGetConversation(
              normalizedPhone,
              leadId,
              applicantName
            );

          // Store the status notification message
          const messageDoc = {
            messageId: result.messageId,
            conversationId: conversationId,
            from: process.env.WHATSAPP_PHONE_NUMBER_ID,
            to: normalizedPhone,
            content: templateInfo.content,
            messageType: "template",
            sender: "admin",
            senderType: "admin",
            direction: "outgoing",
            timestamp: new Date(),
            status: "sent",
            createdAt: new Date(),
            isAI: false,
            automated: true,
            senderName: "IUEA Admissions",
            templateName: templateInfo.templateName,
            statusUpdate: true,
            applicationStatus: status,
          };

          await this.db.collection("messages").add(messageDoc);

          // Update conversation with latest message
          await this.db
            .collection("conversations")
            .doc(conversationId)
            .update({
              lastMessage: templateInfo.content.split("\n")[0], // First line as preview
              lastMessageTime: new Date(),
              lastMessageFrom: "business",
              updatedAt: new Date(),
            });

          logger.info(
            `✅ WhatsApp status notification sent and saved for ${normalizedPhone}`,
            {
              status,
              templateName: templateInfo.templateName,
              messageId: result.messageId,
            }
          );
        } catch (saveError) {
          console.error("❌ Error saving WhatsApp status message:", saveError);
          // Don't fail the notification if saving fails
        }

        return {
          success: true,
          messageId: result.messageId,
          templateName: templateInfo.templateName,
          provider: "whatsapp",
        };
      } else {
        logger.error("Failed to send WhatsApp status notification", {
          phone: normalizedPhone,
          status,
          error: result.error,
        });
        return {
          success: false,
          error: result.error,
          provider: "whatsapp",
          skipped: false,
        };
      }
    } catch (error) {
      logger.error("Failed to send WhatsApp status notification:", error);
      return {
        success: false,
        error: error.message,
        provider: "whatsapp",
        skipped: false,
      };
    }
  }

  /**
   * Send combined email and WhatsApp status change notifications
   * @param {Object} applicationData - Application data with email, phone, name, status, etc.
   */
  async sendCombinedStatusChangeNotification(applicationData) {
    const results = {
      email: { success: false, skipped: true },
      whatsapp: { success: false, skipped: true },
    };

    // Prepare notification promises for parallel execution
    const notificationPromises = [];

    // Add email notification promise if email is available
    if (applicationData.applicantEmail) {
      const emailPromise = this.sendStatusChangeNotification({
        applicantEmail: applicationData.applicantEmail,
        applicantName: applicationData.applicantName,
        courseName: applicationData.courseName,
        status: applicationData.status,
        additionalInfo: applicationData.additionalInfo,
      })
        .then((result) => {
          results.email = result;
          return { type: "email", result };
        })
        .catch((error) => {
          console.error("❌ Error sending email status notification:", error);
          results.email = { success: false, error: error.message };
          return { type: "email", result: results.email };
        });

      notificationPromises.push(emailPromise);
    }

    // Add WhatsApp notification promise if phone is available
    if (applicationData.applicantPhone) {
      const whatsappPromise = this.sendWhatsAppStatusChangeNotification({
        applicantPhone: applicationData.applicantPhone,
        applicantName: applicationData.applicantName,
        status: applicationData.status,
        leadId: applicationData.leadId,
      })
        .then((result) => {
          results.whatsapp = result;
          return { type: "whatsapp", result };
        })
        .catch((error) => {
          console.error(
            "❌ Error sending WhatsApp status notification:",
            error
          );
          results.whatsapp = { success: false, error: error.message };
          return { type: "whatsapp", result: results.whatsapp };
        });

      notificationPromises.push(whatsappPromise);
    }

    // Execute all notifications simultaneously
    if (notificationPromises.length > 0) {
      try {
        console.log(
          `🚀 Sending ${notificationPromises.length} notifications simultaneously...`
        );
        const notificationResults = await Promise.all(notificationPromises);

        // Log individual results
        notificationResults.forEach(({ type, result }) => {
          if (result.success) {
            console.log(
              `✅ ${
                type.charAt(0).toUpperCase() + type.slice(1)
              } notification sent successfully`
            );
          } else if (!result.skipped) {
            console.log(
              `❌ ${
                type.charAt(0).toUpperCase() + type.slice(1)
              } notification failed: ${result.error}`
            );
          }
        });

        console.log(
          `📊 Notification summary: Email=${
            results.email.success
              ? "Success"
              : results.email.skipped
              ? "Skipped"
              : "Failed"
          }, WhatsApp=${
            results.whatsapp.success
              ? "Success"
              : results.whatsapp.skipped
              ? "Skipped"
              : "Failed"
          }`
        );
      } catch (error) {
        console.error("❌ Error in parallel notification execution:", error);
      }
    } else {
      console.warn(
        "⚠️ No notification methods available (no email or phone provided)"
      );
    }

    return results;
  }

  /**
   * Send application received confirmation email to applicant
   * @param {Object} applicationData - Application data
   * @param {string} applicationData.applicantEmail - Applicant's email
   * @param {string} applicationData.applicantName - Applicant's name
   * @param {string} applicationData.courseName - Course name
   * @param {string} applicationData.applicationId - Application ID
   * @param {string} applicationData.preferredIntake - Preferred intake
   * @param {string} applicationData.modeOfStudy - Mode of study
   */
  async sendApplicationReceivedNotification(applicationData) {
    try {
      const {
        applicantEmail,
        applicantName,
        courseName,
        applicationId,
        preferredIntake,
        modeOfStudy,
      } = applicationData;

      // Build HTML email content with IUEA branding and logo
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Application Received - IUEA</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
          <div style="background-color: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            
            <!-- Logo Section - Centered on top -->
            <div style="text-align: center; padding: 20px 20px 10px; background-color: white;">
              <div style="background-color: white; border-radius: 8px; width: 160px; height: 100px; margin: 0 auto; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);">
                <img src="https://nyotatranslate.com/iuea-Logo.png" alt="IUEA Logo" style="width: 120px; height: 120px; object-fit: contain; display: block;" />
              </div>
            </div>
            
            <!-- Header with IUEA Branding -->
            <div style="background: linear-gradient(135deg, #7a0000 0%, #a00000 100%); color: white; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: bold;">International University of East Africa</h1>
              <p style="margin: 10px 0 0; font-size: 16px; opacity: 0.9;">technological university of choice • Learning to Succeed</p>
            </div>

            <!-- Main Content -->
            <div style="padding: 40px 30px;">
              <h2 style="color: #7a0000; margin: 0 0 20px; font-size: 24px; text-align: center;">🎓 Application Received Successfully!</h2>
              
              <p style="font-size: 18px; margin-bottom: 20px;">Dear <strong>${applicantName}</strong>,</p>
              
              <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
                <h3 style="margin: 0; font-size: 20px;">✅ Thank you for applying to IUEA!</h3>
                <p style="margin: 10px 0 0; font-size: 16px;">We've received your application and we're excited to have you take this big step toward your academic journey with us.</p>
              </div>

              <!-- Application Details -->
              <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #7a0000;">
                <h4 style="color: #7a0000; margin: 0 0 15px; font-size: 18px;">📋 Application Details</h4>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; font-weight: bold; color: #555;">Program:</td>
                    <td style="padding: 8px 0; color: #333;">${courseName}</td>
                  </tr>
                  ${
                    preferredIntake
                      ? `
                  <tr>
                    <td style="padding: 8px 0; font-weight: bold; color: #555;">Preferred Intake:</td>
                    <td style="padding: 8px 0; color: #333;">${preferredIntake}</td>
                  </tr>
                  `
                      : ""
                  }
                  ${
                    modeOfStudy
                      ? `
                  <tr>
                    <td style="padding: 8px 0; font-weight: bold; color: #555;">Mode of Study:</td>
                    <td style="padding: 8px 0; color: #333;">${modeOfStudy}</td>
                  </tr>
                  `
                      : ""
                  }
                  <tr>
                    <td style="padding: 8px 0; font-weight: bold; color: #555;">Submission Date:</td>
                    <td style="padding: 8px 0; color: #333;">${new Date().toLocaleDateString(
                      "en-US",
                      {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      }
                    )}</td>
                  </tr>
                </table>
              </div>

              <!-- Next Steps -->
              <div style="background-color: #e8f4fd; border: 1px solid #bee5eb; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h4 style="color: #0c5460; margin: 0 0 15px; font-size: 18px;">🔄 What Happens Next?</h4>
                <ol style="color: #0c5460; margin: 0; padding-left: 20px;">
                  <li style="margin-bottom: 10px;">Our admissions team is currently reviewing your application</li>
                  <li style="margin-bottom: 10px;">We'll be in touch shortly with the next steps</li>
                  <li style="margin-bottom: 10px;">You may be contacted for additional documents or an interview</li>
                  <li style="margin-bottom: 10px;">Check your email regularly for updates</li>
                </ol>
              </div>

              <!-- Support Message -->
              <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h4 style="color: #856404; margin: 0 0 10px; font-size: 16px;">😊 Need Assistance?</h4>
                <p style="color: #856404; margin: 0; font-size: 15px;">If you have any questions or need assistance, let me know how I can support you.</p>
              </div>

              <!-- Portal Access -->
              <div style="text-align: center; margin: 30px 0; padding: 25px; background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); border-radius: 8px;">
                <h4 style="color: white; margin: 0 0 15px; font-size: 18px;">🌍 Welcome to the IUEA Family! ✨</h4>
                <p style="color: white; margin: 0 0 20px; font-size: 15px;">Track your application status and access important updates</p>
                <a href="https://applicant.iuea.ac.ug/" style="background-color: white; color: #007bff; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; display: inline-block; transition: all 0.3s ease;">Access Application Portal</a>
              </div>
            </div>

            <!-- Footer -->
            <div style="background-color: #f8f9fa; padding: 30px 20px; text-align: center; border-top: 1px solid #dee2e6;">
              <h4 style="color: #7a0000; margin: 0 0 15px; font-size: 18px;">📞 Contact Information</h4>
              <div style="margin-bottom: 20px;">
                <p style="margin: 5px 0; color: #666;">📧 Email: <a href="mailto:apply@iuea.ac.ug" style="color: #7a0000; text-decoration: none;">apply@iuea.ac.ug</a></p>
                <p style="margin: 5px 0; color: #666;">📱 Phone: <a href="tel:+256790002000" style="color: #7a0000; text-decoration: none;">+256 790 002 000</a></p>
                <p style="margin: 5px 0; color: #666;">🌐 Website: <a href="https://www.iuea.ac.ug" style="color: #7a0000; text-decoration: none;">www.iuea.ac.ug</a></p>
                <p style="margin: 5px 0; color: #666;">📍 Ggaba Road, Kansanga, Kampala, Uganda</p>
              </div>
              
              <div style="margin: 20px 0; padding-top: 20px; border-top: 1px solid #dee2e6;">
                <p style="color: #666; font-size: 16px; margin: 0; font-weight: bold;">Best regards,</p>
                <p style="color: #7a0000; font-size: 18px; margin: 5px 0; font-weight: bold;">IUEA Admissions Team</p>
                <p style="color: #666; font-size: 14px; margin: 0;">International University of East Africa</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      // Text version for email clients that don't support HTML
      const textContent = `
INTERNATIONAL UNIVERSITY OF EAST AFRICA
Application Received Successfully!

Dear ${applicantName},

Thank you for applying to IUEA! 🎓

We've received your application and we're excited to have you take this big step toward your academic journey with us. ✅

APPLICATION DETAILS:
- Program: ${courseName}
${preferredIntake ? `- Preferred Intake: ${preferredIntake}` : ""}
${modeOfStudy ? `- Mode of Study: ${modeOfStudy}` : ""}
- Submission Date: ${new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}

WHAT HAPPENS NEXT?
1. Our admissions team is currently reviewing your application
2. We'll be in touch shortly with the next steps
3. You may be contacted for additional documents or an interview
4. Check your email regularly for updates

In the meantime, if you have any questions or need assistance, let me know how I can support you. 😊

Welcome to the IUEA family! 🌍✨

APPLICATION PORTAL:
Track your application status and access important updates at: https://applicant.iuea.ac.ug/

CONTACT INFORMATION:
- Email: apply@iuea.ac.ug
- Phone: +256 790 002 000
- Website: www.iuea.ac.ug
- Address: Ggaba Road, Kansanga, Kampala, Uganda

Best regards,
IUEA Admissions Team
International University of East Africa
      `;

      const emailOptions = {
        to: applicantEmail,
        subject: `🎓 Application Received - Welcome to IUEA! - ${courseName}`,
        html: htmlContent,
        text: textContent,
      };

      const result = await emailService.sendEmail(emailOptions);

      if (result.success) {
        logger.info(
          `✅ Application received email sent successfully to ${applicantEmail}`,
          {
            applicantEmail,
            applicationId,
            courseName,
            messageId: result.messageId,
            provider: result.provider,
          }
        );
      } else if (result.skipped) {
        logger.warn(
          `Email service not available, application received notification skipped`,
          {
            applicantEmail,
            applicationId,
            courseName,
            reason: result.error,
          }
        );
      } else {
        logger.error(`Failed to send application received email`, {
          applicantEmail,
          applicationId,
          courseName,
          error: result.error,
          provider: result.provider,
        });
      }

      return result;
    } catch (error) {
      logger.error("Failed to send application received email:", error);
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
        subject: `💳 Payment Reminder - ${courseName}`,
        html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Payment Reminder - IUEA</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
          <div style="background-color: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            
            <!-- Logo Section - Centered on top -->
            <div style="text-align: center; padding: 20px 20px 10px; background-color: white;">
              <div style="background-color: white; border-radius: 8px; width: 160px; height: 100px; margin: 0 auto; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);">
                <img src="https://nyotatranslate.com/iuea-Logo.png" alt="IUEA Logo" style="width: 120px; height: 120px; object-fit: contain; display: block;" />
              </div>
            </div>
            
            <!-- Header with IUEA Branding -->
            <div style="background: linear-gradient(135deg, #7a0000 0%, #a00000 100%); color: white; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: bold;">International University of East Africa</h1>
              <p style="margin: 10px 0 0; font-size: 16px; opacity: 0.9;">Payment Reminder</p>
            </div>

            <!-- Main Content -->
            <div style="padding: 40px 30px;">
              <h2 style="color: #333; margin: 0 0 20px; font-size: 22px;">Dear ${applicantName},</h2>
              
              <p style="color: #666; line-height: 1.6; font-size: 16px; margin-bottom: 25px;">
                This is a friendly reminder that your payment for <strong style="color: #7a0000;">${courseName}</strong> is due.
              </p>

              <!-- Payment Details -->
              <div style="background: linear-gradient(135deg, #ffc107 0%, #ffcd39 100%); color: #000; padding: 25px; border-radius: 8px; margin: 25px 0;">
                <h3 style="color: #000; margin: 0 0 15px; font-size: 18px;">💰 Payment Details:</h3>
                <div style="background-color: rgba(255, 255, 255, 0.9); padding: 15px; border-radius: 5px;">
                  <p style="margin: 8px 0; font-size: 16px;"><strong>Amount Due:</strong> ${amountDue}</p>
                  <p style="margin: 8px 0; font-size: 16px;"><strong>Due Date:</strong> ${dueDate}</p>
                </div>
              </div>

              ${
                paymentInstructions
                  ? `
              <!-- Payment Instructions -->
              <div style="background-color: #e8f4fd; border: 1px solid #bee5eb; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #007bff;">
                <h4 style="color: #0c5460; margin: 0 0 15px; font-size: 18px;">📋 Payment Instructions:</h4>
                <p style="color: #0c5460; margin: 0; font-size: 16px; line-height: 1.6;">${paymentInstructions}</p>
              </div>
              `
                  : ""
              }

              <!-- Important Notice -->
              <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #ffc107;">
                <h4 style="color: #856404; margin: 0 0 15px; font-size: 18px;">⚠️ Important:</h4>
                <p style="color: #856404; margin: 0; font-size: 16px; line-height: 1.6;">
                  Please ensure payment is made by the due date to secure your admission and avoid any delays in your enrollment process.
                </p>
              </div>

              <!-- Payment Portal Access -->
              <div style="text-align: center; margin: 30px 0; padding: 25px; background: linear-gradient(135deg, #28a745 0%, #20c997 100%); border-radius: 8px;">
                <h4 style="color: white; margin: 0 0 15px; font-size: 18px;">💳 Make Payment Online</h4>
                <p style="color: white; margin: 0 0 20px; font-size: 15px;">Access your application portal to view payment options and track your payment status</p>
                <a href="https://applicant.iuea.ac.ug/" 
                   style="background-color: white; color: #28a745; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; display: inline-block; transition: all 0.3s ease;">
                  Access Payment Portal
                </a>
              </div>

              <!-- Contact Information -->
              <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0;">
                <h4 style="color: #7a0000; margin: 0 0 15px; font-size: 18px;">📞 Need Help?</h4>
                <p style="color: #666; margin: 0 0 15px; font-size: 16px;">
                  If you have any questions about your payment, our finance team is here to help:
                </p>
                <div style="display: flex; flex-wrap: wrap; gap: 15px;">
                  <div style="flex: 1; min-width: 200px;">
                    <p style="margin: 5px 0; color: #666; font-size: 15px;">📧 <a href="mailto:finance@iuea.ac.ug" style="color: #7a0000; text-decoration: none;">finance@iuea.ac.ug</a></p>
                    <p style="margin: 5px 0; color: #666; font-size: 15px;">📱 <a href="tel:+256790002000" style="color: #7a0000; text-decoration: none;">+256 790 002 000</a></p>
                  </div>
                  <div style="flex: 1; min-width: 200px;">
                    <p style="margin: 5px 0; color: #666; font-size: 15px;">🌐 <a href="https://www.iuea.ac.ug" style="color: #7a0000; text-decoration: none;">www.iuea.ac.ug</a></p>
                    <p style="margin: 5px 0; color: #666; font-size: 15px;">📍 Ggaba Road, Kansanga, Kampala</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Footer -->
            <div style="background-color: #f8f9fa; padding: 30px 20px; text-align: center; border-top: 1px solid #dee2e6;">
              <p style="color: #666; font-size: 16px; margin: 0; font-weight: bold;">Best regards,</p>
              <p style="color: #7a0000; font-size: 18px; margin: 5px 0; font-weight: bold;">IUEA Finance Department</p>
              <p style="color: #666; font-size: 14px; margin: 0;">International University of East Africa</p>
              <p style="color: #666; font-size: 14px; margin: 10px 0 0; font-style: italic;">Learning to succeed.</p>
            </div>
          </div>
        </body>
        </html>
        `,
        text: `
INTERNATIONAL UNIVERSITY OF EAST AFRICA
Payment Reminder

Dear ${applicantName},

This is a friendly reminder that your payment for ${courseName} is due.

💰 PAYMENT DETAILS:
• Amount Due: ${amountDue}
• Due Date: ${dueDate}

${
  paymentInstructions
    ? `📋 PAYMENT INSTRUCTIONS:
${paymentInstructions}

`
    : ""
}⚠️ IMPORTANT:
Please ensure payment is made by the due date to secure your admission and avoid any delays in your enrollment process.

💳 MAKE PAYMENT ONLINE:
Access your application portal to view payment options and track your payment status: https://applicant.iuea.ac.ug/

📞 NEED HELP?
If you have any questions about your payment, our finance team is here to help:
• Email: finance@iuea.ac.ug
• Phone: +256 790 002 000
• Website: www.iuea.ac.ug
• Address: Ggaba Road, Kansanga, Kampala, Uganda

Best regards,
IUEA Finance Department
International University of East Africa
Learning to succeed.
        `,
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
