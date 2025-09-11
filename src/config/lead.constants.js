/**
 * Lead Constants
 * Contains shared constants used across lead-related functionality
 */

// Lead Status Constants - Aligned with conversion funnel
const LEAD_STATUSES = {
  // Main funnel stages
  CONTACTED: "CONTACTED", // Lead contacted through ads/campaigns but not yet engaged
  INTERESTED: "INTERESTED", // Lead has shown interest (portal registration/engagement)
  APPLIED: "APPLIED", // Application submitted
  MISSING_DOCUMENT: "MISSING_DOCUMENT", // Application missing required documents
  IN_REVIEW: "IN_REVIEW", // Application being reviewed
  QUALIFIED: "QUALIFIED", // Meets all requirements
  ADMITTED: "ADMITTED", // Officially admitted
  ENROLLED: "ENROLLED", // Successfully enrolled
  DEFERRED: "DEFERRED", // Application deferred
  EXPIRED: "EXPIRED", // Application expired
};

// Conversation Status Constants
const CONVERSATION_STATUSES = {
  ACTIVE: "active",
  CLOSED: "closed",
  ARCHIVED: "archived",
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
  STUDENT_PORTAL: "STUDENT_PORTAL",
  APPLICANT_PORTAL: "APPLICANT_PORTAL",
  OTHER: "OTHER",
};

module.exports = {
  LEAD_STATUSES,
  LEAD_SOURCES,
  CONVERSATION_STATUSES,
};
