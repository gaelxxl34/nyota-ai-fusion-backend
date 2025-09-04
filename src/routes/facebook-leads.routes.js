/**
 * Facebook Lead Ads Webhook Routes
 * Handles Facebook Lead Ads webhook events for receiving leads
 */

const express = require("express");
const crypto = require("crypto");
const { leadService } = require("../services/leadService");
const { welcomeService } = require("../services/welcomeService");
const {
  whatsappMessageService,
} = require("../services/whatsappMessageService");
const logger = require("../utils/logger");

const router = express.Router();

/**
 * Middleware to capture raw body for signature verification
 * This bypasses the global JSON parser and handles the raw body directly
 */
const captureRawBodyForSignature = (req, res, next) => {
  if (req.method === "POST" && req.path === "/webhook") {
    let rawBody = "";

    // Set encoding to capture as string
    req.setEncoding("utf8");

    req.on("data", (chunk) => {
      rawBody += chunk;
    });

    req.on("end", () => {
      try {
        // Store raw body for signature verification
        req.rawBody = rawBody;

        // Parse JSON manually
        req.body = JSON.parse(rawBody);

        console.log("🔧 Raw body captured and parsed successfully");
        console.log("- Raw body length:", req.rawBody.length);
        console.log("- Parsed body keys:", Object.keys(req.body));

        next();
      } catch (error) {
        console.error("❌ Failed to parse JSON body:", error);
        return res.status(400).json({ error: "Invalid JSON" });
      }
    });

    req.on("error", (error) => {
      console.error("❌ Error reading request body:", error);
      return res.status(500).json({ error: "Server error" });
    });
  } else {
    next();
  }
};

/**
 * Verify Facebook webhook subscription
 * GET /api/facebook-leads/webhook
 */
router.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const VERIFY_TOKEN =
      process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN ||
      "nyota-fb-leads-webhook-2024";

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Facebook webhook verified successfully");
      logger.info("Facebook Lead Ads webhook verified", {
        token: token.substring(0, 10) + "...",
      });
      res.status(200).send(challenge);
    } else {
      console.log("❌ Facebook webhook verification failed");
      logger.error("Facebook webhook verification failed", {
        mode,
        token: token?.substring(0, 10) + "...",
      });
      res.sendStatus(403);
    }
  } catch (error) {
    console.error("❌ Error verifying Facebook webhook:", error);
    logger.error("Facebook webhook verification error", error);
    res.sendStatus(500);
  }
});

/**
 * Handle Facebook Lead Ads webhook events
 * POST /api/facebook-leads/webhook
 */
/**
 * Handle Facebook Lead Ads webhook events
 * POST /api/facebook-leads/webhook
 */
router.post("/webhook", captureRawBodyForSignature, async (req, res) => {
  try {
    const body = req.body;
    const rawBody = req.rawBody;

    // Try different header case variations for signature
    const signature =
      req.get("X-Hub-Signature-256") ||
      req.get("x-hub-signature-256") ||
      req.headers["x-hub-signature-256"] ||
      req.headers["X-Hub-Signature-256"];

    console.log("📨 Incoming Facebook webhook request:");
    console.log("- All Headers:", JSON.stringify(req.headers, null, 2));
    console.log("- Body:", JSON.stringify(body, null, 2));
    console.log("- Raw Body Length:", rawBody ? rawBody.length : 0);
    console.log("- Signature found:", signature);
    console.log("- Signature search results:");
    console.log("  - X-Hub-Signature-256:", req.get("X-Hub-Signature-256"));
    console.log("  - x-hub-signature-256:", req.get("x-hub-signature-256"));
    console.log(
      "  - Direct header access:",
      req.headers["x-hub-signature-256"]
    );

    // Check environment configuration
    const hasAppSecret = !!process.env.FACEBOOK_APP_SECRET;
    const isPlaceholder =
      process.env.FACEBOOK_APP_SECRET === "your_facebook_app_secret_here";
    const appSecretPreview = process.env.FACEBOOK_APP_SECRET
      ? process.env.FACEBOOK_APP_SECRET.substring(0, 8) + "..."
      : "not set";

    console.log("🔐 Environment check:");
    console.log("- App Secret configured:", hasAppSecret);
    console.log("- Is placeholder:", isPlaceholder);
    console.log("- App Secret preview:", appSecretPreview);

    // Verify webhook signature using raw body
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.log("❌ Invalid Facebook webhook signature");
      console.log("- Expected signature format: sha256=<hash>");
      console.log("- Received signature:", signature);
      console.log(
        "- App Secret status:",
        hasAppSecret
          ? isPlaceholder
            ? "PLACEHOLDER"
            : "CONFIGURED"
          : "MISSING"
      );

      logger.error("Invalid Facebook webhook signature", {
        signature,
        hasAppSecret,
        isPlaceholder,
        appSecretStatus: hasAppSecret
          ? isPlaceholder
            ? "PLACEHOLDER"
            : "CONFIGURED"
          : "MISSING",
      });
      return res.sendStatus(403);
    }

    console.log("✅ Facebook webhook signature verified successfully");
    console.log(
      "📨 Facebook Lead Ads webhook received:",
      JSON.stringify(body, null, 2)
    );
    logger.info("Facebook Lead Ads webhook received", { body });

    // Process webhook data
    if (body.object === "page") {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          if (change.field === "leadgen") {
            await processLeadgenEvent(change.value);
          }
        }
      }
    }

    res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("❌ Error processing Facebook webhook:", error);
    logger.error("Facebook webhook processing error", error);
    res.sendStatus(500);
  }
});

