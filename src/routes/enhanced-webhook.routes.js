const express = require("express");
const router = express.Router();
const { admin } = require("../config/firebase.config");
const { LEAD_SOURCES } = require("../config/lead.constants");
const WebhookForwarder = require("../services/webhookForwarder");
const LeadService = require("../services/leadService");
// Import the WhatsAppMessageService class
const WhatsAppMessageService = require("../services/whatsappMessageService");
const { getFirestore } = require("firebase-admin/firestore");
const ConversationService = require("../services/conversationService");
const ApplicationService = require("../services/applicationService");
const logger = require("../utils/logger");

// Initialize services properly to avoid circular dependencies
let db, leadService, conversationService, whatsappMessageService;

try {
  db = getFirestore();
  leadService = new LeadService(db);
  conversationService = new ConversationService(db);
  whatsappMessageService = new WhatsAppMessageService(
    db,
    leadService,
    conversationService
  );

  if (!whatsappMessageService) {
    throw new Error("WhatsApp message service could not be initialized");
  }

  logger.info("WhatsApp message service initialized successfully");
} catch (error) {
  logger.error(
    "Error initializing services in enhanced-webhook.routes.js:",
    error
  );
  // We don't re-throw here to prevent the module from failing to load completely
}

// Helper: lazily ensure services exist (in case init above failed)
function ensureServices() {
  if (!db) db = getFirestore();
  if (!leadService) leadService = new LeadService(db);
  if (!conversationService) conversationService = new ConversationService(db);
  if (!whatsappMessageService)
    whatsappMessageService = new WhatsAppMessageService(
      db,
      leadService,
      conversationService
    );
}

// Helper: send a WhatsApp validation template and store message
async function sendWhatsAppTemplate(toNumber, meta = {}) {
  try {
    logger.info("sendWhatsAppTemplate called with:", {
      toNumber,
      toNumberType: typeof toNumber,
      toNumberLength: toNumber ? toNumber.length : 0,
      meta,
    });

    if (!toNumber) {
      logger.warn("sendWhatsAppTemplate: toNumber is empty/null");
      return;
    }

    ensureServices();

    const payload = {
      messaging_product: "whatsapp",
      to: toNumber,
      type: "template",
      template: {
        name: "whatsapp_validation",
        language: { code: "en_US" },
      },
    };

    logger.info("WhatsApp payload being sent:", payload);

    await whatsappMessageService.sendTemplateMessage(toNumber, payload, meta);
    logger.info(`WhatsApp template sent to ${toNumber}`);
  } catch (err) {
    logger.error(`Failed to send WhatsApp template to ${toNumber}:`, err);
  }
}

// No validation configuration needed - all validation has been removed

// Simplified middleware with no validation
const validateWebhookSource = (req, res, next) => {
  // Log the webhook request
  logger.info(`Webhook request received: ${req.path}`);

  // Always proceed without validation
  next();
};

// Store pending validations - this map is kept for backward compatibility but not used anymore
const pendingValidations = new Map();

/**
 * Simple phone number normalizer without validation
 * @param {string} phone - The phone number to normalize
 * @returns {Object} Normalized phone with success result
 */
const normalizePhoneNumber = (phone) => {
  try {
    // Just normalize the phone number without validation
    const normalizedPhone = phone
      .toString()
      .replace(/^\+/, "")
      .replace(/\D/g, "");

    logger.debug(`Normalized phone number: ${normalizedPhone}`);

    return {
      isValid: true,
      normalizedPhone,
      validationResult: {
        success: true,
        messageId: "no-validation-" + Date.now(),
      },
    };
  } catch (error) {
    logger.error(`Error normalizing phone number: ${error.message}`);
    return {
      isValid: true, // Always return valid for compatibility
      normalizedPhone: phone.toString(),
      validationResult: {
        success: true,
        messageId: "error-normalization-" + Date.now(),
      },
    };
  }
};

/**
 * Process WordPress website inquiries
 * This handles form submissions from the WordPress website
 * Expected fields: firstname, lastname, email, phone, message
 */
