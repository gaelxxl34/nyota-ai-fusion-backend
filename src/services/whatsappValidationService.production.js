/**
 * Production-Ready WhatsApp Phone Number Validation Service
 * Includes rate limiting, retry logic, and better error handling
 */

const axios = require("axios");
const admin = require("firebase-admin");

class WhatsAppValidationServiceProduction {
  constructor(accessToken, phoneNumberId) {
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.baseUrl = `https://graph.facebook.com/v17.0/${phoneNumberId}`;

    // Production configuration
    this.config = {
      maxRetries: 2,
      retryDelay: 1000, // 1 second
      validationTimeout: 300000, // 5 minutes
      rateLimit: {
        maxRequests: 100,
        windowMs: 60000, // 1 minute
      },
      batchSize: 10, // Process validations in batches
    };

    // In-memory rate limiting (use Redis in production)
    this.rateLimitMap = new Map();
    this.validationCache = new Map(); // Cache recent validations
    this.cacheTimeout = 3600000; // 1 hour
  }

  /**
   * Check rate limits
   */
  checkRateLimit() {
    const now = Date.now();
    const window = this.config.rateLimit.windowMs;

    // Clean old entries
    for (const [time, count] of this.rateLimitMap) {
      if (now - time > window) {
        this.rateLimitMap.delete(time);
      }
    }

    // Count requests in current window
    let requestsInWindow = 0;
    for (const [time, count] of this.rateLimitMap) {
      if (now - time <= window) {
        requestsInWindow += count;
      }
    }

    if (requestsInWindow >= this.config.rateLimit.maxRequests) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }

    // Add current request
    this.rateLimitMap.set(now, 1);
  }

  /**
   * Normalize phone number
   */
  normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return "";
    return phoneNumber.toString().replace(/^\+/, "").replace(/\D/g, "");
  }

  /**
   * Check validation cache
   */
  checkCache(phoneNumber) {
    const cached = this.validationCache.get(phoneNumber);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log(`📦 Using cached validation for ${phoneNumber}`);
      return cached.result;
    }
    return null;
  }

  /**
   * Set validation cache
   */
  setCache(phoneNumber, result) {
    this.validationCache.set(phoneNumber, {
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * Validate phone number with production safeguards
   */
  async validateNumber(phoneNumber, options = {}) {
    try {
      // Check cache first
      const cachedResult = this.checkCache(phoneNumber);
      if (cachedResult) {
        return cachedResult;
      }

      // Check rate limits
      this.checkRateLimit();

      // Normalize number
      const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

      // Basic format validation
      if (
        !normalizedNumber ||
        normalizedNumber.length < 10 ||
        normalizedNumber.length > 15
      ) {
        const result = {
          isValid: false,
          isWhatsAppValid: false,
          error: "Invalid phone number format",
          normalizedNumber: normalizedNumber,
          validationType: "format_error",
        };
        this.setCache(phoneNumber, result);
        return result;
      }

      // Check if validation is already pending for this number
      if (options.checkPending) {
        const isPending = await this.checkPendingValidation(normalizedNumber);
        if (isPending) {
          return {
            isValid: false,
            isWhatsAppValid: null,
            error: null,
            normalizedNumber: normalizedNumber,
            validationType: "already_pending",
            note: "Validation already in progress for this number",
          };
        }
      }

      // Try to validate with retry logic
      let lastError = null;
      for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
        try {
          const result = await this.attemptValidation(
            normalizedNumber,
            options
          );
          this.setCache(phoneNumber, result);
          return result;
        } catch (error) {
          lastError = error;
          if (attempt < this.config.maxRetries) {
            console.log(
              `⚠️ Validation attempt ${attempt + 1} failed, retrying...`
            );
            await this.delay(this.config.retryDelay * (attempt + 1));
          }
        }
      }

      // All retries failed
      throw lastError || new Error("Validation failed after retries");
    } catch (error) {
      console.error("❌ Validation error:", error);

      // Return safe error response
      const result = {
        isValid: false,
        isWhatsAppValid: null,
        error: error.message || "Validation service temporarily unavailable",
        normalizedNumber: this.normalizePhoneNumber(phoneNumber),
        validationType: "service_error",
      };

      return result;
    }
  }

  /**
   * Attempt validation (single try)
   */
  async attemptValidation(normalizedNumber, options) {
    // Try quick profile check first (no message)
    try {
      const profileResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${normalizedNumber}`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
          params: {
            fields: "is_whatsapp_user",
          },
          timeout: 5000,
        }
      );

      if (profileResponse.data && profileResponse.data.is_whatsapp_user) {
        return {
          isValid: true,
          isWhatsAppValid: true,
          error: null,
          normalizedNumber: normalizedNumber,
          validationType: "profile_check",
          note: "Verified via WhatsApp profile check",
        };
      }
    } catch (error) {
      // Profile check failed, try message validation if allowed
      if (options.allowMessageValidation !== false) {
        return await this.validateViaMessage(normalizedNumber);
      }

      throw error;
    }
  }

  /**
   * Validate via message (with tracking)
   */
  async validateViaMessage(normalizedNumber) {
    try {
      const messageResponse = await axios.post(
        `${this.baseUrl}/messages`,
        {
          messaging_product: "whatsapp",
          to: normalizedNumber,
          type: "text",
          text: {
            body: "Welcome! This is a one-time verification message.",
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          timeout: 5000,
        }
      );

      if (messageResponse.data && messageResponse.data.messages) {
        // Store validation attempt in database
        await this.storeValidationAttempt(
          normalizedNumber,
          messageResponse.data.messages[0].id
        );

        return {
          isValid: false,
          isWhatsAppValid: null,
          error: null,
          normalizedNumber: normalizedNumber,
          validationType: "validation_pending",
          messageId: messageResponse.data.messages[0].id,
          note: "Validation message sent, awaiting delivery confirmation",
        };
      }
    } catch (error) {
      if (error.response?.data?.error) {
        const errorCode = error.response.data.error.code;

        // Known "not on WhatsApp" errors
        if ([131026, 131051, 131052].includes(errorCode)) {
          return {
            isValid: false,
            isWhatsAppValid: false,
            error: "This phone number is not registered on WhatsApp",
            normalizedNumber: normalizedNumber,
            validationType: "not_on_whatsapp",
          };
        }
      }

      throw error;
    }
  }

  /**
   * Check if validation is already pending
   */
  async checkPendingValidation(phoneNumber) {
    try {
      const db = admin.firestore();
      const snapshot = await db
        .collection("whatsapp_validations")
        .where("phoneNumber", "==", phoneNumber)
        .where("status", "==", "pending")
        .where(
          "createdAt",
          ">",
          new Date(Date.now() - this.config.validationTimeout)
        )
        .limit(1)
        .get();

      return !snapshot.empty;
    } catch (error) {
      console.error("Error checking pending validation:", error);
      return false;
    }
  }

  /**
   * Store validation attempt
   */
  async storeValidationAttempt(phoneNumber, messageId) {
    try {
      const db = admin.firestore();
      await db.collection("whatsapp_validations").add({
        phoneNumber,
        messageId,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        attempts: 1,
      });
    } catch (error) {
      console.error("Error storing validation attempt:", error);
    }
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Batch validate multiple numbers
   */
  async batchValidate(phoneNumbers, options = {}) {
    const results = [];
    const batches = this.chunkArray(phoneNumbers, this.config.batchSize);

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map((phone) =>
          this.validateNumber(phone, options).catch((error) => ({
            phone,
            isValid: false,
            error: error.message,
          }))
        )
      );

      results.push(...batchResults);

      // Delay between batches to avoid rate limits
      if (batches.indexOf(batch) < batches.length - 1) {
        await this.delay(1000);
      }
    }

    return results;
  }

  /**
   * Chunk array helper
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

module.exports = WhatsAppValidationServiceProduction;