/**
 * Verify webhook signature from Facebook
 */
function verifyWebhookSignature(payload, signature) {
  console.log("🔍 Verifying webhook signature...");
  console.log("- Raw Payload length:", payload ? payload.length : 0);
  console.log("- Raw Payload type:", typeof payload);
  console.log("- Signature received:", signature);

  if (!signature) {
    console.log("❌ No signature provided");
    return false;
  }

  if (!payload) {
    console.log("❌ No payload provided");
    return false;
  }

  const APP_SECRET = process.env.FACEBOOK_APP_SECRET;
  if (!APP_SECRET) {
    console.warn("⚠️ FACEBOOK_APP_SECRET not configured");
    return false;
  }

  if (APP_SECRET === "your_facebook_app_secret_here") {
    console.warn("⚠️ FACEBOOK_APP_SECRET is still placeholder value");
    return false;
  }

  try {
    // Use the raw payload string directly for HMAC calculation
    const expectedSignature =
      "sha256=" +
      crypto
        .createHmac("sha256", APP_SECRET)
        .update(payload, "utf8")
        .digest("hex");

    console.log(
      "- Expected signature format:",
      expectedSignature.substring(0, 15) + "..."
    );
    console.log(
      "- Received signature format:",
      signature.substring(0, 15) + "..."
    );
    console.log("- Expected signature length:", expectedSignature.length);
    console.log("- Received signature length:", signature.length);

    // Ensure both signatures are the same length before comparing
    if (signature.length !== expectedSignature.length) {
      console.log(
        "❌ Signature length mismatch - Expected:",
        expectedSignature.length,
        "Got:",
        signature.length
      );
      console.log("- Full expected:", expectedSignature);
      console.log("- Full received:", signature);
      return false;
    }

    // Use crypto.timingSafeEqual for secure comparison
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    const receivedBuffer = Buffer.from(signature, "utf8");

    const isValid = crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

    console.log(
      "- Signature validation result:",
      isValid ? "✅ VALID" : "❌ INVALID"
    );
    if (!isValid) {
      console.log("- Expected:", expectedSignature);
      console.log("- Received:", signature);
      // For debugging, show first few chars of payload
      console.log("- Payload preview:", payload.substring(0, 100) + "...");
    }
    return isValid;
  } catch (error) {
    console.error("❌ Error during signature verification:", error);
    return false;
  }
}

/**
 * Process Facebook leadgen event
 */
async function processLeadgenEvent(leadgenData) {
  try {
    console.log("🔄 Processing leadgen event:", leadgenData);

    const { leadgen_id, page_id, form_id, adgroup_id, ad_id, created_time } =
      leadgenData;

    // Fetch lead details using Facebook Graph API
    const leadDetails = await fetchLeadDetailsFromFacebook(leadgen_id);

    if (!leadDetails) {
      console.error("❌ Could not fetch lead details from Facebook");
      return;
    }

    console.log("📋 Lead details from Facebook:", leadDetails);

    // Create lead in our system
    await createLeadFromFacebookData(leadDetails, {
      page_id,
      form_id,
      adgroup_id,
      ad_id,
      created_time,
      leadgen_id,
    });
  } catch (error) {
    console.error("❌ Error processing leadgen event:", error);
    logger.error("Leadgen event processing error", error);
  }
}

