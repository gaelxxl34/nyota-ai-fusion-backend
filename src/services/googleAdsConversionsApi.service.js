const crypto = require("crypto");
const { GoogleAdsApi, enums } = require("google-ads-api");

class GoogleAdsConversionsApiService {
  constructor() {
    // Google Ads API Configuration
    this.customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
    this.developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    this.clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    this.refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

    // Initialize Google Ads client
    if (
      this.customerId &&
      this.developerToken &&
      this.clientId &&
      this.clientSecret &&
      this.refreshToken
    ) {
      this.client = new GoogleAdsApi({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        developer_token: this.developerToken,
      });

      this.customer = this.client.Customer({
        customer_id: this.customerId,
        refresh_token: this.refreshToken,
      });
    } else {
      console.warn(
        "⚠️ Google Ads Conversions API not configured. Set GOOGLE_ADS_* environment variables."
      );
    }
  }

  /**
   * Hash data using SHA-256 (required by Google Ads Enhanced Conversions)
   */
  hashData(data) {
    if (!data) return null;
    return crypto
      .createHash("sha256")
      .update(data.toLowerCase().trim())
      .digest("hex");
  }

  /**
   * Map application status to Google Ads conversion actions (matches backend system exactly)
   */
  mapStatusToGoogleConversion(status) {
    const statusConversionMap = {
      // Main conversion funnel - matching your backend exactly
      CONTACTED: {
        action: "initial_contact",
        label: process.env.GOOGLE_ADS_CONTACT_CONVERSION_LABEL,
        value: 0.5, // Lower value for initial contact
      },
      INTERESTED: {
        action: "signup",
        label: process.env.GOOGLE_ADS_SIGNUP_CONVERSION_LABEL,
        value: 1,
      },
      APPLIED: {
        action: "submit_application",
        label: process.env.GOOGLE_ADS_APPLICATION_CONVERSION_LABEL,
        value: 3,
      },
      MISSING_DOCUMENT: {
        action: "missing_document",
        label: process.env.GOOGLE_ADS_MISSING_DOC_CONVERSION_LABEL,
        value: 2.5, // Between applied and in review
      },
      IN_REVIEW: {
        action: "application_review",
        label: process.env.GOOGLE_ADS_REVIEW_CONVERSION_LABEL,
        value: 4,
      },
      QUALIFIED: {
        action: "qualified_lead",
        label: process.env.GOOGLE_ADS_QUALIFIED_CONVERSION_LABEL,
        value: 6,
      },
      ADMITTED: {
        action: "student_admitted",
        label: process.env.GOOGLE_ADS_ADMITTED_CONVERSION_LABEL,
        value: 12,
      },
      ENROLLED: {
        action: "student_enrolled", // Highest value conversion - final goal!
        label: process.env.GOOGLE_ADS_ENROLLMENT_CONVERSION_LABEL,
        value: 20,
      },
      // Terminal statuses
      DEFERRED: {
        action: "application_deferred",
        label: process.env.GOOGLE_ADS_DEFERRED_CONVERSION_LABEL,
        value: 1, // Lower value for deferred applications
      },
      EXPIRED: {
        action: "application_expired",
        label: process.env.GOOGLE_ADS_EXPIRED_CONVERSION_LABEL,
        value: 0, // No value for expired applications
      },
    };

    return statusConversionMap[status] || statusConversionMap.INTERESTED;
  }

  /**
   * Calculate conversion value based on status (matches backend system exactly)
   */
  calculateConversionValue(status) {
    const valueMap = {
      CONTACTED: 0.5, // Initial contact
      INTERESTED: 1, // Shows interest
      APPLIED: 3, // Application submitted
      MISSING_DOCUMENT: 2.5, // Missing docs (between applied and review)
      IN_REVIEW: 4, // Under review
      QUALIFIED: 6, // Meets requirements
      ADMITTED: 12, // Officially admitted
      ENROLLED: 20, // Successfully enrolled - ULTIMATE GOAL!
      DEFERRED: 1, // Application deferred
      EXPIRED: 0, // Application expired
    };

    return valueMap[status] || 0;
  }

