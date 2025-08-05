/**
 * Application Model for Firestore
 * Handles application form data structure and validation
 */

// Application Status Constants
const APPLICATION_STATUSES = {
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  DOCUMENTS_REQUIRED: "DOCUMENTS_REQUIRED",
  DOCUMENTS_RECEIVED: "DOCUMENTS_RECEIVED",
  INTERVIEW_SCHEDULED: "INTERVIEW_SCHEDULED",
  INTERVIEW_COMPLETED: "INTERVIEW_COMPLETED",
  CONDITIONALLY_ACCEPTED: "CONDITIONALLY_ACCEPTED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  WAITLISTED: "WAITLISTED",
  ENROLLED: "ENROLLED",
  DEFERRED: "DEFERRED",
  WITHDRAWN: "WITHDRAWN",
  EXPIRED: "EXPIRED",
};

// Study Mode Constants
const STUDY_MODES = {
  ON_CAMPUS: "on_campus",
  ONLINE: "online",
};

// Intake Constants
const INTAKE_PERIODS = {
  JANUARY: "january",
  MAY: "may",
  AUGUST: "august",
};

// Program Constants
const PROGRAMS = {
  BACHELOR_IT: "bachelor_information_technology",
  BACHELOR_BBA: "bachelor_business_administration",
  BACHELOR_BCOM: "bachelor_commerce",
  MASTER_MIT: "master_information_technology",
  MASTER_MBA: "master_business_administration",
  DIPLOMA_IT: "diploma_information_technology",
  DIPLOMA_BA: "diploma_business_administration",
  CERTIFICATE: "certificate_programs",
};

// Gender Constants
const GENDERS = {
  MALE: "male",
  FEMALE: "female",
  OTHER: "other",
  PREFER_NOT_TO_SAY: "prefer_not_to_say",
};

class ApplicationModel {
  /**
   * Create a new application document
   */
  static createApplication(applicationData) {
    const now = new Date();

    return {
      // Personal Information
      name: applicationData.name,
      countryOfBirth: applicationData.countryOfBirth,
      gender: applicationData.gender,
      email: applicationData.email.toLowerCase(),
      phoneNumber: applicationData.phoneNumber,
      passportPhoto: applicationData.passportPhoto || null,
      postalAddress: applicationData.postalAddress || null,

      // Academic Information
      modeOfStudy: applicationData.modeOfStudy,
      preferredIntake: applicationData.preferredIntake,
      preferredProgram: applicationData.preferredProgram,
      secondaryProgram: applicationData.secondaryProgram || null,
      academicDocuments: applicationData.academicDocuments || [],
      identificationDocument: applicationData.identificationDocument || null,

      // Sponsorship Information
      sponsor: applicationData.sponsor || null,
      sponsorTelephone: applicationData.sponsorTelephone || null,
      sponsorEmail: applicationData.sponsorEmail || null,

      // Application Meta
      status: APPLICATION_STATUSES.SUBMITTED,
      applicationNumber: this.generateApplicationNumber(),
      submittedAt: now,
      createdAt: now,
      updatedAt: now,

      // Tracking
      timeline: [
        {
          date: now,
          status: APPLICATION_STATUSES.SUBMITTED,
          action: "APPLICATION_SUBMITTED",
          notes: "Application submitted through online form",
          automated: true,
        },
      ],

      // Additional Fields
      documents: [],
      interviews: [],
      notes: "",
      assignedTo: null,

      // Integration
      leadId: null, // Will be populated when lead is created/updated
      whatsappMessageSent: false,
    };
  }

  /**
   * Generate unique application number
   */
  static generateApplicationNumber() {
    const year = new Date().getFullYear();
    const timestamp = Date.now().toString().slice(-6);
    return `APP${year}${timestamp}`;
  }

  /**
   * Validate application data
   */
  static validate(applicationData) {
    const errors = [];

    // Required fields
    const requiredFields = [
      "name",
      "countryOfBirth",
      "gender",
      "email",
      "phoneNumber",
      "modeOfStudy",
      "preferredIntake",
      "preferredProgram",
    ];

    requiredFields.forEach((field) => {
      if (
        !applicationData[field] ||
        !applicationData[field].toString().trim()
      ) {
        errors.push(`${field} is required`);
      }
    });

    // Email validation
    if (applicationData.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(applicationData.email)) {
        errors.push("Invalid email format");
      }
    }

