/**
 * Application Service for Firestore Operations
 * Handles application submissions, lead integration, and WhatsApp messaging
 */

const {
  ApplicationModel,
  APPLICATION_STATUSES,
  PROGRAMS,
} = require("../models/application.model");

const { LEAD_STATUSES } = require("../config/lead.constants");

class ApplicationService {
  constructor(firestore, leadService, whatsappMessageService) {
    this.db = firestore;
    this.leadService = leadService;
    this.whatsappService = whatsappMessageService;
    this.collection = "applications";
  }

  /**
   * Submit a new application
   * This is the main method that handles the complete application flow
   */
  async submitApplication(applicationData) {
    try {
      // 1. Validate application data
      const validation = ApplicationModel.validate(applicationData);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
      }

      // 2. Create application document
      const applicationDoc =
        ApplicationModel.createApplication(applicationData);
      console.log(`📋 Creating application for ${applicationData.name}...`);

      // If submittedBy info is provided, add it to the timeline
      if (applicationData.submittedBy) {
        applicationDoc.timeline[0] = {
          ...applicationDoc.timeline[0],
          submittedBy: applicationData.submittedBy,
          notes: `Application submitted through online form by ${
            applicationData.submittedBy.name ||
            applicationData.submittedBy.email
          } (${applicationData.submittedBy.role})`,
        };
      }

      // 3. Check if lead exists (by phone or email)
      let existingLead = null;

      // First check by phone number
      if (applicationData.phoneNumber) {
        existingLead = await this.leadService.findLeadByPhone(
          applicationData.phoneNumber
        );
      }

      // If no lead found by phone, check by email
      if (!existingLead && applicationData.email) {
        existingLead = await this.leadService.findLeadByEmail(
          applicationData.email
        );
      }

      let lead = null;

      if (existingLead) {
        // 4a. Update existing lead status to APPLIED
        console.log(
          `📞 Updating existing lead ${existingLead.id} to APPLIED status...`
        );

        lead = await this.leadService.updateLeadStatus(
          existingLead.id,
          LEAD_STATUSES.APPLIED,
          `Application submitted for ${ApplicationModel.getProgramName(
            applicationData.preferredProgram
          )}`,
          "SYSTEM"
        );

        // Update application with lead ID
        applicationDoc.leadId = existingLead.id;
      } else {
        // 4b. Create new lead with APPLIED status
        console.log(`🆕 Creating new lead with APPLIED status...`);

        const contactInfo = {
          name: applicationData.name,
          phone: applicationData.phoneNumber,
          email: applicationData.email,
        };

        const additionalData = {
          program: ApplicationModel.getProgramName(
            applicationData.preferredProgram
          ),
          modeOfStudy: applicationData.modeOfStudy,
          preferredIntake: applicationData.preferredIntake,
          countryOfBirth: applicationData.countryOfBirth,
          gender: applicationData.gender,
        };

        // Create lead directly with APPLIED status
        // We'll modify the timeline during creation to ensure it starts with APPLIED directly
        contactInfo.status = LEAD_STATUSES.APPLIED; // Set initial status to APPLIED

        lead = await this.leadService.createLead(
          contactInfo,
          "APPLICATION_FORM", // source
          additionalData
        );

        // Update application with lead ID
        applicationDoc.leadId = lead.id;
      }

      // 5. Save application to database
      const docRef = await this.db
        .collection(this.collection)
        .add(applicationDoc);

      console.log(`✅ Application created with ID: ${docRef.id}`);

      const savedApplication = {
        id: docRef.id,
        ...applicationDoc,
      };

      // 6. Send WhatsApp thank you message
      let whatsappResult = null;
      try {
        // Use the received_application template instead of custom message
        const templatePayload = {
          messaging_product: "whatsapp",
          to: applicationData.phoneNumber,
          type: "template",
          template: {
            name: "received_application",
            language: { code: "en_US" },
          },
        };

        whatsappResult = await this.whatsappService.sendTemplateMessage(
          applicationData.phoneNumber,
          templatePayload,
          {
            leadId: lead.id,
            applicationId: docRef.id,
            messageType: "application_confirmation",
          }
        );

        if (whatsappResult.success) {
          console.log(
            `📱 WhatsApp confirmation sent to ${applicationData.phoneNumber}`
          );

          // Update application to mark WhatsApp message as sent
          await this.db.collection(this.collection).doc(docRef.id).update({
            whatsappMessageSent: true,
            updatedAt: new Date(),
          });
        }
      } catch (whatsappError) {
        console.error("❌ Failed to send WhatsApp message:", whatsappError);
        // Don't fail the entire application process if WhatsApp fails
      }

      return {
        success: true,
        application: savedApplication,
        lead: lead,
        whatsappMessage: whatsappResult,
      };
    } catch (error) {
      console.error("❌ Error submitting application:", error);
      throw error;
    }
  }

  /**
   * Generate thank you message for WhatsApp
   * @deprecated No longer in use - replaced by received_application template
   */
  generateThankYouMessage(applicationData) {
    const programName = ApplicationModel.getProgramName(
      applicationData.preferredProgram
    );
    const intakeName =
      applicationData.preferredIntake.charAt(0).toUpperCase() +
      applicationData.preferredIntake.slice(1);

    return `🎉 Thank you ${
      applicationData.name
    } for applying to our ${programName} program!

We're excited about your interest in joining our academic community. Here's what happens next:

📋 **Application Status**: Submitted Successfully
📚 **Program**: ${programName}
📅 **Intake**: ${intakeName}
💻 **Mode**: ${
      applicationData.modeOfStudy === "on_campus" ? "On Campus" : "Online"
    }

**Next Steps:**
1. Our admissions team will review your application within 3-5 business days
2. You may be contacted for additional documents or an interview
3. We'll keep you updated on your application progress

**Questions?** Feel free to reply to this message or call our admissions office.

Welcome to the journey towards your academic success! 🎓

Best regards,
IUEA Admissions Team`;
  }

  /**
   * Get application by ID
   */
  async getApplicationById(applicationId) {
    try {
      const doc = await this.db
        .collection(this.collection)
        .doc(applicationId)
        .get();

      if (!doc.exists) {
        return null;
      }

      return {
        id: doc.id,
        ...doc.data(),
      };
    } catch (error) {
      console.error("❌ Error getting application:", error);
      throw error;
    }
  }

  /**
   * Get applications by email
   */
  async getApplicationsByEmail(email) {
    try {
      const snapshot = await this.db
        .collection(this.collection)
        .where("email", "==", email.toLowerCase())
        .orderBy("submittedAt", "desc")
        .get();

      const applications = [];
      snapshot.forEach((doc) => {
        applications.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      return applications;
    } catch (error) {
      console.error("❌ Error getting applications by email:", error);
      throw error;
    }
  }

  /**
   * Get applications by phone number
   */
  async getApplicationsByPhone(phoneNumber) {
    try {
      const snapshot = await this.db
        .collection(this.collection)
        .where("phoneNumber", "==", phoneNumber)
        .orderBy("submittedAt", "desc")
        .get();

      const applications = [];
      snapshot.forEach((doc) => {
        applications.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      return applications;
    } catch (error) {
      console.error("❌ Error getting applications by phone:", error);
      throw error;
    }
  }

  /**
   * Get all applications with pagination and filters
   */
  async getApplications(limit = 50, filters = {}) {
    try {
      let query = this.db
        .collection(this.collection)
        .orderBy("submittedAt", "desc");

      // Apply filters
      if (filters.status) {
        query = query.where("status", "==", filters.status);
      }

      if (filters.program) {
        query = query.where("preferredProgram", "==", filters.program);
      }

      if (filters.intake) {
        query = query.where("preferredIntake", "==", filters.intake);
      }

      // Apply limit
      query = query.limit(limit);

      const snapshot = await query.get();

      const applications = [];
      snapshot.forEach((doc) => {
        applications.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      return {
        applications,
        hasMore: snapshot.docs.length === limit,
      };
    } catch (error) {
      console.error("❌ Error getting applications:", error);
      throw error;
    }
  }

  /**
   * Update application status
   */
  async updateApplicationStatus(
    applicationId,
    newStatus,
    notes = "",
    updatedBy = null
  ) {
    try {
      const application = await this.getApplicationById(applicationId);
      if (!application) {
        throw new Error("Application not found");
      }

      const updatedApplication = ApplicationModel.updateStatus(
        application,
        newStatus,
        notes,
        updatedBy
      );

      await this.db
        .collection(this.collection)
        .doc(applicationId)
        .update(updatedApplication);

      console.log(
        `✅ Application ${applicationId} status updated to ${newStatus}`
      );

      return {
        id: applicationId,
        ...updatedApplication,
      };
    } catch (error) {
      console.error("❌ Error updating application status:", error);
      throw error;
    }
  }

  /**
   * Get application statistics
   */
  async getApplicationStats() {
    try {
      const snapshot = await this.db.collection(this.collection).get();

      const stats = {
        total: snapshot.size,
        byStatus: {},
        byProgram: {},
        byIntake: {},
        byModeOfStudy: {},
      };

      snapshot.forEach((doc) => {
        const data = doc.data();

        // Count by status
        stats.byStatus[data.status] = (stats.byStatus[data.status] || 0) + 1;

        // Count by program
        if (data.preferredProgram) {
          stats.byProgram[data.preferredProgram] =
            (stats.byProgram[data.preferredProgram] || 0) + 1;
        }

        // Count by intake
        if (data.preferredIntake) {
          stats.byIntake[data.preferredIntake] =
            (stats.byIntake[data.preferredIntake] || 0) + 1;
        }

        // Count by mode of study
        if (data.modeOfStudy) {
          stats.byModeOfStudy[data.modeOfStudy] =
            (stats.byModeOfStudy[data.modeOfStudy] || 0) + 1;
        }
      });

      return stats;
    } catch (error) {
      console.error("❌ Error getting application stats:", error);
      throw error;
    }
  }
}

module.exports = ApplicationService;
