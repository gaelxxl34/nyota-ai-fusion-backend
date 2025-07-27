/**
 * WhatsApp Validation Configuration for Production
 */

module.exports = {
  // Validation behavior
  validation: {
    // Use message validation as last resort
    preferMessageValidation: false,

    // Validation timeouts
    pendingTimeout: 5 * 60 * 1000, // 5 minutes
    messageTimeout: 30 * 1000, // 30 seconds for API calls

    // Retry configuration
    maxRetries: 2,
    retryDelay: 1000, // Initial retry delay (exponential backoff)

    // Cache configuration
    cacheEnabled: true,
    cacheTTL: 60 * 60 * 1000, // 1 hour

    // Batch processing
    batchSize: 10,
    batchDelay: 1000, // Delay between batches
  },

  // Rate limiting
  rateLimit: {
    // WhatsApp API limits
    maxRequestsPerMinute: 80, // Leave 20% buffer from actual limit
    maxRequestsPerHour: 1000,

    // Per-phone number limits
    maxValidationAttemptsPerNumber: 3,
    validationCooldownPeriod: 24 * 60 * 60 * 1000, // 24 hours
  },

  // Monitoring and alerts
  monitoring: {
    // Enable monitoring
    enabled: true,

    // Alert thresholds
    alerts: {
      highFailureRate: 0.2, // Alert if >20% validation failures
      lowSuccessRate: 0.7, // Alert if <70% success rate
      pendingQueueSize: 100, // Alert if >100 pending validations
    },

    // Monitoring interval
    checkInterval: 5 * 60 * 1000, // 5 minutes

    // Cleanup old records
    cleanupEnabled: true,
    cleanupAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },

  // Database configuration
  database: {
    // Collections
    collections: {
      leads: "leads",
      validations: "whatsapp_validations",
      validationLogs: "whatsapp_validation_logs",
    },

    // Indexes needed for performance
    requiredIndexes: [
      {
        collection: "leads",
        fields: ["whatsappValidationStatus", "createdAt"],
      },
      {
        collection: "whatsapp_validations",
        fields: ["phoneNumber", "status", "createdAt"],
      },
      {
        collection: "whatsapp_validations",
        fields: ["messageId"],
      },
    ],
  },

  // Security
  security: {
    // Encrypt phone numbers in logs
    encryptPhoneNumbers: true,

    // Mask phone numbers in logs (show only last 4 digits)
    maskPhoneInLogs: true,

    // IP whitelist for webhook endpoints
    webhookIPWhitelist: [
      // Add Meta/WhatsApp IP ranges here
    ],
  },

  // Feature flags
  features: {
    // Enable/disable validation methods
    useProfileCheck: true,
    usePhoneInfoCheck: false, // Deprecated by WhatsApp
    useMessageValidation: true,

    // Enable deduplication
    deduplicateValidations: true,

    // Enable automatic retry for timeouts
    autoRetryTimeouts: true,

    // Enable validation queue
    useValidationQueue: true,
  },

  // Error handling
  errors: {
    // Error codes that indicate "not on WhatsApp"
    notOnWhatsAppCodes: [131026, 131051, 131052],

    // Error codes that should trigger retry
    retryableCodes: [500, 503, 429],

    // Error codes that indicate rate limiting
    rateLimitCodes: [4, 10, 613, 80007, 429],
  },

  // Logging
  logging: {
    // Log levels
    level: process.env.NODE_ENV === "production" ? "error" : "debug",

    // Log validation attempts
    logValidationAttempts: true,

    // Log validation results
    logValidationResults: true,

    // Maximum log retention
    maxLogAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};