/**
 * Fetch lead details from Facebook Graph API
 */
async function fetchLeadDetailsFromFacebook(leadgenId) {
  try {
    const ACCESS_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;

    if (!ACCESS_TOKEN) {
      throw new Error("FACEBOOK_ACCESS_TOKEN not configured");
    }

    const url = `https://graph.facebook.com/v18.0/${leadgenId}?access_token=${ACCESS_TOKEN}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Facebook API error: ${response.status} - ${errorText}`);
    }

    const leadData = await response.json();

    console.log(
      "📥 Raw Facebook lead data:",
      JSON.stringify(leadData, null, 2)
    );

    return leadData;
  } catch (error) {
    console.error("❌ Error fetching lead from Facebook:", error);
    throw error;
  }
}

/**
 * Create lead in our system from Facebook data
 */
async function createLeadFromFacebookData(facebookLead, metadata) {
  try {
    console.log("🏗️ Creating lead from Facebook data:", facebookLead);

    // Extract contact information from Facebook lead data
    const contactInfo = extractContactInfoFromFacebookLead(facebookLead);

    if (!contactInfo.email && !contactInfo.phone) {
      throw new Error("Lead must have either email or phone number");
    }

    // Check if lead already exists
    const existingLead = await findExistingLead(contactInfo);

    if (existingLead) {
      console.log(
        `📝 Lead already exists: ${existingLead.id} - updating with Facebook data`
      );
      await updateExistingLeadWithFacebookData(
        existingLead,
        facebookLead,
        metadata
      );
      return existingLead;
    }

    // Create new lead
    const leadData = {
      name: contactInfo.name,
      email: contactInfo.email,
      phone: contactInfo.phone,
      source: "FACEBOOK_LEADS",
      status: "INTERESTED",
      programOfInterest: contactInfo.programOfInterest || null,
      facebookLeadData: {
        leadgen_id: metadata.leadgen_id,
        page_id: metadata.page_id,
        form_id: metadata.form_id,
        adgroup_id: metadata.adgroup_id,
        ad_id: metadata.ad_id,
        created_time: metadata.created_time,
        rawData: facebookLead,
      },
      notes: `Lead generated from Facebook Lead Ad - Form ID: ${metadata.form_id}`,
      timeline: [
        {
          date: new Date(),
          action: "CREATED",
          status: "INTERESTED",
          notes: `Lead created from Facebook Lead Ad (Form: ${metadata.form_id})`,
        },
      ],
    };

    // Add any additional fields from Facebook form
    if (facebookLead.field_data) {
      leadData.additionalFields = {};
      facebookLead.field_data.forEach((field) => {
        const fieldName = field.name.toLowerCase().replace(/\s+/g, "_");
        leadData.additionalFields[fieldName] = field.values?.[0] || "";
      });
    }

    console.log("📝 Creating lead with data:", leadData);

    const newLead = await leadService.createLead(
      {
        name: contactInfo.name,
        email: contactInfo.email,
        phone: contactInfo.phone,
      },
      "FACEBOOK_LEADS",
      {
        status: "INTERESTED",
        programOfInterest: contactInfo.programOfInterest,
        facebookLeadData: leadData.facebookLeadData,
        additionalFields: leadData.additionalFields,
        notes: leadData.notes,
        initialTimeline: leadData.timeline,
      }
    );

    console.log(`✅ Lead created successfully: ${newLead.id}`);

    // Send welcome messages
    await sendWelcomeMessages(newLead);

    return newLead;
  } catch (error) {
    console.error("❌ Error creating lead from Facebook data:", error);
    logger.error("Error creating lead from Facebook data", error);
    throw error;
  }
}

/**
 * Extract contact information from Facebook lead data
 */
