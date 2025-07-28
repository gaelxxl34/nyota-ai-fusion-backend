/**
 * Lead Constants
 * Contains shared constants used across lead-related functionality
 */

// Lead Status Constants - Aligned with conversion funnel
const LEAD_STATUSES = {
  // Main funnel stages
  INQUIRY: "INQUIRY", // Initial inquiry/lead capture
  CONTACTED: "CONTACTED", // First contact made
  PRE_QUALIFIED: "PRE_QUALIFIED", // Interested/Pre-qualified
  APPLIED: "APPLIED", // Application submitted
  QUALIFIED: "QUALIFIED", // Meets all requirements
  ADMITTED: "ADMITTED", // Officially admitted
  ENROLLED: "ENROLLED", // Successfully enrolled

  // Additional statuses for lead management
  NURTURE: "NURTURE", // In nurturing process
  REJECTED: "REJECTED", // Application rejected
};

// Lead Source Constants
const LEAD_SOURCES = {
  WEBSITE: "WEBSITE",
  META_ADS: "META_ADS",
  GOOGLE_ADS: "GOOGLE_ADS",
  WHATSAPP: "WHATSAPP",
  LINKEDIN: "LINKEDIN",
  REFERRAL: "REFERRAL",
  WALK_IN: "WALK_IN",
  PHONE: "PHONE",
  EMAIL: "EMAIL",
  EDUCATION_FAIR: "EDUCATION_FAIR",
  PARTNER: "PARTNER",
  APPLICATION_FORM: "APPLICATION_FORM",
  MANUAL: "MANUAL",
  SOCIAL_MEDIA: "SOCIAL_MEDIA",
  EVENT: "EVENT",
  OTHER: "OTHER",
};

module.exports = {
  LEAD_STATUSES,
  LEAD_SOURCES,
};