    // Sponsor email validation if provided
    if (applicationData.sponsorEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(applicationData.sponsorEmail)) {
        errors.push("Invalid sponsor email format");
      }
    }

    // Phone validation
    if (applicationData.phoneNumber) {
      const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
      if (!phoneRegex.test(applicationData.phoneNumber)) {
        errors.push("Invalid phone number format");
      }
    }

    // Sponsor phone validation if provided
    if (applicationData.sponsorTelephone) {
      const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
      if (!phoneRegex.test(applicationData.sponsorTelephone)) {
        errors.push("Invalid sponsor phone number format");
      }
    }

    // Validate enum values
    if (
      applicationData.gender &&
      !Object.values(GENDERS).includes(applicationData.gender)
    ) {
      errors.push("Invalid gender value");
    }

    // Accept any mode of study
    // Mode of study validation removed to allow any value from frontend

    if (
      applicationData.preferredIntake &&
      !Object.values(INTAKE_PERIODS).includes(applicationData.preferredIntake)
    ) {
      errors.push("Invalid intake period");
    }

    // Accept any program selection
    // Program validation removed to allow any value from frontend

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Update application status
   */
  static updateStatus(application, newStatus, notes = "", updatedBy = null) {
    const now = new Date();

    // Add timeline entry
    const timelineEntry = {
      date: now,
      status: newStatus,
      action: `STATUS_CHANGED_TO_${newStatus}`,
      notes: notes || `Status changed to ${newStatus}`,
      automated: !updatedBy,
      updatedBy: updatedBy,
    };

    return {
      ...application,
      status: newStatus,
      updatedAt: now,
      timeline: [...(application.timeline || []), timelineEntry],
    };
  }

  /**
   * Add timeline entry
   */
  static addTimelineEntry(
    timeline = [],
    action,
    status,
    notes = "",
    additionalData = {}
  ) {
    const entry = {
      date: new Date(),
      action,
      status: status || "NO_STATUS_CHANGE",
      notes,
      automated: additionalData.automated || false,
      updatedBy: additionalData.updatedBy || null,
      ...additionalData,
    };

    return [...timeline, entry];
  }

  /**
   * Add document to application
   */
  static addDocument(application, documentData) {
    const document = {
      id: Date.now().toString(),
      name: documentData.name,
      type: documentData.type,
      url: documentData.url,
      uploadedAt: new Date(),
      uploadedBy: documentData.uploadedBy || null,
      verified: false,
    };

    const timeline = this.addTimelineEntry(
      application.timeline,
      "DOCUMENT_ADDED",
      application.status,
      `Document added: ${documentData.name}`,
      { documentId: document.id, automated: false }
    );

    return {
      ...application,
      documents: [...(application.documents || []), document],
      timeline,
      updatedAt: new Date(),
    };
  }

  /**
   * Get human-readable program name
   */
  static getProgramName(programCode) {
    const programNames = {
      [PROGRAMS.BACHELOR_IT]: "Bachelor of Information Technology (BIT)",
      [PROGRAMS.BACHELOR_BBA]: "Bachelor of Business Administration (BBA)",
      [PROGRAMS.BACHELOR_BCOM]: "Bachelor of Commerce (BCOM)",
      [PROGRAMS.MASTER_MIT]: "Master of Information Technology (MIT)",
      [PROGRAMS.MASTER_MBA]: "Master of Business Administration (MBA)",
      [PROGRAMS.DIPLOMA_IT]: "Diploma in Information Technology",
      [PROGRAMS.DIPLOMA_BA]: "Diploma in Business Administration",
      [PROGRAMS.CERTIFICATE]: "Certificate Programs",
    };

    return programNames[programCode] || programCode;
  }

  /**
   * Get human-readable status
   */
  static getStatusDisplay(status) {
    const statusDisplayMap = {
      [APPLICATION_STATUSES.SUBMITTED]: "Application Submitted",
      [APPLICATION_STATUSES.UNDER_REVIEW]: "Under Review",
      [APPLICATION_STATUSES.DOCUMENTS_REQUIRED]: "Documents Required",
      [APPLICATION_STATUSES.DOCUMENTS_RECEIVED]: "Documents Received",
      [APPLICATION_STATUSES.INTERVIEW_SCHEDULED]: "Interview Scheduled",
      [APPLICATION_STATUSES.INTERVIEW_COMPLETED]: "Interview Completed",
      [APPLICATION_STATUSES.CONDITIONALLY_ACCEPTED]: "Conditionally Accepted",
      [APPLICATION_STATUSES.ACCEPTED]: "Accepted",
      [APPLICATION_STATUSES.REJECTED]: "Rejected",
      [APPLICATION_STATUSES.WAITLISTED]: "Waitlisted",
      [APPLICATION_STATUSES.ENROLLED]: "Enrolled",
      [APPLICATION_STATUSES.DEFERRED]: "Deferred",
      [APPLICATION_STATUSES.WITHDRAWN]: "Withdrawn",
      [APPLICATION_STATUSES.EXPIRED]: "Expired",
    };

    return statusDisplayMap[status] || status;
  }
}

module.exports = {
  ApplicationModel,
  APPLICATION_STATUSES,
  STUDY_MODES,
  INTAKE_PERIODS,
  PROGRAMS,
  GENDERS,
};