function extractContactInfoFromFacebookLead(facebookLead) {
  const contactInfo = {
    name: null,
    email: null,
    phone: null,
    programOfInterest: null,
  };

  if (!facebookLead.field_data || !Array.isArray(facebookLead.field_data)) {
    console.warn("⚠️ No field_data found in Facebook lead");
    return contactInfo;
  }

  // Map Facebook form fields to our contact info
  facebookLead.field_data.forEach((field) => {
    const fieldName = field.name.toLowerCase();
    const fieldValue = field.values?.[0] || "";

    // Map common field names
    if (fieldName.includes("email") || fieldName === "email") {
      contactInfo.email = fieldValue;
    } else if (
      fieldName.includes("phone") ||
      fieldName.includes("mobile") ||
      fieldName === "phone_number"
    ) {
      contactInfo.phone = formatPhoneNumber(fieldValue);
    } else if (
      fieldName.includes("name") ||
      fieldName === "full_name" ||
      fieldName === "first_name"
    ) {
      // For first_name, we'll use it as name if no full name is found
      if (
        !contactInfo.name ||
        fieldName.includes("full") ||
        fieldName === "name"
      ) {
        contactInfo.name = fieldValue;
      }
    } else if (
      fieldName === "last_name" &&
      contactInfo.name &&
      !contactInfo.name.includes(" ")
    ) {
      // Append last name to first name
      contactInfo.name = `${contactInfo.name} ${fieldValue}`;
    } else if (
      fieldName.includes("program") ||
      fieldName.includes("course") ||
      fieldName.includes("interest")
    ) {
      contactInfo.programOfInterest = fieldValue;
    }
  });

  // Clean up name
  if (contactInfo.name) {
    contactInfo.name = contactInfo.name.trim();
  }

  console.log("📊 Extracted contact info:", contactInfo);
  return contactInfo;
}

/**
 * Format phone number to international format
 */
function formatPhoneNumber(phone) {
  if (!phone) return null;

  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, "");

  // If it starts with 0, replace with 256 (Uganda country code)
  if (cleaned.startsWith("0")) {
    cleaned = "256" + cleaned.substring(1);
  }

  // If it doesn't start with a country code, assume Uganda
  if (cleaned.length === 9) {
    cleaned = "256" + cleaned;
  }

  return cleaned;
}

/**
 * Find existing lead by email or phone
 */
async function findExistingLead(contactInfo) {
  try {
    // First try to find by email
    if (contactInfo.email) {
      const leadByEmail = await leadService.findLeadByEmail(contactInfo.email);
      if (leadByEmail) {
        return leadByEmail;
      }
    }

    // Then try to find by phone
    if (contactInfo.phone) {
      const leadByPhone = await leadService.findLeadByPhone(contactInfo.phone);
      if (leadByPhone) {
        return leadByPhone;
      }
    }

    return null;
  } catch (error) {
    console.error("❌ Error finding existing lead:", error);
    return null;
  }
}

/**
 * Update existing lead with Facebook data
 */
async function updateExistingLeadWithFacebookData(
  existingLead,
  facebookLead,
  metadata
) {
  try {
    const updateData = {
      source: "FACEBOOK_LEADS", // Update source
      facebookLeadData: {
        leadgen_id: metadata.leadgen_id,
        page_id: metadata.page_id,
        form_id: metadata.form_id,
        adgroup_id: metadata.adgroup_id,
        ad_id: metadata.ad_id,
        created_time: metadata.created_time,
        rawData: facebookLead,
      },
    };

    // Add timeline entry
    const timelineEntry = {
      date: new Date(),
      action: "UPDATED",
      status: existingLead.status,
      notes: `Updated with Facebook Lead Ad data (Form: ${metadata.form_id})`,
    };

    await leadService.updateLead(existingLead.id, updateData);

    // Add timeline entry separately
    await leadService.addInteraction(existingLead.id, {
      type: "SYSTEM_UPDATE",
      content: timelineEntry.notes,
      channel: "FACEBOOK_LEADS",
      automated: true,
      direction: "system",
      metadata: {
        facebook_form_id: metadata.form_id,
        facebook_leadgen_id: metadata.leadgen_id,
      },
    });

    console.log(
      `✅ Updated existing lead ${existingLead.id} with Facebook data`
    );

    // Send welcome messages if lead is still INTERESTED
    if (existingLead.status === "INTERESTED") {
      await sendWelcomeMessages(existingLead);
    }
  } catch (error) {
    console.error("❌ Error updating existing lead:", error);
    throw error;
  }
}

/**
 * Send welcome email and WhatsApp messages to new Facebook lead
 */
