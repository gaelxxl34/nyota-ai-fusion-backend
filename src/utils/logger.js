/**
 * Production-ready logger utility
 * Uses console in development, can be extended to use Winston or other logging services in production
 */

const isDevelopment = process.env.NODE_ENV === "development";
const isProduction = process.env.NODE_ENV === "production";

const logger = {
  info: (message, ...args) => {
    if (isDevelopment) {
      console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
    }
  },

  error: (message, error = null) => {
    // Always log errors in production
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error);
  },

  warn: (message, ...args) => {
    if (!isProduction) {
      console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
    }
  },

  debug: (message, ...args) => {
    if (isDevelopment) {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args);
    }
  },

  webhook: (source, data) => {
    if (isDevelopment) {
      console.log(
        `[WEBHOOK] ${new Date().toISOString()} - ${source}:`,
        JSON.stringify(data, null, 2)
      );
    } else {
      // In production, only log essential info
      console.log(`[WEBHOOK] ${new Date().toISOString()} - ${source} received`);
    }
  },
};

module.exports = logger;