router.post("/wordpress", validateWebhookSource, async (req, res) => {
  try {
    ensureServices();

    // Log incoming WordPress webhook data
    logger.info("📝 WordPress webhook received:", {
      formData: req.body,
      source: req.headers["user-agent"] || "Unknown",
      contentType: req.headers["content-type"],
    });

    // Debug mode for troubleshooting
    if (req.query.debug === "raw") {
      return res.status(200).json({
        mode: "debug",
        received: req.body,
        headers: req.headers,
        timestamp: new Date().toISOString(),
      });
    }

    // Process form data (WordPress sends as direct object)
    let formData = req.body || {};

    // Extract WordPress fields with flexible field name matching
    const firstName =
      (
        formData.firstname ??
        formData["First Name"] ??
        formData.first_name ??
        ""
      )
        .toString()
        .trim() || null;

    const lastName =
      (formData.lastname ?? formData["Last Name"] ?? formData.last_name ?? "")
        .toString()
        .trim() || null;

    const email =
      (formData.email ?? formData["Email"] ?? formData.Email ?? "")
        .toString()
        .trim() || null;

    const phone =
      (
        formData.phone ??
        formData["Phone"] ??
        formData["Phone Number"] ?? // Handle "Phone Number" label
        formData["Phone "] ?? // Handle WordPress trailing space
        formData.Phone ??
        ""
      )
        .toString()
        .trim() || null;

    const message =
      (
        formData.message ??
        formData["Message"] ??
        formData["Messege"] ?? // Handle WordPress typo
        formData.Messege ??
        ""
      )
        .toString()
        .trim() || null;

    // Build display name from first/last
    const name = `${firstName || ""} ${lastName || ""}`.trim() || "Unknown";

    // Log extracted contact information
    logger.info("✅ Extracted contact info:", {
      firstName,
      lastName,
      name,
      email,
      phone,
      message: message ? `${message.substring(0, 50)}...` : null,
    });

    // Normalize phone number if available
    let validatedPhone = null;
    if (phone && phone.trim()) {
      validatedPhone = phone.toString().replace(/^\+/, "").replace(/\D/g, "");
      logger.info(`📞 Phone normalized: "${phone}" -> "${validatedPhone}"`);
    }

    // Ensure services are initialized
    ensureServices();

    // Check for duplicate leads by phone or email
    let existingLead = null;
    let actionTaken = "";

    // First check by phone number if available - use normalized phone for consistent lookup
    if (validatedPhone) {
      existingLead = await leadService.findLeadByPhone(validatedPhone);
    }

    // If no lead found by phone, check by email
    if (!existingLead && email) {
      existingLead = await leadService.findLeadByEmail(email);
    }

    let leadId;
    let statusNote = "";

    if (existingLead) {
      // Update existing lead with WordPress inquiry
      logger.info(
        `🔄 Updating existing lead ${existingLead.id} with new inquiry`
      );

      leadId = existingLead;

      // Add interaction entry for WordPress source
      await leadService.addInteraction(existingLead.id, {
        type: "WEBSITE_INQUIRY",
        content: `New inquiry from WordPress website: ${
          message || "No message provided"
        }`,
        channel: "WEBSITE",
        automated: true,
        direction: "incoming",
        metadata: {
          source: "WordPress",
          rawData: formData,
        },
      });

      actionTaken = "updated_existing_lead";
      statusNote = `Updated existing lead with WordPress inquiry`;
    } else {
      // Create new lead record
      logger.info("🆕 Creating new lead from WordPress form submission");

      const leadData = {
        firstName,
        lastName,
        name,
        email,
        phone: validatedPhone || phone,
        message,
        status: "CONTACTED",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      leadId = await leadService.createLead(leadData, LEAD_SOURCES.WEBSITE);
      actionTaken = "created_new_lead";
      statusNote = "New lead created from WordPress contact form";
    }

    // Send WhatsApp template if phone is available
    const toNumber = (validatedPhone || phone || "")
      .toString()
      .replace(/\D/g, "");

    if (toNumber) {
      await sendWhatsAppTemplate(toNumber, {
        leadId: leadId?.id || leadId,
        contactName: name,
        source: "WordPress",
        messageType: "whatsapp_validation",
      });
      statusNote += " (WhatsApp validation sent)";
    }

    const successResponse = {
      success: true,
      message: "WordPress webhook processed successfully",
      leadId: leadId?.id || leadId,
      actionTaken,
      statusNote,
    };

    logger.info(`✅ WordPress webhook completed:`, {
      action: actionTaken,
      leadId: leadId?.id || leadId,
      contact: `${name} (${email || phone})`,
    });

    res.status(200).json(successResponse);
  } catch (error) {
    logger.error("❌ Error processing WordPress webhook:", error.message);

    // Return user-friendly error message
    res.status(400).json({
      success: false,
      message:
        "We're having trouble processing your submission. Please try again.",
      error: true,
    });
  }
});

/**
 * Process Google Ads lead form submissions
 * Expected fields: firstname, lastname, email, phone, program_interested
 */
router.post("/google-ads", validateWebhookSource, async (req, res) => {
  try {
    ensureServices();
    const formData = req.body;
    logger.webhook("Google Ads", formData);

    if (!formData || Object.keys(formData).length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No form data received" });
    }

    // Extract
    const firstName =
      formData.firstname ||
      formData.first_name ||
      formData["First Name"] ||
      formData["first_name"];
    const lastName =
      formData.lastname ||
      formData.last_name ||
      formData["Last Name"] ||
      formData["last_name"];
    const email =
      formData.email ||
      formData["Email"] ||
      formData["Enter your email"] ||
      formData["email"];
    const phone =
      formData.phone ||
      formData["Phone Number"] ||
      formData["Phone Number / WhatsApp"] ||
      formData["Phone"] ||
      formData["phone"];
    const programInterested =
      formData.program_interested ||
      formData.program ||
      formData["Preferred Program"] ||
      formData["Program of Interest"] ||
      formData.course_interested ||
      formData["Course of Interest"] ||
      formData.course_of_interest ||
      formData["course_of_interest"] ||
      null;

    const name = `${firstName || ""} ${lastName || ""}`.trim() || "Unknown";

    // Normalize phone to digits
    const normalizedPhone = phone ? phone.toString().replace(/\D/g, "") : null;

    // Duplicate check
    let existingLead = null;
    if (normalizedPhone)
      existingLead = await leadService.findLeadByPhone(normalizedPhone);
    if (!existingLead && email)
      existingLead = await leadService.findLeadByEmail(email);

    let leadId;
    let actionTaken;
    let statusNote = "";

    if (existingLead) {
      leadId = existingLead;
      actionTaken = "updated_existing_lead";
      statusNote = `Updated existing lead (${
        existingLead.email || existingLead.phone
      }) with Google Ads inquiry`;

      await leadService.addInteraction(existingLead.id, {
        type: "GOOGLE_ADS_INQUIRY",
        content: `New inquiry from Google Ads - ${
          programInterested
            ? `interested in ${programInterested}`
            : "program inquiry"
        }`,
        channel: "GOOGLE_ADS",
        automated: true,
        direction: "incoming",
        metadata: {
          programInterested,
          source: "Google Ads",
          campaignData: { raw: formData },
        },
      });
    } else {
      const leadData = {
        firstName,
        lastName,
        name,
        email,
        phone: normalizedPhone,
        program: programInterested,
        status: "CONTACTED",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      leadId = await leadService.createLead(leadData, LEAD_SOURCES.GOOGLE_ADS);
      actionTaken = "created_new_lead";
      statusNote =
        "New lead created from Google Ads contact form (user initiated contact)";
    }

    if (normalizedPhone) {
      await sendWhatsAppTemplate(normalizedPhone, {
        leadId: leadId?.id || leadId,
        contactName: name,
        source: "Google Ads",
        messageType: "whatsapp_validation",
        programInterest: programInterested,
      });
      statusNote += " (WhatsApp validation message sent)";
    }

    res.status(200).json({
      success: true,
      message: "Google Ads webhook processed successfully",
      actionTaken,
      leadId: leadId?.id || leadId,
      statusNote,
      leadInfo: {
        name,
        email,
        program: programInterested,
        source: "Google Ads",
        isExisting: !!existingLead,
      },
    });
  } catch (error) {
    logger.error("Google Ads webhook error:", error);
    res.status(200).json({
      success: false,
      message:
        "We're having trouble processing your submission. Please try again.",
      data: {
        message:
          "We're having trouble processing your submission. Please try again.",
      },
    });
  }
});

/**
 * Test endpoint for Meta Lead Ads webhook
 */
router.post("/test-meta-lead-ads", validateWebhookSource, async (req, res) => {
  try {
    ensureServices();

    logger.info("🧪 Testing Meta Lead Ads webhook processing...");

    // Simulate a Meta Lead Ads webhook payload
    const testLeadData = {
      id: "test_lead_" + Date.now(),
      created_time: new Date().toISOString(),
      field_data: [
        { name: "first_name", values: ["John"] },
        { name: "last_name", values: ["Doe"] },
        { name: "email", values: ["john.doe@example.com"] },
        { name: "phone_number", values: ["+256700123456"] },
        {
          name: "program_interested_in",
          values: ["Bachelor of Information Technology"],
        },
        { name: "country", values: ["Uganda"] },
        { name: "city", values: ["Kampala"] },
      ],
      form_id: "test_form_123",
      campaign_id: "test_campaign_123",
      ad_id: "test_ad_123",
      adset_id: "test_adset_123",
    };

    // Process the test lead using the same function as real webhooks
    await processMetaLead(testLeadData, testLeadData.id);

    res.status(200).json({
      success: true,
      message: "✅ Meta Lead Ads webhook test completed successfully!",
      testData: testLeadData,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("❌ Meta Lead Ads webhook test failed:", error);
    res.status(500).json({
      success: false,
      message: "Meta Lead Ads webhook test failed",
      error: error.message,
    });
  }
});

/**
 * Process Meta Lead Ads webhook (Facebook/Instagram Lead Generation)
 * This handles leads specifically from Meta Lead Ads campaigns
 */
router.get("/meta-lead-ads", (req, res) => {
  // Facebook webhook verification
  const VERIFY_TOKEN =
    process.env.META_WEBHOOK_VERIFY_TOKEN || "your_verify_token";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  logger.info("Meta Lead Ads webhook verification:", {
    mode,
    token,
    challenge,
  });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    logger.info("✅ Meta Lead Ads webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    logger.error("❌ Meta Lead Ads webhook verification failed");
    res.sendStatus(403);
  }
});

/**
 * Meta Ads webhook verification endpoint
 * This handles webhook verification for Meta Ads campaigns
 */
router.get("/meta-ads", (req, res) => {
  // Facebook webhook verification
  const VERIFY_TOKEN =
    process.env.META_WEBHOOK_VERIFY_TOKEN || "NYOTA_META_VERIFY_2025";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  logger.info("Meta Ads webhook verification:", {
    mode,
    token,
    challenge,
  });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    logger.info("✅ Meta Ads webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    logger.error("❌ Meta Ads webhook verification failed");
    res.sendStatus(403);
  }
});

router.post("/meta-lead-ads", validateWebhookSource, async (req, res) => {
  try {
    ensureServices();

    logger.info(
      "📱 Meta Lead Ads webhook received:",
      JSON.stringify(req.body, null, 2)
    );

    const data = req.body;

    // Validate Meta webhook structure
    if (!data.entry || !Array.isArray(data.entry)) {
      logger.warn("Invalid Meta webhook payload - missing entry array");
      return res.status(200).send("OK"); // Always return 200 to Meta
    }

    // Process each entry
    for (const entry of data.entry) {
      if (!entry.changes || !Array.isArray(entry.changes)) {
        logger.warn("Invalid entry - missing changes array");
        continue;
      }

      // Process each change
      for (const change of entry.changes) {
        if (change.field !== "leadgen") {
          logger.info(`Skipping non-leadgen change: ${change.field}`);
          continue;
        }

        const leadgenId = change.value?.leadgen_id;
        if (!leadgenId) {
          logger.warn("Missing leadgen_id in change value");
          continue;
        }

        logger.info(`🎯 Processing Meta Lead Ad: ${leadgenId}`);

        try {
          // Fetch lead data from Meta Graph API
          const leadData = await fetchMetaLeadData(leadgenId);

          if (!leadData) {
            logger.error(`Failed to fetch lead data for ${leadgenId}`);
            continue;
          }

          // Process the lead data
          await processMetaLead(leadData, leadgenId);
        } catch (leadError) {
          logger.error(`Error processing lead ${leadgenId}:`, leadError);
          // Continue processing other leads even if one fails
        }
      }
    }

    // Always return 200 to Meta to confirm receipt
    res.status(200).send("OK");
  } catch (error) {
    logger.error("❌ Error processing Meta Lead Ads webhook:", error);
    // Always return 200 to Meta even on error to prevent retries
    res.status(200).send("OK");
  }
});

/**
 * Fetch lead data from Meta Graph API
 */
async function fetchMetaLeadData(leadgenId) {
  try {
    const axios = require("axios");
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!accessToken) {
      throw new Error("META_ACCESS_TOKEN not configured");
    }

    const url = `https://graph.facebook.com/v18.0/${leadgenId}`;
    const response = await axios.get(url, {
      params: {
        access_token: accessToken,
        fields: "id,created_time,field_data,form_id,campaign_id,ad_id,adset_id",
      },
    });

    logger.info(`✅ Fetched lead data for ${leadgenId}:`, response.data);
    return response.data;
  } catch (error) {
    logger.error(
      `❌ Failed to fetch lead data for ${leadgenId}:`,
      error.response?.data || error.message
    );
    return null;
  }
}

/**
 * Process Meta lead data and create/update lead in CRM
 */
async function processMetaLead(leadData, leadgenId) {
  try {
    // Extract field data from Meta lead
    const fieldData = leadData.field_data || [];
    const extractedData = {};
    const allFieldData = {}; // Store ALL fields for complete data capture

    // Convert Meta field data to key-value pairs - capture EVERYTHING
    fieldData.forEach((field) => {
      const name = field.name?.toLowerCase();
      const originalName = field.name; // Keep original field name
      const values = field.values || [];

      if (values.length > 0) {
        extractedData[name] = values[0]; // Take first value
        allFieldData[originalName] = values; // Store all values with original field name
      }
    });

    logger.info("📋 Extracted Meta lead data:", extractedData);
    logger.info("📋 All Meta field data captured:", allFieldData);

    // Map Meta fields to our CRM fields - flexible mapping for any field structure
    const firstName =
      extractedData.first_name ||
      extractedData.firstname ||
      extractedData.name?.split(" ")[0] ||
      "";
    const lastName =
      extractedData.last_name ||
      extractedData.lastname ||
      extractedData.name?.split(" ").slice(1).join(" ") ||
      "";
    const email =
      extractedData.email ||
      extractedData.email_address ||
      extractedData.e_mail ||
      "";
    const phone =
      extractedData.phone_number ||
      extractedData.phone ||
      extractedData.mobile ||
      extractedData.whatsapp ||
      "";
    const program =
      extractedData.program_interested_in ||
      extractedData.program_of_interest ||
      extractedData.course ||
      extractedData.program ||
      "";
    const country =
      extractedData.country ||
      extractedData.country_of_residence ||
      extractedData.nationality ||
      "";
    const city = extractedData.city || extractedData.location || "";

    // Additional flexible field mapping - capture any other common fields
    const age = extractedData.age || "";
    const gender = extractedData.gender || "";
    const education =
      extractedData.education || extractedData.education_level || "";
    const experience =
      extractedData.experience || extractedData.work_experience || "";
    const company = extractedData.company || extractedData.employer || "";
    const budget =
      extractedData.budget || extractedData.investment_budget || "";
    const timeline = extractedData.timeline || extractedData.start_date || "";

    const name =
      `${firstName} ${lastName}`.trim() ||
      extractedData.full_name ||
      extractedData.name ||
      "Unknown";

    // PRIMARY FOCUS: Email duplicate checking
    if (!email) {
      logger.error(
        `❌ Meta lead ${leadgenId} has no email - skipping (email is required for duplicate checking)`
      );
      return;
    }

    // Normalize phone number
    let normalizedPhone = null;
    if (phone && phone.trim()) {
      normalizedPhone = phone.toString().replace(/^\+/, "").replace(/\D/g, "");
    }

    // Check for existing lead - EMAIL FIRST for duplicate prevention
    let existingLead = null;
    let actionTaken = "";

    // PRIMARY: Check by email first (main duplicate prevention)
    existingLead = await leadService.findLeadByEmail(email);

    // SECONDARY: If no email match, check by phone (only if phone exists)
    if (!existingLead && normalizedPhone) {
      existingLead = await leadService.findLeadByPhone(normalizedPhone);
    }

    let leadId;
    let statusNote = "";

    if (existingLead) {
      // Update existing lead with additional Meta Lead Ads data
      leadId = existingLead;
      actionTaken = "updated_existing_lead";
      statusNote = `Updated existing lead with Meta Lead Ad inquiry (duplicate email: ${email})`;

      // Add comprehensive interaction with ALL captured data
      await leadService.addInteraction(existingLead.id, {
        type: "META_LEAD_AD",
        content: `New lead from Meta Lead Ads - ${
          program ? `interested in ${program}` : "program inquiry"
        }`,
        channel: "META_LEAD_ADS",
        automated: true,
        direction: "incoming",
        metadata: {
          leadgenId,
          program,
          country,
          city,
          age,
          gender,
          education,
          experience,
          company,
          budget,
          timeline,
          source: "Meta Lead Ads",
          formId: leadData.form_id,
          campaignId: leadData.campaign_id,
          adId: leadData.ad_id,
          adsetId: leadData.adset_id,
          createdTime: leadData.created_time,
          allFieldData: allFieldData, // Store ALL captured field data
          extractedData: extractedData, // Store processed data
          rawData: leadData,
        },
      });

      // Update lead record with any new information
      const updateData = {
        lastContactDate: admin.firestore.FieldValue.serverTimestamp(),
        lastContactSource: "Meta Lead Ads",
      };

      // Add phone if not present
      if (normalizedPhone && !existingLead.phone) {
        updateData.phone = normalizedPhone;
      }

      // Add any missing fields
      if (program && !existingLead.program) updateData.program = program;
      if (country && !existingLead.country) updateData.country = country;
      if (city && !existingLead.city) updateData.city = city;

      await leadService.updateLead(existingLead.id, updateData);
    } else {
      // Create new lead record with ALL captured data
      const newLeadData = {
        firstName,
        lastName,
        name,
        email,
        phone: normalizedPhone || phone,
        program,
        country,
        city,
        age,
        gender,
        education,
        experience,
        company,
        budget,
        timeline,
        status: "CONTACTED",
        source: LEAD_SOURCES.META_ADS,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        metaLeadAdsData: {
          leadgenId,
          formId: leadData.form_id,
          campaignId: leadData.campaign_id,
          adId: leadData.ad_id,
          adsetId: leadData.adset_id,
          createdTime: leadData.created_time,
          allFieldData: allFieldData, // Store ALL original field data
          extractedData: extractedData, // Store processed field data
          rawFieldData: fieldData,
        },
      };

      leadId = await leadService.createLead(newLeadData, LEAD_SOURCES.META_ADS);
      actionTaken = "created_new_lead";
      statusNote =
        "New lead created from Meta Lead Ads with complete data capture";
    }

    // Send WhatsApp message if phone available
    if (normalizedPhone) {
      await sendWhatsAppTemplate(normalizedPhone, {
        leadId: leadId?.id || leadId,
        contactName: name,
        source: "Meta Lead Ads",
        messageType: "whatsapp_validation",
        programInterest: program,
        leadgenId: leadgenId,
      });
      statusNote += " (WhatsApp validation sent)";
    }

    logger.info(`✅ Meta Lead Ad processed successfully:`, {
      leadgenId,
      actionTaken,
      leadId: leadId?.id || leadId,
      contact: `${name} (${email || phone})`,
    });
  } catch (error) {
    logger.error(`❌ Error processing Meta lead ${leadgenId}:`, error);
    throw error;
  }
}

/**
 * Process Meta (Facebook) Ads webhook (simplified)
 */
router.post("/meta-ads", validateWebhookSource, async (req, res) => {
  try {
    ensureServices();
    const formData = req.body || {};
    logger.webhook("Meta Ads", formData);

    const firstName = formData.first_name || formData.firstname || "";
    const lastName = formData.last_name || formData.lastname || "";
    const email = formData.email || "";
    const phone = formData.phone || formData.whatsapp_number || "";
    const program = formData.program_interested_in || formData.program || "";
    const country = formData.country_of_origin || formData.country || "";

    if (!email && !phone) {
      return res
        .status(400)
        .json({ success: false, error: "Either email or phone is required" });
    }

    const name = `${firstName || ""} ${lastName || ""}`.trim() || "Unknown";
    const normalizedPhone = phone ? phone.toString().replace(/\D/g, "") : null;

    // Duplicate check
    let existingLead = null;
    if (normalizedPhone)
      existingLead = await leadService.findLeadByPhone(normalizedPhone);
    if (!existingLead && email)
      existingLead = await leadService.findLeadByEmail(email);

    let leadId;
    let actionTaken;
    let statusNote = "";

    if (existingLead) {
      leadId = existingLead;
      actionTaken = "updated_existing_lead";
      statusNote = `Updated existing lead (${
        existingLead.email || existingLead.phone
      }) with Meta Ads inquiry`;

      await leadService.addInteraction(existingLead.id, {
        type: "META_ADS_INQUIRY",
        content: `New inquiry from Meta Ads - ${
          program ? `interested in ${program}` : "program inquiry"
        }`,
        channel: "META_ADS",
        automated: true,
        direction: "incoming",
        metadata: {
          program,
          country,
          source: "Meta Ads",
          campaignData: { formData },
        },
      });
    } else {
      const newLeadData = {
        firstName,
        lastName,
        name,
        email,
        phone: normalizedPhone || phone,
        program,
        country,
        status: "INTERESTED",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      leadId = await leadService.createLead(newLeadData, LEAD_SOURCES.META_ADS);
      actionTaken = "created_new_lead";
      statusNote =
        "New lead created from Meta Ads contact form (user initiated contact)";
    }

    if (normalizedPhone) {
      await sendWhatsAppTemplate(normalizedPhone, {
        leadId: leadId?.id || leadId,
        contactName: name,
        source: "Meta Ads",
        messageType: "whatsapp_validation",
        programInterest: program,
      });
      statusNote += " (WhatsApp validation message sent)";
    }

    return res.status(200).json({
      success: true,
      message: "Meta Ads lead successfully processed",
      actionTaken,
      leadId: leadId?.id || leadId,
      statusNote,
      leadInfo: {
        name,
        email,
        program,
        source: "Meta Ads",
        isExisting: !!existingLead,
      },
    });
  } catch (error) {
    logger.error("Error processing Meta Ads webhook:", error);
    return res
      .status(500)
      .json({ success: false, error: "Failed to process Meta Ads webhook" });
  }
});

/**
 * Process application form submissions from official website
 * Expected fields: firstname, lastname, email, phone, country_of_birth,
 * gender, mode_of_study, intake, course_of_interest, course_of_interest2
 */
router.post("/application-form", validateWebhookSource, async (req, res) => {
  try {
    // Initialize response variables
    let actionTaken = "";
    let leadId = null;
    let applicationId = null;
    let statusNote = "";

    const formData = req.body;
    logger.webhook("Application Form", formData);

    // Extract all application fields including the additional requested fields
    const firstName = formData["firstname"] || formData["First Name"];
    const lastName = formData["lastname"] || formData["Last Name"];
    const email = formData["email"] || formData["Email Address"];
    const phone = formData["phone"] || formData["Telephone/Mobile No"];
    const countryOfBirth =
      formData["country_of_birth"] || formData["Country of Birth"];
    const gender = formData["gender"] || formData["Gender"];
    const modeOfStudy = formData["mode_of_study"] || formData["Mode of Study"];
    const intake = formData["intake"] || formData["Preferred Intake"];
    const courseOfInterest =
      formData["course_of_interest"] || formData["Preferred Program"];
    const courseOfInterest2 =
      formData["course_of_interest2"] || formData["Other Sources"];

    // Additional fields requested to be captured
    const passportPhoto = formData["passport_photo"] || null;
    const postalAddress = formData["postal_address"] || null;
    const academicDocuments = formData["academic_documents"] || null;
    const identificationDocument = formData["identification_document"] || null;
    const sponsor = formData["sponsor"] || null;
    const sponsorTelephone = formData["sponsor_telephone"] || null;
    const sponsorEmail = formData["sponsor_email"] || null;

    // Combine first and last name
    const name = `${firstName || ""} ${lastName || ""}`.trim() || "Unknown";

    // No validation required for any fields

    // Just normalize the phone number if available
    let validatedPhone = null;
    if (phone && phone.trim()) {
      // Simple normalization without validation
      validatedPhone = phone.toString().replace(/^\+/, "").replace(/\D/g, "");
    }

    // Initialize services
    const db = admin.firestore();
    const leadService = new LeadService(db);
    const applicationService = new ApplicationService(
      db,
      leadService,
      whatsappMessageService
    );

    // Since submitApplication handles lead checking and creation internally,
    // we can use it directly
    try {
      // Helper function to normalize values for validation
      const normalizeGender = (value) => {
        if (!value) return null;
        const normalized = value.toLowerCase().trim();
        switch (normalized) {
          case "male":
            return "male";
          case "female":
            return "female";
          default:
            return null;
        }
      };

      const normalizeModeOfStudy = (value) => {
        if (!value) return null;
        const normalized = value.toLowerCase().trim();
        switch (normalized) {
          case "on-campus":
          case "on campus":
          case "oncampus":
            return "On Campus";
          case "online":
            return "Online";
          default:
            return null;
        }
      };

      const normalizeIntake = (value) => {
        if (!value) return null;
        const normalized = value.toLowerCase().trim();
        switch (normalized) {
          case "january":
          case "jan":
            return "January";
          case "may":
            return "May";
          case "august":
          case "aug":
            return "August";
          default:
            return null;
        }
      };

      const normalizeProgram = (value) => {
        if (!value || value.trim() === "") return null;
        const normalized = value.toLowerCase().trim();

        // Map program names to full display names
        if (
          normalized.includes("bachelor") &&
          normalized.includes("information technology")
        ) {
          return "Bachelor of Information Technology";
        } else if (
          normalized.includes("bachelor") &&
          normalized.includes("business administration")
        ) {
          return "Bachelor of Business Administration";
        } else if (
          normalized.includes("bachelor") &&
          normalized.includes("commerce")
        ) {
          return "Bachelor of Commerce";
        } else if (
          normalized.includes("master") &&
          normalized.includes("information technology")
        ) {
          return "Master of Information Technology";
        } else if (
          normalized.includes("master") &&
          normalized.includes("business administration")
        ) {
          return "Master of Business Administration";
        } else if (
          normalized.includes("diploma") &&
          normalized.includes("information technology")
        ) {
          return "Diploma in Information Technology";
        } else if (
          normalized.includes("diploma") &&
          normalized.includes("business administration")
        ) {
          return "Diploma in Business Administration";
        } else if (normalized.includes("certificate")) {
          return "Certificate Programs";
        }

        // Default fallback - if no match found, use the first available program
        logger.warn(
          `Unknown program "${value}", defaulting to Bachelor of Information Technology`
        );
        return "Bachelor of Information Technology";
      };

      // Create application data with all fields mapped to expected format
      const applicationData = {
        name,
        email,
        phoneNumber: validatedPhone || phone,
        countryOfBirth,
        gender: normalizeGender(gender),
        modeOfStudy: normalizeModeOfStudy(modeOfStudy),
        preferredIntake: normalizeIntake(intake),
        preferredProgram: normalizeProgram(courseOfInterest),
        // New fields added as requested
        passportPhoto: passportPhoto || null,
        postalAddress: postalAddress || null,
        secondaryProgram: courseOfInterest2 || null,
        academicDocuments: academicDocuments || null,
        identificationDocument: identificationDocument || null,
        sponsor: sponsor || null,
        sponsorTelephone: sponsorTelephone || null,
        sponsorEmail: sponsorEmail || null,
        // Set stage to "new" just like in manual applications
        stage: "new",
        additionalInfo: {
          firstName,
          lastName,
          originalValues: {
            gender: gender,
            modeOfStudy: modeOfStudy,
            preferredIntake: intake,
            preferredProgram: courseOfInterest,
          },
        },
      };

      const result = await applicationService.submitApplication(
        applicationData
      );

      // Extract IDs from the result
      applicationId = result.application;
      leadId = result.lead?.id;

      // Check if timeline exists and is an array before trying to find in it
      const hasAppliedStatus =
        result.lead &&
        result.lead.timeline &&
        Array.isArray(result.lead.timeline) &&
        result.lead.timeline.find((t) => t.status === "APPLIED");

      if (result.lead && !hasAppliedStatus) {
        actionTaken = "created_new_lead_and_application";
        statusNote = "New lead and application created successfully";
      } else {
        actionTaken = "updated_existing_lead_with_application";
        statusNote =
          "Existing lead updated to APPLIED status with new application";
      }

      // ApplicationService handles WhatsApp messaging internally
      // No need for duplicate messaging from webhook
      if (phone && phone.trim()) {
        statusNote += " (WhatsApp confirmation handled by ApplicationService)";
      } else {
        statusNote += " (No phone number provided for WhatsApp confirmation)";
      }

      logger.info(
        `Application processed: ${result.application.id}, Lead: ${result.lead?.id}`
      );
    } catch (submitError) {
      logger.error("Error submitting application:", submitError);

      // Elementor expects 200 status with success: false for errors
      return res.status(200).json({
        success: false,
        message: "Failed to submit application. Please try again.",
        data: {
          message: "Failed to submit application. Please try again.",
        },
      });
    }

    // Note: All WhatsApp messaging is now handled entirely by ApplicationService
    // This completely eliminates the double messaging issue

    res.status(200).json({
      success: true,
      message: "Application form webhook processed successfully",
      actionTaken,
      leadId: leadId,
      applicationId: applicationId?.id || null,
      statusNote,
      applicantInfo: {
        name,
        email,
        courseOfInterest,
        modeOfStudy,
        intake,
        gender,
        countryOfBirth,
      },
    });
  } catch (error) {
    logger.error("Error processing application form webhook:", error);

    // Return user-friendly error message in Elementor format
    let userMessage =
      "We're having trouble processing your application. Please try again.";

    // Check for specific error types
    if (error.message && error.message.includes("validation")) {
      userMessage =
        "Application validation failed. Please check your information and try again.";
    } else if (error.message && error.message.includes("Firebase")) {
      userMessage =
        "System temporarily unavailable. Please try again in a moment.";
    }

    // Elementor expects 200 status with success: false for errors
    res.status(200).json({
      success: false,
      message: userMessage,
      data: {
        message: userMessage,
      },
    });
  }
});

// Keep the original generic webhook for backward compatibility
router.post("/receive", async (req, res) => {
  try {
    const formData = req.body;
    logger.webhook("Generic", formData);

    // Attempt to detect the source based on payload structure
    let detectedSource = "unknown";

    if (formData.entry && formData.object) {
      // Likely a Meta/Facebook payload
      return res.redirect(307, "/api/webhook/meta-ads");
    } else if (formData.google_campaign_id || formData.gclid) {
      // Likely a Google Ads payload
      return res.redirect(307, "/api/webhook/google-ads");
    } else if (formData["your-email"] || formData["your-name"]) {
      // Likely a WordPress Contact Form 7 payload
      return res.redirect(307, "/api/webhook/wordpress");
    } else if (formData.degree_level || formData.previousEducation) {
      // Likely an application form
      return res.redirect(307, "/api/webhook/application-form");
    }

    // Process as generic lead if no specific format is detected
    // Extract data using the flexible field mapping from the original implementation
    const email =
      formData.email ||
      formData.user_email ||
      formData.emailAddress ||
      formData["Email"] ||
      formData["Email Address"];

    const firstName =
      formData.firstName || formData["First Name"] || formData.first_name;

    const lastName =
      formData.lastName ||
      formData["Last Name"] ||
      formData["Second Name"] ||
      formData.last_name;

    const name =
      formData.name ||
      formData.full_name ||
      (firstName && lastName
        ? `${firstName} ${lastName}`
        : firstName || lastName || "Unknown");

    const phone =
      formData.phone ||
      formData.phoneNumber ||
      formData.contact_number ||
      formData["WhatsApp Number"] ||
      formData["Telephone/Mobile No"];

    const program =
      formData.program ||
      formData.course ||
      formData.program_interest ||
      formData["Preferred Program"];

    // Simple phone number formatting without complex validation
    let validatedPhone = null;
    if (phone && phone.trim()) {
      // Just normalize the phone number - remove + and non-digits
      validatedPhone = phone.toString().replace(/^\+/, "").replace(/\D/g, "");

      // Basic length check
      if (validatedPhone.length < 10 || validatedPhone.length > 15) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid phone number length. Please provide a valid international phone number.",
        });
      }
    }

    // Initialize services
    const db = admin.firestore();
    const leadService = new LeadService(db);

    // Create lead record
    const leadData = {
      name,
      email,
      phone: validatedPhone || phone,
      program,
      rawData: formData, // Store full payload for reference
      status: "CONTACTED", // User initiated contact via form submission
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const leadId = await leadService.createLead(leadData, LEAD_SOURCES.OTHER);

    // Send WhatsApp validation template if phone is provided
    if (validatedPhone || phone) {
      try {
        // Use the whatsapp_validation template
        const templatePayload = {
          messaging_product: "whatsapp",
          to: validatedPhone || phone,
          type: "template",
          template: {
            name: "whatsapp_validation",
            language: { code: "en_US" },
          },
        };

        // Include metadata to properly track the message in our system
        const messageMetadata = {
          leadId: leadId, // Link to the lead that was just created
          contactName: name,
          source: "GENERIC_WEBHOOK",
          messageType: "whatsapp_validation",
          programInterest: program,
        };

        // Send and save the template message
        await whatsappMessageService.sendTemplateMessage(
          validatedPhone || phone,
          templatePayload,
          messageMetadata
        );

        logger.info(
          `WhatsApp validation message sent and saved for lead ${leadId}`
        );
      } catch (whatsappError) {
        logger.error("Failed to send WhatsApp message:", whatsappError);
      }
    }
    res.status(200).json({
      success: true,
      message: "Generic webhook processed successfully",
      leadId,
    });
  } catch (error) {
    logger.error("Error processing generic webhook:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process generic webhook",
    });
  }
});

/**
 * Process Meta (Facebook) Ads webhook
 * This handles leads from Meta Ads platform
 * Expected fields: first_name, last_name, email, phone, program_interested_in, country_of_origin
 */
router.post("/meta-ads", validateWebhookSource, async (req, res) => {
  try {
    ensureServices();
    const formData = req.body;
    logger.webhook("Meta Ads", formData);

    // Extract data using exact field names from Meta Ads lead forms
    const firstName = formData.first_name || formData.firstname || "";
    const lastName = formData.last_name || formData.lastname || "";
    const email = formData.email || "";
    const phone = formData.phone || formData.whatsapp_number || "";
    const program = formData.program_interested_in || formData.program || "";
    const country = formData.country_of_origin || formData.country || "";

    // Combine first and last name
    const name = `${firstName || ""} ${lastName || ""}`.trim() || "Unknown";

    // Validate required fields
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        error: "Either email or phone is required",
      });
    }

    // MANDATORY WhatsApp validation if phone is provided
    // No lead will be created unless the WhatsApp number is valid
    let validatedPhone = null;
    let whatsappValidationResult = null;

    if (phone && phone.trim()) {
      logger.info(`Starting WhatsApp validation for ${phone}`);

      // Use centralized validation function (Meta Ads is not on Elementor, so isElementorForm = false)
      const validation = await validateWhatsAppNumber(
        phone,
        firstName || name,
        "meta_ads",
        false
      );

      // If validation failed, return the error response immediately - NO LEAD CREATION
      if (!validation.isValid) {
        logger.error(
          `WhatsApp validation failed for ${phone} - ABORTING lead creation`
        );
        return res
          .status(validation.errorResponse.status)
          .json(validation.errorResponse.body);
      }

      // If we get here, the WhatsApp number is valid
      validatedPhone = validation.normalizedPhone;
      whatsappValidationResult = validation.validationResult;

      logger.info(`WhatsApp validation successful for ${validatedPhone}`);
    } else if (!email) {
      // Meta Ads requires either email OR phone
      return res.status(400).json({
        success: false,
        error: "Either email or valid WhatsApp number is required",
      });
    }

    // Initialize services
    const db = admin.firestore();
    const leadService = new LeadService(db);

    // Check for duplicate leads by phone or email
    let existingLead = null;
    let actionTaken = "";

    // First check by phone number
    if (phone && phone.trim()) {
      existingLead = await leadService.findLeadByPhone(phone);
    }

    // If no lead found by phone, check by email
    if (!existingLead && email) {
      existingLead = await leadService.findLeadByEmail(email);
    }

    let leadId;
    let statusNote = "";

    if (existingLead) {
      // Update existing lead with Meta Ads information
      logger.info(
        `Updating existing lead ${existingLead.id} with Meta Ads data`
      );

      // Update the lead with Meta Ads info
      leadId = existingLead;

      // Check if we have a new phone number to add to the lead
      let hasNewPhoneNumber = false;
      if (phone && phone.trim()) {
        // Compare with existing phone numbers (handle both single phone and array of phones)
        const existingPhones = Array.isArray(existingLead.phone)
          ? existingLead.phone
          : existingLead.phone
          ? [existingLead.phone]
          : [];

        if (!existingPhones.includes(phone)) {
          hasNewPhoneNumber = true;

          // Update lead with additional phone number
          try {
            // If the lead already has a phones array, add to it; otherwise create new array
            if (
              existingLead.additionalPhones &&
              Array.isArray(existingLead.additionalPhones)
            ) {
              await leadService.updateLead(existingLead.id, {
                additionalPhones: [...existingLead.additionalPhones, phone],
                lastContactUpdate: admin.firestore.FieldValue.serverTimestamp(),
              });
            } else {
              await leadService.updateLead(existingLead.id, {
                additionalPhones: [phone],
                lastContactUpdate: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
          } catch (updateError) {
            logger.error(
              "Failed to update lead with new phone number:",
              updateError
            );
          }
        }
      }

      // Check if we have a new email to add to the lead
      let hasNewEmail = false;
      if (email && email.trim()) {
        // Compare with existing emails (handle both single email and array of emails)
        const existingEmails = Array.isArray(existingLead.email)
          ? existingLead.email
          : existingLead.email
          ? [existingLead.email]
          : [];

        if (!existingEmails.includes(email)) {
          hasNewEmail = true;

          // Update lead with additional email
          try {
            // If the lead already has an emails array, add to it; otherwise create new array
            if (
              existingLead.additionalEmails &&
              Array.isArray(existingLead.additionalEmails)
            ) {
              await leadService.updateLead(existingLead.id, {
                additionalEmails: [...existingLead.additionalEmails, email],
                lastContactUpdate: admin.firestore.FieldValue.serverTimestamp(),
              });
            } else {
              await leadService.updateLead(existingLead.id, {
                additionalEmails: [email],
                lastContactUpdate: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
          } catch (updateError) {
            logger.error("Failed to update lead with new email:", updateError);
          }
        }
      }

      // Add interaction entry for Meta Ads source
      await leadService.addInteraction(existingLead.id, {
        type: "META_ADS_INQUIRY",
        content: `New inquiry from Meta Ads - ${
          program ? `interested in ${program}` : "program inquiry"
        }`,
        channel: "META_ADS",
        automated: true,
        direction: "incoming",
        metadata: {
          program,
          country,
          source: "Meta Ads",
          newPhoneAdded: hasNewPhoneNumber,
          newEmailAdded: hasNewEmail,
          campaignData: {
            formData: formData,
          },
        },
      });

      actionTaken = "updated_existing_lead";
      statusNote = `Updated existing lead (${
        existingLead.email || existingLead.phone
      }) with Meta Ads inquiry`;

      // If there's a new phone number, also mark this in the status note
      if (hasNewPhoneNumber) {
        statusNote += ` (New phone number added: ${phone})`;
      }
      if (hasNewEmail) {
        statusNote += ` (New email added: ${email})`;
      }
    } else {
      // Create new lead record with Meta Ads source
      logger.info(`Creating new lead for Meta Ads inquiry`);

      const leadData = {
        firstName,
        lastName,
        name,
        email,
        phone: normalizedPhone || phone,
        program,
        country,
        status: "INTERESTED", // User initiated contact via Meta Ads form
        source: LEAD_SOURCES.META_ADS,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        // Store original Meta Ads data for reference
        metaAdsData: formData,
      };

      // Add validation message ID if available
      if (
        validatedPhone &&
        validationResults &&
        validationResults.validationMessageId
      ) {
        leadData.whatsappValidationMessageId =
          validationResults.validationMessageId;
      }

      leadId = await leadService.createLead(leadData, LEAD_SOURCES.META_ADS);
      actionTaken = "created_new_lead";

      // The lead creation endpoint will now handle creating the conversation
      statusNote =
        "New lead created from Meta Ads contact form (user initiated contact)";
    }

    // Update lead with WhatsApp validation results
    if (phone && phone.trim() && validatedPhone) {
      // Update lead with WhatsApp validation status
      const whatsappStatus = "VALIDATED";

      await leadService.updateLead(leadId.id || leadId, {
        lastWhatsAppContact: admin.firestore.FieldValue.serverTimestamp(),
        lastWhatsAppStatus: whatsappStatus,
        whatsappValid: true, // Number is confirmed valid
      });

      statusNote += " (WhatsApp number verified and validation message sent)";
      // Note: No additional welcome message needed - validation message serves as initial contact
    } else if (!phone) {
      statusNote += " (No phone number provided - email-only lead)";
    }

    // Return success response
    return res.status(200).json({
      success: true,
      message: "Meta Ads lead successfully processed",
      actionTaken,
      leadId: leadId?.id || leadId,
      statusNote,
      leadInfo: {
        name,
        email,
        program,
        source: "Meta Ads",
        isExisting: !!existingLead,
      },
    });
  } catch (error) {
    logger.error("Error processing Meta Ads webhook:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process Meta Ads webhook",
    });
  }
});

// Keep the detailed echo endpoint defined earlier in the file.
// Remove the simpler duplicate /echo endpoint to prevent duplicate handlers.

// Export both the router and the pendingValidations for use by WhatsApp webhook
module.exports = {
  router,
  pendingValidations,
};