async function sendWelcomeMessages(lead) {
  try {
    console.log(
      `📤 Sending welcome messages to lead: ${lead.name} (${lead.id})`
    );

    const results = {
      email: null,
      whatsapp: null,
    };

    // Send welcome email if email is available
    if (lead.email) {
      try {
        console.log(`📧 Sending welcome email to ${lead.email}`);

        const emailResult = await welcomeService.sendWelcomeEmail({
          userEmail: lead.email,
          userName: lead.name || "Prospective Student",
          isFirstLogin: true,
        });

        results.email = emailResult;

        if (emailResult.success) {
          console.log(`✅ Welcome email sent to ${lead.email}`);

          // Add interaction record
          await leadService.addInteraction(lead.id, {
            type: "EMAIL",
            content: "Welcome email sent - Application Portal access",
            channel: "EMAIL",
            automated: true,
            direction: "outgoing",
            metadata: {
              messageId: emailResult.messageId,
              provider: emailResult.provider,
              subject: "Welcome to IUEA Application Portal!",
              campaignType: "facebook_lead_welcome",
            },
          });
        } else {
          console.error(
            `❌ Failed to send welcome email to ${lead.email}:`,
            emailResult.error
          );
        }
      } catch (emailError) {
        console.error(`❌ Welcome email error for ${lead.email}:`, emailError);
        results.email = { success: false, error: emailError.message };
      }
    }

    // Send WhatsApp welcome message if phone is available
    if (lead.phone) {
      try {
        console.log(`📱 Sending WhatsApp welcome message to ${lead.phone}`);

        // Clean phone number for WhatsApp
        const cleanPhone = lead.phone.replace(/[^\d]/g, "");

        // Use the same template as for first-time student portal users
        const templatePayload = {
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "template",
          template: {
            name: "whatsapp_validation",
            language: {
              code: "en_US",
            },
          },
        };

        const whatsappResult = await whatsappMessageService.sendTemplateMessage(
          cleanPhone,
          templatePayload,
          {
            contactName: lead.name,
            validationType: "welcome",
            automated: true,
            leadId: lead.id,
            source: "facebook_leads",
          }
        );

        results.whatsapp = whatsappResult;

        if (whatsappResult.success) {
          console.log(`✅ WhatsApp welcome message sent to ${lead.phone}`);

          // Add interaction record
          await leadService.addInteraction(lead.id, {
            type: "WHATSAPP",
            content: "WhatsApp welcome message sent",
            channel: "WHATSAPP",
            automated: true,
            direction: "outgoing",
            metadata: {
              messageId: whatsappResult.messageId,
              templateName: "whatsapp_validation",
              campaignType: "facebook_lead_welcome",
            },
          });
        } else {
          console.error(
            `❌ Failed to send WhatsApp to ${lead.phone}:`,
            whatsappResult.error
          );
        }
      } catch (whatsappError) {
        console.error(`❌ WhatsApp error for ${lead.phone}:`, whatsappError);
        results.whatsapp = { success: false, error: whatsappError.message };
      }
    }

    // Wait 3 seconds then send follow-up WhatsApp message with application link
    if (lead.phone && results.whatsapp?.success) {
      setTimeout(async () => {
        try {
          const followUpMessage = `🎓 Ready to take the next step?

Complete your application at our secure portal:
👉 https://applicant.iuea.ac.ug/

📞 Need help? Our admissions team is here to assist you!
📧 Email: apply@iuea.ac.ug
📱 WhatsApp: +256 790 002 000

We're excited to have you join the IUEA family! 🌟`;

          const cleanPhone = lead.phone.replace(/[^\d]/g, "");

          // Send as regular message, not template
          const followUpResult = await whatsappMessageService.sendMessage(
            cleanPhone,
            followUpMessage,
            "text",
            {
              leadId: lead.id,
              messageType: "follow_up",
              source: "facebook_leads",
            }
          );

          if (followUpResult.success) {
            console.log(`✅ Follow-up message sent to ${lead.phone}`);

            await leadService.addInteraction(lead.id, {
              type: "WHATSAPP",
              content: followUpMessage,
              channel: "WHATSAPP",
              automated: true,
              direction: "outgoing",
              metadata: {
                messageType: "follow_up",
                campaignType: "facebook_lead_welcome",
              },
            });
          }
        } catch (followUpError) {
          console.error(`❌ Follow-up message error:`, followUpError);
        }
      }, 3000);
    }

    console.log(`📊 Welcome messages results for ${lead.name}:`, results);
    return results;
  } catch (error) {
    console.error("❌ Error sending welcome messages:", error);
    throw error;
  }
}

module.exports = router;
