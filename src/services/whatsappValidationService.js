const axios = require("axios");

/**
 * WhatsApp Phone Number Validation Service
 * 🔒 GUARANTEED NO MESSAGE SENDING - Uses lookup endpoints only
 */
class WhatsAppValidationService {
  constructor(accessToken, phoneNumberId) {
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.baseUrl = `https://graph.facebook.com/v17.0/${phoneNumberId}`;
  }

  /**
   * Normalize phone number by removing + and any non-digits
   */
  normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return "";
    return phoneNumber.toString().replace(/^\+/, "").replace(/\D/g, "");
  }

  /**
   * Validate phone number format and detect invalid patterns
   */
  validatePhoneFormat(phoneNumber) {
    if (!phoneNumber || typeof phoneNumber !== "string") {
      return {
        isValid: false,
        error:
          "Invalid phone number format. Please provide a valid phone number.",
        normalizedNumber: "",
      };
    }

    // Remove + and normalize
    const normalized = this.normalizePhoneNumber(phoneNumber);

    // Basic length and digit validation
    if (!normalized || normalized.length < 8 || !/^\d+$/.test(normalized)) {
      return {
        isValid: false,
        error:
          "Invalid phone number format. Please provide a valid phone number.",
        normalizedNumber: normalized,
      };
    }

    // Check for invalid pattern: 0 immediately after any country code
    let hasInvalidZero = false;
    let countryCode = "";
    let suggestedNumber = "";

    // Check for 4-digit country codes followed by 0 (rare but possible)
    if (normalized.match(/^([1-9][0-9][0-9][0-9])0\d+$/)) {
      countryCode = normalized.substring(0, 4);
      suggestedNumber = countryCode + normalized.substring(5);
      hasInvalidZero = true;
    }
    // Check for 3-digit country codes followed by 0
    else if (normalized.match(/^([1-9][0-9][0-9])0\d+$/)) {
      countryCode = normalized.substring(0, 3);
      suggestedNumber = countryCode + normalized.substring(4);
      hasInvalidZero = true;
    }
    // Check for 2-digit country codes followed by 0
    else if (
      normalized.match(/^([1-9][0-9])0\d+$/) &&
      normalized.length >= 12
    ) {
      countryCode = normalized.substring(0, 2);
      suggestedNumber = countryCode + normalized.substring(3);
      hasInvalidZero = true;
    }
    // Check for 1-digit country codes followed by 0
    else if (normalized.match(/^([1-9])0\d+$/) && normalized.length >= 11) {
      countryCode = normalized.substring(0, 1);
      suggestedNumber = countryCode + normalized.substring(2);
      hasInvalidZero = true;
    }

    if (hasInvalidZero) {
      return {
        isValid: false,
        error: `Invalid phone number format. Please remove the leading 0 after country code ${countryCode}. Example: use ${suggestedNumber} instead of ${normalized}.`,
        normalizedNumber: normalized,
      };
    }

    // General international format validation
    if (normalized.length < 10 || normalized.length > 15) {
      return {
        isValid: false,
        error:
          "Invalid phone number length. International phone numbers should be between 10-15 digits.",
        normalizedNumber: normalized,
      };
    }

    // Check for valid country code patterns
    const countryCodePattern = /^(\d{1,4})\d{6,11}$/;
    if (!countryCodePattern.test(normalized)) {
      return {
        isValid: false,
        error:
          "Invalid international phone number format. Please provide a valid format with country code.",
        normalizedNumber: normalized,
      };
    }

    return {
      isValid: true,
      error: null,
      normalizedNumber: normalized,
    };
  }

  /**
   * 🔒 NO MESSAGE APPROACH: Quick WhatsApp validation using lookup endpoints
   * Uses WhatsApp Business API endpoints that only check registration without sending messages
   */
  async quickWhatsAppCheck(phoneNumber) {
    try {
      console.log(`🔍 QuickWhatsAppCheck (NO MESSAGES): ${phoneNumber}`);

      // First validate format
      const formatValidation = this.validatePhoneFormat(phoneNumber);
      if (!formatValidation.isValid) {
        return formatValidation;
      }

      const normalizedNumber = formatValidation.normalizedNumber;

      if (!this.accessToken || !this.phoneNumberId) {
        console.warn("⚠️ WhatsApp credentials not configured");
        return {
          isValid: true,
          isWhatsAppValid: null,
          error: null,
          normalizedNumber: normalizedNumber,
          validationType: "format_only",
          note: "WhatsApp API validation not configured",
        };
      }

      // 🔒 METHOD 1: Try WhatsApp Business Profile lookup (no messages)
      try {
        console.log(
          `🔍 Checking WhatsApp Business Profile for: ${normalizedNumber}`
        );

        const profileResponse = await axios.get(
          `${this.baseUrl}/whatsapp_business_profile`,
          {
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              "Content-Type": "application/json",
            },
            params: {
              phone_number: normalizedNumber,
            },
            timeout: 10000,
          }
        );

        if (profileResponse.data) {
          console.log(
            `✅ WhatsApp Business Profile found for: ${normalizedNumber}`
          );
          return {
            isValid: true,
            isWhatsAppValid: true,
            error: null,
            normalizedNumber: normalizedNumber,
            validationType: "whatsapp_business_profile",
            note: "Verified via WhatsApp Business Profile lookup",
          };
        }
      } catch (profileError) {
        console.log(`ℹ️ Business profile check failed, trying phone info...`);
      }

      // 🔒 METHOD 2: Try phone number info lookup (no messages)
      try {
        console.log(`🔍 Checking phone number info for: ${normalizedNumber}`);

        const phoneInfoResponse = await axios.get(
          `${this.baseUrl}/${normalizedNumber}`,
          {
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              "Content-Type": "application/json",
            },
            timeout: 10000,
          }
        );

        if (phoneInfoResponse.data && phoneInfoResponse.data.verified_name) {
          console.log(`✅ Phone number info found for: ${normalizedNumber}`);
          return {
            isValid: true,
            isWhatsAppValid: true,
            error: null,
            normalizedNumber: normalizedNumber,
            validationType: "whatsapp_phone_info",
            note: "Verified via WhatsApp phone info lookup",
          };
        }
      } catch (phoneInfoError) {
        // Check for specific WhatsApp API errors that indicate invalid number
        if (phoneInfoError.response?.data?.error) {
          const errorCode = phoneInfoError.response.data.error.code;
          const errorMessage = phoneInfoError.response.data.error.message;

          // Common error codes for numbers not on WhatsApp
          if (
            errorCode === 131056 || // Number is not a WhatsApp number
            errorCode === 131051 || // Invalid phone number
            errorCode === 131052 || // Phone number not registered
            errorCode === 100 || // Invalid parameter
            errorMessage.includes("not a WhatsApp user") ||
            errorMessage.includes("phone number is not registered") ||
            errorMessage.includes("Invalid phone number")
          ) {
            console.log(`❌ Number not on WhatsApp: ${normalizedNumber}`);
            return {
              isValid: false,
              isWhatsAppValid: false,
              error:
                "This phone number is not registered on WhatsApp. Please provide a valid WhatsApp number.",
              normalizedNumber: normalizedNumber,
              validationType: "whatsapp_lookup_failed",
            };
          }

          // Rate limiting - allow through with warning
          if (
            errorCode === 4 ||
            errorCode === 10 ||
            errorCode === 613 ||
            errorCode === 80007
          ) {
            console.warn(
              `⚠️ WhatsApp API rate limited for: ${normalizedNumber}`
            );
            return {
              isValid: true,
              isWhatsAppValid: null,
              error: null,
              normalizedNumber: normalizedNumber,
              validationType: "format_fallback",
              note: "WhatsApp API temporarily unavailable, validated format only",
            };
          }
        }

        console.log(`ℹ️ Phone info lookup failed: ${phoneInfoError.message}`);
      }

      // If both lookups failed without explicit "not on WhatsApp" errors,
      // fall back to format validation (number might be valid but API issues)
      console.log(`⚠️ WhatsApp lookup inconclusive for: ${normalizedNumber}`);
      return {
        isValid: true,
        isWhatsAppValid: null,
        error: null,
        normalizedNumber: normalizedNumber,
        validationType: "format_fallback",
        note: "WhatsApp validation inconclusive, format validated only",
      };
    } catch (error) {
      console.error("❌ Error in quickWhatsAppCheck:", error.message);

      // Fallback to format validation
      const formatValidation = this.validatePhoneFormat(phoneNumber);
      return {
        ...formatValidation,
        validationType: "format_fallback",
        note: "WhatsApp validation error, format validated only",
      };
    }
  }

  /**
   * 🚀 MAIN VALIDATION METHOD - NO MESSAGES SENT
   * Uses WhatsApp Business API lookup endpoints only
   */
  async validateNumber(phoneNumber) {
    try {
      console.log(`🔍 WhatsApp validation (NO MESSAGES) for: ${phoneNumber}`);

      // Use the no-message validation approach
      return await this.quickWhatsAppCheck(phoneNumber);
    } catch (error) {
      console.error("❌ Error in main validation method:", error);

      // Ultimate fallback to format validation
      const formatValidation = this.validatePhoneFormat(phoneNumber);
      return {
        ...formatValidation,
        validationType: "format_fallback",
        note: "Validation error, used format validation only",
      };
    }
  }
}

module.exports = WhatsAppValidationService;