  /**
   * Send conversion to Google Ads using Enhanced Conversions
   */
  async sendEnhancedConversion(eventData) {
    if (!this.customer) {
      console.log(
        "📊 Google Ads Conversions API not configured, skipping event"
      );
      return null;
    }

    console.log("🔍 GOOGLE ADS DEBUG: Starting enhanced conversion send...");
    console.log("🔍 GOOGLE ADS DEBUG: Customer ID:", this.customerId);
    console.log("🔍 GOOGLE ADS DEBUG: Event data received:", eventData);

    try {
      const {
        leadId,
        applicationId,
        status,
        email,
        phone,
        firstName,
        lastName,
        eventTime = Math.floor(Date.now() / 1000),
        gclid, // Google Click ID if available
        gbraid, // Google Ads attribution ID
        wbraid, // Web attribution ID
      } = eventData;

      const conversionConfig = this.mapStatusToGoogleConversion(status);

      if (!conversionConfig.label) {
        console.warn(
          `⚠️ No Google Ads conversion label configured for status: ${status}`
        );
        return null;
      }

      // Prepare user identifiers for Enhanced Conversions
      const userIdentifiers = [];

      console.log("🔍 GOOGLE ADS DEBUG: Processing user data...");

      if (email) {
        const hashedEmail = this.hashData(email);
        userIdentifiers.push({
          hashed_email: hashedEmail,
        });
        console.log(
          "🔍 GOOGLE ADS DEBUG: Email processed -",
          email,
          "→",
          hashedEmail
        );
      }

      if (phone) {
        // Normalize phone number (remove spaces, dashes, etc.)
        const normalizedPhone = phone.replace(/[\s\-\(\)]/g, "");
        const hashedPhone = this.hashData(normalizedPhone);
        userIdentifiers.push({
          hashed_phone_number: hashedPhone,
        });
        console.log(
          "🔍 GOOGLE ADS DEBUG: Phone processed -",
          phone,
          "→",
          normalizedPhone,
          "→",
          hashedPhone
        );
      }

      if (firstName) {
        const hashedFirstName = this.hashData(firstName);
        userIdentifiers.push({
          hashed_first_name: hashedFirstName,
        });
        console.log(
          "🔍 GOOGLE ADS DEBUG: First name processed -",
          firstName,
          "→",
          hashedFirstName
        );
      }

      if (lastName) {
        const hashedLastName = this.hashData(lastName);
        userIdentifiers.push({
          hashed_last_name: hashedLastName,
        });
        console.log(
          "🔍 GOOGLE ADS DEBUG: Last name processed -",
          lastName,
          "→",
          hashedLastName
        );
      }

      // Prepare conversion data
      const conversionValue = this.calculateConversionValue(status);

      console.log(
        "🔍 GOOGLE ADS DEBUG: Conversion mapping -",
        status,
        "→",
        conversionConfig.action
      );
      console.log("🔍 GOOGLE ADS DEBUG: Conversion value:", conversionValue);
      console.log(
        "🔍 GOOGLE ADS DEBUG: Conversion label:",
        conversionConfig.label
      );

      // Create the conversion
      const conversion = {
        conversion_action: `customers/${this.customerId}/conversionActions/${conversionConfig.label}`,
        conversion_date_time: new Date(eventTime * 1000).toISOString(),
        conversion_value: conversionValue,
        currency_code: "USD",
        order_id: applicationId || leadId, // Use application ID or lead ID as order ID
      };

      // Add click identifiers if available
      if (gclid) {
        conversion.gclid = gclid;
        console.log("🔍 GOOGLE ADS DEBUG: GCLID added:", gclid);
      }

      if (gbraid) {
        conversion.gbraid = gbraid;
        console.log("🔍 GOOGLE ADS DEBUG: GBRAID added:", gbraid);
      }

      if (wbraid) {
        conversion.wbraid = wbraid;
        console.log("🔍 GOOGLE ADS DEBUG: WBRAID added:", wbraid);
      }

      // Create conversion adjustment for Enhanced Conversions
      const conversionAdjustment = {
        conversion_action: conversion.conversion_action,
        adjustment_type: enums.ConversionAdjustmentType.ENHANCEMENT,
        order_id: conversion.order_id,
        conversion_date_time: conversion.conversion_date_time,
        adjustment_date_time: new Date().toISOString(),
        user_identifiers: userIdentifiers,
        user_agent: "Nyota CRM System", // Identify the source
        restatement_value: {
          adjusted_value: conversionValue,
          currency_code: "USD",
        },
      };

      console.log(
        "🔍 GOOGLE ADS DEBUG: Full conversion data:",
        JSON.stringify(conversion, null, 2)
      );
      console.log(
        "🔍 GOOGLE ADS DEBUG: Full enhancement data:",
        JSON.stringify(conversionAdjustment, null, 2)
      );

      // Upload conversion
      const conversionResult =
        await this.customer.conversionUploads.uploadConversions([conversion]);
      console.log(
        "🔍 GOOGLE ADS DEBUG: Conversion upload result:",
        conversionResult
      );

      // Upload enhanced conversion data
      let enhancementResult = null;
      if (userIdentifiers.length > 0) {
        try {
          enhancementResult =
            await this.customer.conversionAdjustments.uploadConversionAdjustments(
              [conversionAdjustment]
            );
          console.log(
            "🔍 GOOGLE ADS DEBUG: Enhancement upload result:",
            enhancementResult
          );
        } catch (enhancementError) {
          console.warn(
            "⚠️ Enhancement upload failed (conversion still recorded):",
            enhancementError.message
          );
        }
      }

      console.log(`✅ Google Ads conversion sent successfully for ${status}:`, {
        leadId,
        applicationId,
        action: conversionConfig.action,
        value: conversionValue,
        customerId: this.customerId,
        conversionLabel: conversionConfig.label,
        timestamp: new Date().toISOString(),
        enhanced: !!enhancementResult,
      });

      return {
        conversion: conversionResult,
        enhancement: enhancementResult,
        success: true,
      };
    } catch (error) {
      console.error("❌ Error sending Google Ads conversion:", error.message);

      // Log additional error details in development
      if (process.env.NODE_ENV === "development") {
        console.error("❌ Full error details:", error);
      }

      throw error;
    }
  }

