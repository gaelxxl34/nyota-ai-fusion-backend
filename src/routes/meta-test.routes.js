/**
 * Test routes for Meta Conversions API integration
 */

const express = require("express");
const axios = require("axios");
const router = express.Router();
const metaConversionsApi = require("../services/metaConversionsApi.service");

/**
 * Test Meta Conversions API connection
 */
router.get("/test-meta-connection", async (req, res) => {
  try {
    console.log("🧪 Testing Meta Conversions API connection...");

    const result = await metaConversionsApi.testConnection();

    if (result.success) {
      res.json({
        success: true,
        message: "Meta Conversions API connection successful!",
        result: result.result,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Meta Conversions API connection failed",
        error: result.error,
      });
    }
  } catch (error) {
    console.error("❌ Meta connection test error:", error);
    res.status(500).json({
      success: false,
      message: "Error testing Meta connection",
      error: error.message,
    });
  }
});

/**
 * Send test enrollment conversion to Meta
 */
router.post("/test-enrollment-conversion", async (req, res) => {
  try {
    console.log("🎯 Testing enrollment conversion to Meta...");

    const timestamp = Date.now();
    const testData = {
      leadId: "IUEA_LEAD_" + timestamp,
      applicationId: "IUEA_APP_" + timestamp,
      email: req.body.email || `student${timestamp}@iuea.ac.ug`,
      phone:
        req.body.phone ||
        `+256${Math.floor(Math.random() * 900000000) + 700000000}`,
      firstName: req.body.firstName || "Jane",
      lastName: req.body.lastName || "Namukasa",
    };

    const result = await metaConversionsApi.sendEnrollmentConversion(testData);

    res.json({
      success: true,
      message: "🎉 Test ENROLLMENT conversion sent to Meta! ($2000 value)",
      testData,
      result,
    });
  } catch (error) {
    console.error("❌ Test enrollment conversion error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending test enrollment conversion",
      error: error.message,
    });
  }
});

/**
 * Send test conversion for any status
 */
router.post("/test-status-conversion", async (req, res) => {
  try {
    const { status = "QUALIFIED" } = req.body;

    console.log(`🧪 Testing ${status} conversion to Meta...`);

    const timestamp = Date.now();
    const studentNames = [
      { firstName: "James", lastName: "Muwonge" },
      { firstName: "Sarah", lastName: "Nakamya" },
      { firstName: "David", lastName: "Ssemakula" },
      { firstName: "Grace", lastName: "Namirembe" },
      { firstName: "Peter", lastName: "Okello" },
    ];

    const randomStudent =
      studentNames[Math.floor(Math.random() * studentNames.length)];

    const testData = {
      leadId: "IUEA_LEAD_" + timestamp,
      applicationId: "IUEA_APP_" + timestamp,
      status: status,
      email:
        req.body.email ||
        `${randomStudent.firstName.toLowerCase()}${timestamp}@gmail.com`,
      phone:
        req.body.phone ||
        `+256${Math.floor(Math.random() * 900000000) + 700000000}`,
      firstName: req.body.firstName || randomStudent.firstName,
      lastName: req.body.lastName || randomStudent.lastName,
    };

    const result = await metaConversionsApi.sendConversionEvent(testData);

    const valueMap = {
      INTERESTED: "$10",
      APPLIED: "$200",
      IN_REVIEW: "$100",
      QUALIFIED: "$500",
      ADMITTED: "$1000",
      ENROLLED: "$2000",
    };

    res.json({
      success: true,
      message: `🎯 Test ${status} conversion sent to Meta! (${valueMap[status]} value)`,
      testData,
      result,
    });
  } catch (error) {
    console.error(`❌ Test ${status} conversion error:`, error);
    res.status(500).json({
      success: false,
      message: `Error sending test ${status} conversion`,
      error: error.message,
    });
  }
});

/**
 * Debug Meta API connectivity and configuration
 */
router.get("/debug-meta-config", async (req, res) => {
  try {
    const config = {
      pixelId: process.env.META_PIXEL_ID ? "✅ Set" : "❌ Missing",
      accessToken: process.env.META_ACCESS_TOKEN ? "✅ Set" : "❌ Missing",
      pixelIdValue: process.env.META_PIXEL_ID
        ? process.env.META_PIXEL_ID
        : "NOT_SET",
      accessTokenPreview: process.env.META_ACCESS_TOKEN
        ? process.env.META_ACCESS_TOKEN.substring(0, 20) + "..."
        : "NOT_SET",
      apiUrl: `https://graph.facebook.com/v21.0/${process.env.META_PIXEL_ID}/events`,
    };

    res.json({
      success: true,
      message: "Meta configuration debug info",
      config,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error getting Meta config",
      error: error.message,
    });
  }
});

/**
 * Test with different event types to see which ones appear in Events Manager
 */
router.post("/test-all-events", async (req, res) => {
  try {
    console.log("🧪 Testing ALL event types to Meta...");

    const eventTypes = [
      "INTERESTED",
      "APPLIED",
      "IN_REVIEW",
      "QUALIFIED",
      "ADMITTED",
      "ENROLLED",
    ];
    const results = [];

    for (const status of eventTypes) {
      const timestamp = Date.now() + Math.floor(Math.random() * 1000);
      const testData = {
        leadId: `IUEA_LEAD_${status}_${timestamp}`,
        applicationId: `IUEA_APP_${status}_${timestamp}`,
        status: status,
        email: `test.${status.toLowerCase()}.${timestamp}@iuea.ac.ug`,
        phone: `+256${Math.floor(Math.random() * 900000000) + 700000000}`,
        firstName: "Test",
        lastName: status,
      };

      try {
        console.log(`📤 Sending ${status} event to Meta...`);
        const result = await metaConversionsApi.sendConversionEvent(testData);
        results.push({
          status,
          success: true,
          result,
          testData,
        });

        // Wait 2 seconds between events to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`❌ Error sending ${status} event:`, error.message);
        results.push({
          status,
          success: false,
          error: error.message,
          testData,
        });
      }
    }

    res.json({
      success: true,
      message: "All event types sent to Meta!",
      results,
    });
  } catch (error) {
    console.error("❌ Test all events error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending all event types",
      error: error.message,
    });
  }
});

/**
 * Verify Meta Events Manager access
 */
router.get("/verify-events-manager", async (req, res) => {
  try {
    console.log("🔍 Verifying Events Manager access...");

    // Test if we can access the pixel information
    const response = await axios.get(
      `https://graph.facebook.com/v21.0/${process.env.META_PIXEL_ID}`,
      {
        params: {
          access_token: process.env.META_ACCESS_TOKEN,
          fields: "id,name,creation_time,last_fired_time",
        },
      }
    );

    res.json({
      success: true,
      message: "✅ Events Manager access verified!",
      pixelInfo: response.data,
      instructions: {
        step1: "Go to https://business.facebook.com/events_manager",
        step2: `Select Pixel ID: ${process.env.META_PIXEL_ID}`,
        step3: "Click on 'Test Events' tab",
        step4: "Look for events with 'Nyota CRM' as source",
      },
    });
  } catch (error) {
    console.error(
      "❌ Events Manager verification error:",
      error.response?.data || error.message
    );
    res.status(500).json({
      success: false,
      message: "❌ Cannot access Events Manager",
      error: error.response?.data || error.message,
      troubleshooting: {
        issue1: "Access token may not have correct permissions",
        issue2: "Pixel ID may be incorrect",
        issue3: "Token may have expired",
        solution: "Check your Meta Business Manager settings",
      },
    });
  }
});

module.exports = router;
