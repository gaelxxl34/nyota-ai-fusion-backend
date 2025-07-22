/**
 * Auto-Qualification Configuration
 * Centralized configuration for lead auto-qualification rules
 * Follows configuration-as-code best practices
 */

const { LEAD_STATUSES } = require("./lead.constants");

/**
 * Auto-qualification rule configurations
 * Can be overridden by environment variables or external config
 */
const AUTO_QUALIFICATION_CONFIG = {
  // Interaction thresholds for different qualification levels
  THRESHOLDS: {
    PRE_QUALIFIED: parseInt(process.env.PRE_QUALIFIED_THRESHOLD) || 3,
    QUALIFIED: parseInt(process.env.QUALIFIED_THRESHOLD) || 7,
    // Future: Add more threshold levels
  },

  // Interaction types that count toward qualification
  QUALIFYING_INTERACTION_TYPES: {
    PRIMARY: ["WHATSAPP", "EMAIL", "PHONE"], // High-value interactions
    SECONDARY: ["MEETING", "VIDEO_CALL"], // Premium interactions (could have higher weight)
    // Future: Add weighted scoring system
  },

  // Statuses eligible for each auto-qualification level
  ELIGIBLE_STATUSES: {
    PRE_QUALIFIED: [
      LEAD_STATUSES.INQUIRY,
      LEAD_STATUSES.CONTACTED,
      LEAD_STATUSES.NURTURE,
    ],
    QUALIFIED: [LEAD_STATUSES.PRE_QUALIFIED, LEAD_STATUSES.FOLLOW_UP],
  },

  // Target statuses for auto-qualification
  TARGET_STATUSES: {
    BASIC_QUALIFICATION: LEAD_STATUSES.PRE_QUALIFIED,
    ADVANCED_QUALIFICATION: LEAD_STATUSES.QUALIFIED,
  },

  // System users for different auto-qualification types
  SYSTEM_USERS: {
    AUTO_QUALIFICATION: "SYSTEM_AUTO_QUALIFICATION",
    INTERACTION_BASED: "SYSTEM_INTERACTION_QUALIFIER",
    TIME_BASED: "SYSTEM_TIME_QUALIFIER", // Future: time-based qualification
  },

  // Customizable note templates
  NOTE_TEMPLATES: {
    PRE_QUALIFIED: (count) =>
      `Auto-qualified to PRE_QUALIFIED after ${count} qualifying interactions`,
    QUALIFIED: (count) =>
      `Auto-qualified to QUALIFIED after ${count} total interactions`,
    CUSTOM: (status, count, reason) =>
      `Auto-qualified to ${status}: ${reason} (${count} interactions)`,
  },

  // Feature flags for different qualification strategies
  FEATURES: {
    INTERACTION_COUNTING:
      process.env.ENABLE_INTERACTION_QUALIFICATION !== "false",
    TIME_BASED_QUALIFICATION: process.env.ENABLE_TIME_QUALIFICATION === "true",
    WEIGHTED_SCORING: process.env.ENABLE_WEIGHTED_SCORING === "true",
    ENGAGEMENT_ANALYSIS: process.env.ENABLE_ENGAGEMENT_ANALYSIS === "true",
  },

  // Backwards compatibility - maps to old QUALIFICATION_RULES format
  get LEGACY_FORMAT() {
    return {
      PRE_QUALIFIED_INTERACTION_THRESHOLD: this.THRESHOLDS.PRE_QUALIFIED,
      QUALIFYING_INTERACTION_TYPES: [
        ...this.QUALIFYING_INTERACTION_TYPES.PRIMARY,
        ...this.QUALIFYING_INTERACTION_TYPES.SECONDARY,
      ],
      ELIGIBLE_STATUSES_FOR_AUTO_QUALIFICATION:
        this.ELIGIBLE_STATUSES.PRE_QUALIFIED,
    };
  },
};

/**
 * Auto-Qualification Service Configuration
 * Service-layer configuration for different qualification strategies
 */
const QUALIFICATION_SERVICE_CONFIG = {
  // Retry configuration for failed auto-qualifications
  RETRY: {
    MAX_ATTEMPTS: 3,
    DELAY_MS: 1000,
    EXPONENTIAL_BACKOFF: true,
  },

  // Notification configuration
  NOTIFICATIONS: {
    BROADCAST_AUTO_QUALIFICATION: true,
    LOG_QUALIFICATION_ATTEMPTS: true,
    ALERT_ON_FAILURES: process.env.NODE_ENV === "production",
  },

  // Performance optimization
  PERFORMANCE: {
    BATCH_PROCESS_SIZE: 50,
    CACHE_QUALIFICATION_RESULTS: false, // Future: Redis cache
    ASYNC_NOTIFICATIONS: true,
  },
};

/**
 * Validation functions for configuration
 */
const CONFIG_VALIDATORS = {
  validateThreshold: (threshold) => {
    return Number.isInteger(threshold) && threshold > 0 && threshold <= 100;
  },

  validateInteractionTypes: (types) => {
    return (
      Array.isArray(types) &&
      types.length > 0 &&
      types.every((type) => typeof type === "string")
    );
  },

  validateConfig: (config) => {
    const errors = [];

    if (!CONFIG_VALIDATORS.validateThreshold(config.THRESHOLDS.PRE_QUALIFIED)) {
      errors.push("Invalid PRE_QUALIFIED threshold");
    }

    if (
      !CONFIG_VALIDATORS.validateInteractionTypes(
        config.QUALIFYING_INTERACTION_TYPES.PRIMARY
      )
    ) {
      errors.push("Invalid PRIMARY interaction types");
    }

    return { isValid: errors.length === 0, errors };
  },
};

// Validate configuration on load
const validation = CONFIG_VALIDATORS.validateConfig(AUTO_QUALIFICATION_CONFIG);
if (!validation.isValid) {
  console.warn(
    "⚠️ Auto-qualification configuration issues:",
    validation.errors
  );
}

module.exports = {
  AUTO_QUALIFICATION_CONFIG,
  QUALIFICATION_SERVICE_CONFIG,
  CONFIG_VALIDATORS,

  // Export legacy format for backwards compatibility
  QUALIFICATION_RULES: AUTO_QUALIFICATION_CONFIG.LEGACY_FORMAT,
};