  /**
   * Test the Google Ads Conversions API connection
   */
  async testConnection() {
    try {
      if (!this.customer) {
        throw new Error("Google Ads API not configured");
      }

      // Try to fetch account info to test connection
      const accountInfo = await this.customer.query(`
        SELECT 
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone
        FROM customer
        LIMIT 1
      `);

      console.log("✅ Google Ads API connection test successful");
      console.log("📊 Account info:", accountInfo[0]);

      // Send a test conversion with IUEA-specific data
      const timestamp = Date.now();
      const testEvent = {
        leadId: "IUEA_GOOGLE_TEST_" + timestamp,
        status: "INTERESTED",
        email: `test.student${timestamp}@iuea.ac.ug`,
        phone: `+256${Math.floor(Math.random() * 900000000) + 700000000}`,
        firstName: "Alex",
        lastName: "Kiprotich",
      };

      const result = await this.sendEnhancedConversion(testEvent);
      console.log("✅ Google Ads test conversion successful");

      return {
        success: true,
        accountInfo: accountInfo[0],
        testResult: result,
      };
    } catch (error) {
      console.error("❌ Google Ads API test failed:", error.message);
      throw error;
    }
  }

  /**
   * Get conversion actions configured in the account
   */
  async getConversionActions() {
    try {
      if (!this.customer) {
        throw new Error("Google Ads API not configured");
      }

      const conversionActions = await this.customer.query(`
        SELECT 
          conversion_action.id,
          conversion_action.name,
          conversion_action.type,
          conversion_action.category,
          conversion_action.status,
          conversion_action.primary_for_goal
        FROM conversion_action
        WHERE conversion_action.status = 'ENABLED'
      `);

      console.log("📊 Available conversion actions:");
      conversionActions.forEach((action) => {
        console.log(
          `  • ${action.conversion_action.name} (ID: ${action.conversion_action.id})`
        );
        console.log(
          `    Type: ${action.conversion_action.type}, Category: ${action.conversion_action.category}`
        );
      });

      return conversionActions;
    } catch (error) {
      console.error("❌ Error fetching conversion actions:", error.message);
      throw error;
    }
  }
}

module.exports = GoogleAdsConversionsApiService;
