const crypto = require("crypto");
const axios = require("axios");

class MetaConversionsApiService {
  constructor() {
    // Meta Conversions API Configuration
    this.pixelId = process.env.META_PIXEL_ID;
    this.accessToken = process.env.META_ACCESS_TOKEN;
    this.apiVersion = "v21.0"; // Latest version
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}/${this.pixelId}/events`;

    if (!this.pixelId || !this.accessToken) {
      console.warn(
        "⚠️ Meta Conversions API not configured. Set META_PIXEL_ID and META_ACCESS_TOKEN environment variables."
      );
    }
  }

  /**
   * Hash data using SHA-256 (required by Meta)
   */
  hashData(data) {
    if (!data) return null;
    return crypto
      .createHash("sha256")
      .update(data.toLowerCase().trim())
      .digest("hex");
  }

  /**
   * Map application status to Meta event names (matches backend system exactly)
   */
  mapStatusToMetaEvent(status) {
    const statusEventMap = {
      // Main conversion funnel - matching your backend exactly
      CONTACTED: "InitiateCheckout", // Standard event - Initial contact
      INTERESTED: "Lead", // Standard event - Shows interest
      APPLIED: "SubmitApplication", // Standard event - Application submitted
      MISSING_DOCUMENT: "MissingDocument", // Custom event - Missing required documents
      IN_REVIEW: "ApplicationInReview", // Custom event - Under review
      QUALIFIED: "QualifiedLead", // Standard event - Qualified lead
      ADMITTED: "CompleteRegistration", // Standard event - Student admitted
      ENROLLED: "Purchase", // Standard event - ULTIMATE GOAL!
      // Terminal statuses
      DEFERRED: "ApplicationDeferred", // Custom event - Application deferred
      EXPIRED: "ApplicationExpired", // Custom event - Application expired
    };

    return statusEventMap[status] || "Lead";
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
   * Send conversion event to Meta Conversions API
   */
  async sendConversionEvent(eventData) {
    if (!this.pixelId || !this.accessToken) {
      console.log("📱 Meta Conversions API not configured, skipping event");
      return null;
    }

    console.log("🔍 META DEBUG: Starting conversion event send...");
    console.log("🔍 META DEBUG: Pixel ID:", this.pixelId);
    console.log("🔍 META DEBUG: Event data received:", eventData);

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
      } = eventData;

      // Prepare user data with hashed PII
      const userData = {};

      console.log("🔍 META DEBUG: Processing user data...");

      if (email) {
        const hashedEmail = this.hashData(email);
        userData.em = [hashedEmail];
        console.log(
          "🔍 META DEBUG: Email processed -",
          email,
          "→",
          hashedEmail
        );
      }

      if (phone) {
        // Normalize phone number (remove spaces, dashes, etc.)
        const normalizedPhone = phone.replace(/[\s\-\(\)]/g, "");
        const hashedPhone = this.hashData(normalizedPhone);
        userData.ph = [hashedPhone];
        console.log(
          "🔍 META DEBUG: Phone processed -",
          phone,
          "→",
          normalizedPhone,
          "→",
          hashedPhone
        );
      }

      if (firstName) {
        const hashedFirstName = this.hashData(firstName);
        userData.fn = [hashedFirstName];
        console.log(
          "🔍 META DEBUG: First name processed -",
          firstName,
          "→",
          hashedFirstName
        );
      }

      if (lastName) {
        const hashedLastName = this.hashData(lastName);
        userData.ln = [hashedLastName];
        console.log(
          "🔍 META DEBUG: Last name processed -",
          lastName,
          "→",
          hashedLastName
        );
      }

      // Add lead ID for tracking
      if (leadId) {
        userData.lead_id = leadId;
        console.log("🔍 META DEBUG: Lead ID added:", leadId);
      }

      const eventName = this.mapStatusToMetaEvent(status);
      const conversionValue = this.calculateConversionValue(status);

      console.log("🔍 META DEBUG: Event mapping -", status, "→", eventName);
      console.log("🔍 META DEBUG: Conversion value:", conversionValue);

      // Prepare event payload
      const eventPayload = {
        data: [
          {
            event_name: eventName,
            event_time: eventTime,
            action_source: "system_generated",
            user_data: userData,
            custom_data: {
              event_source: "crm",
              lead_event_source: "Nyota CRM",
              value: conversionValue,
              currency: "USD",
              content_name: "Student Application",
              content_category: "Education",
              status: status,
              application_id: applicationId || leadId,
            },
          },
        ],
      };

      console.log(
        "🔍 META DEBUG: Full event payload:",
        JSON.stringify(eventPayload, null, 2)
      );
      console.log("🔍 META DEBUG: Sending to URL:", this.baseUrl);

      // Send to Meta Conversions API
      const response = await axios.post(this.baseUrl, eventPayload, {
        params: {
          access_token: this.accessToken,
        },
        headers: {
          "Content-Type": "application/json",
        },
      });

      console.log("🔍 META DEBUG: Response status:", response.status);
      console.log(
        "🔍 META DEBUG: Response data:",
        JSON.stringify(response.data, null, 2)
      );

      console.log(`✅ Meta conversion sent successfully for ${status}:`, {
        leadId,
        applicationId,
        eventName: this.mapStatusToMetaEvent(status),
        value: this.calculateConversionValue(status),
        pixelId: this.pixelId,
        fbtrace_id: response.data?.fbtrace_id,
        timestamp: new Date().toISOString(),
      });

      return response.data;
    } catch (error) {
      console.error(
        "❌ Error sending Meta conversion:",
        error.response?.data || error.message
      );
      // Don't throw error to avoid breaking main application flow
      return null;
    }
  }

  /**
   * Send enrollment conversion (highest value event)
   */
  async sendEnrollmentConversion(studentData) {
    console.log(
      "🎯 Sending ENROLLMENT conversion to Meta - HIGHEST VALUE EVENT!"
    );

    return this.sendConversionEvent({
      ...studentData,
      status: "ENROLLED",
    });
  }

  /**
   * Test the Meta Conversions API connection
   */
  async testConnection() {
    try {
      if (!this.pixelId || !this.accessToken) {
        throw new Error("Meta Pixel ID or Access Token not configured");
      }

      // Send a test event with IUEA-specific data
      const timestamp = Date.now();
      const testEvent = {
        leadId: "IUEA_TEST_" + timestamp,
        status: "INTERESTED",
        email: `test.student${timestamp}@iuea.ac.ug`,
        phone: `+256${Math.floor(Math.random() * 900000000) + 700000000}`,
        firstName: "Alex",
        lastName: "Kiprotich",
      };

      const result = await this.sendConversionEvent(testEvent);
      console.log("✅ Meta Conversions API test successful");
      return { success: true, result };
    } catch (error) {
      console.error("❌ Meta Conversions API test failed:", error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new MetaConversionsApiService();
