const axios = require("axios");

/**
 * Webhook Forwarder Service
 * This service can be used to forward webhook data from external sources
 * to your internal webhook processing system
 */
class WebhookForwarder {
  constructor(targetUrl) {
    this.targetUrl =
      targetUrl ||
      process.env.INTERNAL_WEBHOOK_URL ||
      `${
        process.env.BACKEND_URL || "http://localhost:3000"
      }/api/webhook/receive`;
  }

  /**
   * Forward webhook data to the internal processing endpoint
   * @param {Object} webhookData - The data received from external webhook
   * @param {Object} headers - Original headers from the webhook request
   * @returns {Promise<Object>} - Response from internal processing
   */
  async forwardWebhook(webhookData, headers = {}) {
    try {
      console.log("🔄 Forwarding webhook data to internal processor...");
      console.log("📊 Data:", JSON.stringify(webhookData, null, 2));

      const response = await axios.post(this.targetUrl, webhookData, {
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-From": "External-Webhook",
          "X-Original-Source": headers["user-agent"] || "Unknown",
          ...headers,
        },
        timeout: 30000, // 30 second timeout
      });

      console.log("✅ Webhook forwarded successfully");
      return {
        success: true,
        data: response.data,
        status: response.status,
      };
    } catch (error) {
      console.error("❌ Webhook forwarding failed:", error.message);

      return {
        success: false,
        error: error.message,
        status: error.response?.status || 500,
        details: error.response?.data || "Unknown error",
      };
    }
  }

  /**
   * Test the connection to the internal webhook processor
   * @returns {Promise<boolean>} - True if connection is successful
   */
  async testConnection() {
    try {
      const testData = {
        test: true,
        timestamp: new Date().toISOString(),
        source: "webhook-forwarder-test",
      };

      const result = await this.forwardWebhook(testData);
      return result.success;
    } catch (error) {
      console.error("🚫 Connection test failed:", error.message);
      return false;
    }
  }

  /**
   * Process webhook data with enhanced error handling and logging
   * @param {Object} webhookData - Raw webhook data
   * @param {Object} metadata - Additional metadata about the webhook
   * @returns {Promise<Object>} - Processing result
   */
  async processWebhook(webhookData, metadata = {}) {
    const startTime = Date.now();

    try {
      // Log incoming webhook
      console.log("📥 Processing incoming webhook...");
      console.log("🕐 Timestamp:", new Date().toISOString());
      console.log("📋 Metadata:", JSON.stringify(metadata, null, 2));

      // Validate webhook data
      if (!webhookData || typeof webhookData !== "object") {
        throw new Error("Invalid webhook data format");
      }

      // Extract email for validation
      const email =
        webhookData.email || webhookData.user_email || webhookData.emailAddress;
      if (!email) {
        console.warn("⚠️ No email found in webhook data");
      }

      // Add processing metadata
      const enrichedData = {
        ...webhookData,
        processing: {
          receivedAt: new Date().toISOString(),
          source: "external-webhook",
          forwarderVersion: "1.0.0",
          ...metadata,
        },
      };

      // Forward to internal processor
      const result = await this.forwardWebhook(enrichedData);

      const processingTime = Date.now() - startTime;
      console.log(`⏱️ Processing completed in ${processingTime}ms`);

      return {
        ...result,
        processingTime: processingTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(
        `💥 Processing failed after ${processingTime}ms:`,
        error.message
      );

      return {
        success: false,
        error: error.message,
        processingTime: processingTime,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = WebhookForwarder;
