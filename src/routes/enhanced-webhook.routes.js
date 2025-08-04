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
// Initialize services properly to avoid circular dependencies
const db = getFirestore();
const leadService = new LeadService(db);
const conversationService = new ConversationService(db);
const whatsappMessageService = new WhatsAppMessageService(
  db,
  leadService,
  conversationService
);
const ApplicationService = require("../services/applicationService");
const logger = require("../utils/logger");

// Configuration options
const WHATSAPP_VALIDATION_ENABLED =
  process.env.WHATSAPP_VALIDATION_ENABLED !== "false";

// Protection middleware
const validateWebhookSource = (req, res, next) => {
  // If webhook protection is disabled, skip validation
  if (process.env.WEBHOOK_PROTECTION_ENABLED !== "true") {
    return next();
  }

  // Implement source validation logic here (API keys, secrets, etc.)
  // For WordPress, you might verify a shared secret
  // For Google Ads, you might verify Google's signature
  // For Meta, you might verify their signature

  next();
};

// Store pending validations - this will hold promises that resolve when webhook responds
const pendingValidations = new Map();

/**
 * Validates WhatsApp number by sending a test message and waiting for webhook response
 * @param {string} phone - The phone number to validate
 * @param {string} name - The name of the person (for personalized message)
 * @param {string} source - The source of the webhook (wordpress, google_ads, meta_ads)
 * @param {boolean} isElementorForm - Whether this is from an Elementor form
 * @returns {Object} Validation result with success status and appropriate error response
 */
const validateWhatsAppNumber = async (
  phone,
  name,
  source,
  isElementorForm = false
) => {
  // Normalize the phone number - remove + and non-digits
  const normalizedPhone = phone
    .toString()
    .replace(/^\+/, "")
    .replace(/\D/g, "");

  // Basic length validation
  if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
    const errorMessage =
      "Invalid phone number format. Please enter a valid international WhatsApp number (10-15 digits).";

    if (isElementorForm) {
      return {
        isValid: false,
        errorResponse: {
          status: 200,
          body: {
            success: false,
            message: errorMessage,
            data: {
              message: errorMessage,
              errors: {
                phone: errorMessage,
              },
            },
          },
        },
      };
    }

    return {
      isValid: false,
      errorResponse: {
        status: 400,
        body: {
          success: false,
          error: errorMessage,
        },
      },
    };
  }

  // Check for obviously invalid patterns
  if (
    normalizedPhone.startsWith("000") ||
    normalizedPhone.startsWith("111") ||
    normalizedPhone.match(/^(\d)\1{9,}$/) || // All same digit
    normalizedPhone.includes("12345") ||
    normalizedPhone.includes("54321") ||
    normalizedPhone.includes("00000")
  ) {
    const errorMessage =
      "This appears to be an invalid phone number. Please provide your actual WhatsApp number.";

    if (isElementorForm) {
      return {
        isValid: false,
        errorResponse: {
          status: 200,
          body: {
            success: false,
            message: errorMessage,
            data: {
              message: errorMessage,
              errors: {
                phone: errorMessage,
              },
            },
          },
        },
      };
    }

    return {
      isValid: false,
      errorResponse: {
        status: 400,
        body: {
          success: false,
          error: errorMessage,
        },
      },
    };
  }

  logger.debug(
    `Testing WhatsApp number: ${normalizedPhone} (source: ${source})`
  );

  // Use the whatsapp_validation template for validation (no parameters needed - static template)
  const templatePayload = {
    messaging_product: "whatsapp",
    to: normalizedPhone,
    type: "template",
    template: {
      name: "whatsapp_validation",
      language: { code: "en_US" },
    },
  };

  try {
    // First, try sending the whatsapp_validation template for validation
    // Include metadata for validation but avoid creating conversation immediately
    const messageMetadata = {
      contactName: name,
      source: source,
      messageType: "whatsapp_validation",
      validationType: "initial_validation",
    };

    // Send validation message using the new specialized method
    const validationResult = await whatsappMessageService.sendValidationMessage(
      normalizedPhone,
      "Validation message",
      messageMetadata
    );

    logger.debug(
      `WhatsApp whatsapp_validation template sent for ${normalizedPhone}:`,
      validationResult
    );

    if (!validationResult.success) {
      // If template fails, log the specific error and try a different approach
      logger.error(
        `WhatsApp template validation failed for ${normalizedPhone}: ${validationResult.error}`
      );

      // Check if it's a template-specific error or permissions issue
      if (
        validationResult.error.includes("does not exist") ||
        validationResult.error.includes("missing permissions") ||
        validationResult.error.includes("template")
      ) {
        // Template or permissions issue - fail the validation
        const errorMessage =
          "WhatsApp Business API configuration issue. Please contact support.";

        logger.error(
          `WhatsApp API configuration error for ${normalizedPhone}: ${validationResult.error}`
        );

        if (isElementorForm) {
          return {
            isValid: false,
            errorResponse: {
              status: 200,
              body: {
                success: false,
                message: errorMessage,
                data: {
                  message: errorMessage,
                  errors: {
                    phone: errorMessage,
                  },
                },
              },
            },
          };
        }

        return {
          isValid: false,
          errorResponse: {
            status: 500,
            body: {
              success: false,
              error: errorMessage,
            },
          },
        };
      } else {
        // Likely an invalid number error
        const errorMessage =
          "Please provide a valid WhatsApp number. The number you entered is not registered on WhatsApp.";

        logger.error(
          `WhatsApp validation failed immediately for ${normalizedPhone}: ${validationResult.error}`
        );

        if (isElementorForm) {
          return {
            isValid: false,
            errorResponse: {
              status: 200,
              body: {
                success: false,
                message: errorMessage,
                data: {
                  message: errorMessage,
                  errors: {
                    phone: errorMessage,
                  },
                },
              },
            },
          };
        }

        return {
          isValid: false,
          errorResponse: {
            status: 400,
            body: {
              success: false,
              error: errorMessage,
            },
          },
        };
      }
    }

    // Message was queued successfully, now wait for webhook response
    const messageId =
      validationResult.messageId || validationResult.whatsappMessageId;
    logger.debug(
      `Waiting for webhook response for message ${messageId} to ${normalizedPhone}`
    );

    const validationPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingValidations.delete(messageId);
        reject(new Error("Validation timeout - webhook response not received"));
      }, 15000);

      pendingValidations.set(messageId, {
        resolve,
        reject,
        timeoutId,
        phone: normalizedPhone,
      });
    });

    const webhookResult = await validationPromise;

    if (webhookResult.success) {
      logger.debug(`WhatsApp validation successful for ${normalizedPhone}`);
      return {
        isValid: true,
        normalizedPhone,
        validationResult: webhookResult,
        validationMessageId:
          webhookResult.messageId || validationResult.messageId,
        // No longer providing conversationId since we don't create it immediately
      };
    } else {
      // Check the error type from webhook
      const isInvalidNumber =
        webhookResult.error &&
        (webhookResult.error.includes("131026") ||
          webhookResult.error.includes("131051") ||
          webhookResult.error.includes("not registered on WhatsApp") ||
          webhookResult.error.includes("Message undeliverable") ||
          webhookResult.error.includes("invalid number"));

      // Special case for "healthy ecosystem engagement" error (131049)
      // This is a Meta/WhatsApp restriction, not necessarily an invalid number
      const isEcosystemEngagementError =
        webhookResult.error &&
        (webhookResult.error.includes("131049") ||
          webhookResult.error.includes("healthy ecosystem engagement"));

      const is24HourError =
        webhookResult.error &&
        (webhookResult.error.includes("24 hour") ||
          webhookResult.error.includes("outside the allowed window") ||
          webhookResult.error.includes("template message") ||
          webhookResult.error.includes("131047"));

      if (isInvalidNumber) {
        const errorMessage =
          "Please provide a valid WhatsApp number. The number you entered is not registered on WhatsApp.";

        logger.error(
          `WhatsApp validation failed for ${normalizedPhone}: Invalid number (${webhookResult.error})`
        );

        if (isElementorForm) {
          return {
            isValid: false,
            errorResponse: {
              status: 400,
              body: {
                success: false,
                message: errorMessage,
                data: {
                  message: errorMessage,
                  errors: {
                    phone: errorMessage,
                    "Phone Number": errorMessage,
                  },
                  invalid_fields: {
                    phone: errorMessage,
                    "Phone Number": errorMessage,
                  },
                },
                error: true,
                error_message: errorMessage,
              },
            },
          };
        }

        return {
          isValid: false,
          errorResponse: {
            status: 400,
            body: {
              success: false,
              error: errorMessage,
            },
          },
        };
      } else if (isEcosystemEngagementError) {
        // Special handling for ecosystem engagement error (code 131049)
        // This is a WhatsApp/Meta restriction, not necessarily an invalid number
        // We'll treat the validation as valid but flag the lead for alternative contact methods
        const errorMessage =
          "Your number appears valid but WhatsApp message could not be delivered. We'll contact you through other means.";

        logger.warn(
          `WhatsApp ecosystem engagement restriction for ${normalizedPhone}: ${webhookResult.error}`
        );

        // We'll mark this as valid but add a flag to indicate special handling needed
        return {
          isValid: true, // Mark as valid so lead creation proceeds
          normalizedPhone,
          validationResult: {
            success: false, // WhatsApp message failed
            error: webhookResult.error,
            errorCode: 131049,
          },
          validationMessageId: webhookResult.messageId,
          whatsappRestricted: true, // Flag to indicate WhatsApp messaging restricted
          restrictionReason: "ecosystem_engagement",
        };
      } else if (is24HourError) {
        const errorMessage =
          "Phone number validation failed. This WhatsApp number cannot receive messages due to 24-hour policy restrictions.";

        logger.error(
          `WhatsApp validation failed for ${normalizedPhone}: 24-hour policy restriction (${webhookResult.error})`
        );

        if (isElementorForm) {
          return {
            isValid: false,
            errorResponse: {
              status: 400,
              body: {
                success: false,
                message: errorMessage,
                data: {
                  message: errorMessage,
                  errors: {
                    phone: errorMessage,
                  },
                },
              },
            },
          };
        }

        return {
          isValid: false,
          errorResponse: {
            status: 400,
            body: {
              success: false,
              error: errorMessage,
            },
          },
        };
      } else {
        const errorMessage =
          "Unable to verify WhatsApp number. Please ensure the number is correct and registered on WhatsApp.";

        logger.error(
          `WhatsApp validation failed for ${normalizedPhone}: ${webhookResult.error}`
        );

        if (isElementorForm) {
          return {
            isValid: false,
            errorResponse: {
              status: 200,
              body: {
                success: false,
                message: errorMessage,
                data: {
                  message: errorMessage,
                  errors: {
                    phone: errorMessage,
                  },
                },
              },
            },
          };
        }

        return {
          isValid: false,
          errorResponse: {
            status: 400,
            body: {
              success: false,
              error: errorMessage,
            },
          },
        };
      }
    }
  } catch (validationError) {
    logger.error(
      `WhatsApp validation error for ${normalizedPhone}:`,
      validationError
    );

    const errorMessage =
      "Unable to verify WhatsApp number. Please ensure the number is correct and registered on WhatsApp.";

    if (isElementorForm) {
      return {
        isValid: false,
        errorResponse: {
          status: 200,
          body: {
            success: false,
            message: errorMessage,
            data: {
              message: errorMessage,
              errors: {
                phone: errorMessage,
              },
            },
          },
        },
      };
    }

    return {
      isValid: false,
      errorResponse: {
        status: 400,
        body: {
          success: false,
          error: errorMessage,
        },
      },
    };
  }
};

/**
 * Test endpoint to understand Elementor's expectations
 * This endpoint will help debug the exact format Elementor needs
 */
router.post("/wordpress-test", async (req, res) => {
  logger.info("WordPress TEST endpoint hit with data:", req.body);
  logger.info("Request headers:", req.headers);

  // Test different response formats
  const testCase = req.body.test_case || "error";

  if (testCase === "error") {
    // Test error response
    logger.info("Sending TEST error response");
    return res.status(400).json({
      success: false,
      message: "TEST: This is a test error message",
      data: {
        message: "TEST: This is a test error message",
        errors: {
          phone: "TEST: Invalid phone number",
          "Phone Number": "TEST: Invalid phone number",
        },
      },
    });
  } else {
    // Test success response
    logger.info("Sending TEST success response");
    return res.status(200).json({
      success: true,
      message: "TEST: Form submitted successfully",
    });
  }
});
/**
 * Process WordPress website inquiries
 * This handles form submissions from the WordPress website
 * Expected fields: firstname, lastname, email, phone, message
 */
router.post("/wordpress", validateWebhookSource, async (req, res) => {
  try {
    const formData = req.body;
    logger.webhook("WordPress", formData);

    // Extract data using exact field names provided by developer
    // Handle both lowercase and capitalized field names from Elementor
    const firstName = formData.firstname || formData["First Name"];
    const lastName = formData.lastname || formData["Last Name"];
    const email = formData.email || formData["Email"];
    const phone = formData.phone || formData["Phone Number"];
    // Handle both correct spelling "Message" and misspelling "Messege"
    const message =
      formData.message || formData["Message"] || formData["Messege"];

    // Combine first and last name
    const name = `${firstName || ""} ${lastName || ""}`.trim() || "Unknown";

    // Validate required fields
    if (!email) {
      // Try 422 status (Unprocessable Entity) which is standard for validation errors
      return res.status(422).json({
        success: false,
        message: "Email is required. Please provide a valid email address.",
        data: {
          message: "Email is required. Please provide a valid email address.",
          errors: {
            email: "Email is required. Please provide a valid email address.",
            Email: "Email is required. Please provide a valid email address.", // Include exact field name
          },
        },
      });
    }

    // MANDATORY WhatsApp validation if phone is provided
    // No lead will be created unless the WhatsApp number is valid
    let validatedPhone = null;
    let whatsappValidationResult = null;
    if (phone && phone.trim()) {
      logger.debug(`Starting WhatsApp validation for ${phone}`);

      // Use centralized validation function - this will test the actual WhatsApp number
      const validation = await validateWhatsAppNumber(
        phone,
        name,
        "wordpress",
        true
      );

      // If validation failed, return the error response immediately - NO LEAD CREATION
      if (!validation.isValid) {
        logger.error(
          `WhatsApp validation failed for ${phone} - ABORTING lead creation`,
          validation.errorResponse.body
        );
        logger.info(
          `WordPress webhook ERROR response for ${phone}:`,
          validation.errorResponse.body
        );

        // Set explicit headers for Elementor
        res.setHeader("Content-Type", "application/json");
        res.setHeader("X-Validation-Failed", "true");

        // Log the exact response being sent
        logger.info(
          `Sending validation error response with status ${validation.errorResponse.status}:`,
          JSON.stringify(validation.errorResponse.body, null, 2)
        );

        // Add debugging to understand what Elementor receives
        logger.debug(`Response headers:`, res.getHeaders());

        // Send the response
        const response = res
          .status(validation.errorResponse.status)
          .json(validation.errorResponse.body);

        // Log that response was sent
        logger.info(`Response sent to Elementor form for failed validation`);

        return response;
      }

      // If we get here, the WhatsApp number is valid
      // (or has ecosystem engagement restriction but we'll still create the lead)
      validatedPhone = validation.normalizedPhone;
      whatsappValidationResult = validation.validationResult;
      const whatsappRestricted = validation.whatsappRestricted || false;
      const restrictionReason = validation.restrictionReason || null;

      if (whatsappRestricted) {
        logger.warn(
          `WhatsApp restricted for ${validatedPhone}: ${restrictionReason}`
        );
        logger.info(
          `Proceeding with lead creation despite WhatsApp restriction`
        );
      } else {
        logger.info(`WhatsApp validation successful for ${validatedPhone}`);
      }
    } else {
      // If no phone number provided, we can still create the lead (email-only lead)
      logger.debug("No phone number provided - creating email-only lead");
    }

    // If we get here, validation was successful or not required

    // Initialize services
    const db = admin.firestore();
    const leadService = new LeadService(db);

    // Check for duplicate leads by phone or email
    let existingLead = null;
    let actionTaken = "";

    // First check by phone number if available
    if (phone && phone.trim()) {
      logger.debug(`Checking for existing lead with phone: ${phone}`);
      existingLead = await leadService.findLeadByPhone(phone);
    }

    // If no lead found by phone, check by email
    if (!existingLead && email) {
      logger.debug(`Checking for existing lead with email: ${email}`);
      existingLead = await leadService.findLeadByEmail(email);
    }

    let leadId;
    let statusNote = "";

    if (existingLead) {
      // Update existing lead with WordPress inquiry information
      logger.info(
        `Updating existing lead ${existingLead.id} with WordPress inquiry data`
      );

      // Use the existing lead ID
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
      statusNote = `Updated existing lead (${
        existingLead.email || existingLead.phone
      }) with WordPress inquiry`;
    } else {
      // Set initial status to CONTACTED since user initiated contact via form
      const initialStatus = "CONTACTED";

      // Create lead record
      const leadData = {
        firstName,
        lastName,
        name,
        email,
        phone: validatedPhone || phone,
        message,
        status: initialStatus,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
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

      // Create the lead
      leadId = await leadService.createLead(leadData, LEAD_SOURCES.WEBSITE);
      actionTaken = "created_new_lead";

      // The lead creation endpoint will now handle creating the conversation
      statusNote =
        "New lead created from WordPress contact form (user initiated contact)";
    }

    // Update lead with WhatsApp validation results
    if (phone && phone.trim() && validatedPhone) {
      let whatsappStatus = "VALIDATED";
      let whatsappValid = true;

      // Check if this number has WhatsApp ecosystem restrictions
      if (whatsappRestricted) {
        whatsappStatus = "CONTACT_RESTRICTED";
        whatsappValid = false;

        await leadService.updateLead(leadId.id || leadId, {
          lastWhatsAppContact: admin.firestore.FieldValue.serverTimestamp(),
          lastWhatsAppStatus: whatsappStatus,
          whatsappValid: false,
          whatsappRestricted: true,
          whatsappRestrictionReason:
            restrictionReason || "ecosystem_engagement",
          preferredContactMethod: "EMAIL", // Mark for email contact instead
          needsAlternateContact: true,
        });

        statusNote +=
          " (WhatsApp messaging restricted due to ecosystem policy - lead marked for alternate contact)";
      } else {
        // Normal successful validation
        await leadService.updateLead(leadId.id || leadId, {
          lastWhatsAppContact: admin.firestore.FieldValue.serverTimestamp(),
          lastWhatsAppStatus: whatsappStatus,
          whatsappValid: true, // Number is confirmed valid
        });

        statusNote += " (WhatsApp number verified and validation message sent)";
      }
      // Note: No additional welcome message needed - validation message serves as initial contact
    } else if (!phone) {
      statusNote += " (No phone number provided - email-only lead)";
    }

    const successResponse = {
      success: true,
      message: "WordPress webhook processed successfully",
      leadId: leadId?.id || leadId,
      actionTaken,
      statusNote,
    };

    logger.info(
      `WordPress webhook SUCCESS response for ${phone}:`,
      successResponse
    );
    res.status(200).json(successResponse);
  } catch (error) {
    logger.error("Error processing WordPress webhook:", error);

    // Return user-friendly error message in Elementor format
    let userMessage =
      "Failed: We're having trouble processing your submission. Please try again.";

    // Check for specific error types
    if (error.message && error.message.includes("validation")) {
      userMessage =
        "Failed: Phone number validation failed. Please provide a valid WhatsApp number.";
    } else if (error.message && error.message.includes("Firebase")) {
      userMessage =
        "Failed: System temporarily unavailable. Please try again in a moment.";
    }

    // Use 400 status for errors to ensure Elementor recognizes the failure
    res.status(400).json({
      success: false,
      message: userMessage,
      data: {
        message: userMessage,
      },
      // Add alternative error format
      error: true,
      error_message: userMessage,
    });
  }
});

/**
 * Process Google Ads lead form submissions
 * Expected fields: firstname, lastname, email, phone, program_interested
 */
router.post("/google-ads", validateWebhookSource, async (req, res) => {
  try {
    const formData = req.body;
    logger.webhook("Google Ads", formData);

    // Check if body is empty
    if (!formData || Object.keys(formData).length === 0) {
      logger.error("Google Ads webhook: Empty request body received");
      return res.status(400).json({
        success: false,
        error: "No form data received",
      });
    }

    // Extract data using field mapping for both standard and Elementor formats
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
      formData["Enter your email"] || // Added this field name from the logs
      formData["email"];
    const phone =
      formData.phone ||
      formData["Phone Number"] ||
      formData["Phone Number / WhatsApp"] || // Added this field name from the logs
      formData["Phone"] ||
      formData["phone"];
    const programInterested =
      formData.program_interested ||
      formData.program ||
      formData["Preferred Program"] || // Added this field name from the logs
      formData["Program of Interest"] || // Additional field mapping
      formData.course_interested ||
      formData["Course of Interest"] ||
      null; // Default to null instead of undefined

    // Log the program extraction for debugging
    logger.debug(`Google Ads program extraction:`, {
      program_interested: formData.program_interested,
      program: formData.program,
      "Preferred Program": formData["Preferred Program"],
      "Program of Interest": formData["Program of Interest"],
      course_interested: formData.course_interested,
      "Course of Interest": formData["Course of Interest"],
      finalProgramInterested: programInterested,
    });

    // Combine first and last name
    const name = `${firstName || ""} ${lastName || ""}`.trim() || "Unknown";

    // Validate required fields
    if (!email) {
      logger.error("Google Ads webhook: Missing required email field");

      return res.status(200).json({
        success: false,
        message: "Email is required. Please provide a valid email address.",
        data: {
          message: "Email is required. Please provide a valid email address.",
        },
      });
    }

    // Validate required phone number - no email-only leads allowed
    if (!phone || !phone.trim()) {
      logger.error("Google Ads webhook: Missing required phone field");

      return res.status(200).json({
        success: false,
        message:
          "Phone number is required. Please provide a valid WhatsApp number.",
        data: {
          message:
            "Phone number is required. Please provide a valid WhatsApp number.",
          errors: {
            phone:
              "Phone number is required. Please provide a valid WhatsApp number.",
            "Phone Number":
              "Phone number is required. Please provide a valid WhatsApp number.",
            "Phone Number / WhatsApp":
              "Phone number is required. Please provide a valid WhatsApp number.",
          },
        },
      });
    }

    // MANDATORY WhatsApp validation - phone is required
    let validatedPhone = null;
    let whatsappValidationResult = null;
    let whatsappRestricted = false;
    let restrictionReason = null;

    // Use centralized validation function - this will test the actual WhatsApp number
    const validation = await validateWhatsAppNumber(
      phone,
      name,
      "google_ads",
      true
    );

    // If validation failed, return the error response immediately - NO LEAD CREATION
    if (!validation.isValid) {
      logger.error(
        "Google Ads webhook: WhatsApp validation failed - aborting lead creation"
      );
      return res
        .status(validation.errorResponse.status)
        .json(validation.errorResponse.body);
    }

    // If we get here, the WhatsApp number is valid
    validatedPhone = validation.normalizedPhone;
    whatsappValidationResult = validation.validationResult;
    whatsappRestricted = validation.whatsappRestricted || false;
    restrictionReason = validation.restrictionReason || null;

    if (whatsappRestricted) {
      logger.warn("Google Ads webhook: WhatsApp restricted but proceeding");
    } else {
      logger.info("Google Ads webhook: WhatsApp validation successful");
    }

    // Initialize services
    const db = admin.firestore();
    const leadService = new LeadService(db);

    // Check for duplicate leads by phone or email
    let existingLead = null;
    let actionTaken = "";

    // First check by phone number (required)
    existingLead = await leadService.findLeadByPhone(phone);

    // If no lead found by phone, check by email
    if (!existingLead && email) {
      existingLead = await leadService.findLeadByEmail(email);
    }

    let leadId;
    let statusNote = "";

    if (existingLead) {
      leadId = existingLead;

      // Add interaction entry for Google Ads source
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
          campaignData: {
            campaignId:
              formData.google_campaign_id || formData.campaign_id || null,
            adGroupId:
              formData.google_ad_group_id || formData.ad_group_id || null,
            clickId: formData.gclid || null,
          },
        },
      });

      actionTaken = "updated_existing_lead";
      statusNote = `Updated existing lead (${
        existingLead.email || existingLead.phone
      }) with Google Ads inquiry`;
    } else {
      const leadData = {
        firstName,
        lastName,
        name,
        email,
        phone: validatedPhone, // Always use validated phone since it's required
        program: programInterested, // This should now properly map from "Preferred Program"
        googleAdsInfo: {
          campaignId:
            formData.google_campaign_id || formData.campaign_id || null,
          adGroupId:
            formData.google_ad_group_id || formData.ad_group_id || null,
          clickId: formData.gclid || null,
          rawPayload: formData,
        },
        status: "CONTACTED", // User initiated contact via Google Ads form
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Log the lead data being created for debugging
      logger.debug(`Google Ads lead data being created:`, {
        name,
        email,
        phone: validatedPhone,
        program: programInterested,
        originalFormData: {
          "Preferred Program": formData["Preferred Program"],
          program_interested: formData.program_interested,
          program: formData.program,
        },
      });

      // Add validation message ID if available
      if (
        whatsappValidationResult &&
        whatsappValidationResult.validationMessageId
      ) {
        leadData.whatsappValidationMessageId =
          whatsappValidationResult.validationMessageId;
      }

      leadId = await leadService.createLead(leadData, LEAD_SOURCES.GOOGLE_ADS);
      actionTaken = "created_new_lead";

      statusNote =
        "New lead created from Google Ads contact form (user initiated contact)";

      // Create conversation if WhatsApp validation was successful
      if (whatsappValidationResult && whatsappValidationResult.messageId) {
        try {
          await whatsappMessageService.createConversationForValidatedNumber(
            whatsappValidationResult.messageId,
            {
              leadId: leadId.id || leadId,
              contactName: name,
              source: "Google Ads",
            }
          );
          logger.info("Conversation created for validated WhatsApp number");
        } catch (convError) {
          logger.error("Failed to create conversation:", convError);
        }
      }
    }

    // Update lead with WhatsApp validation results (phone is mandatory)
    let whatsappStatus = "VALIDATED";
    let whatsappValid = true;

    // Check if this number has WhatsApp ecosystem restrictions
    if (whatsappRestricted) {
      whatsappStatus = "CONTACT_RESTRICTED";
      whatsappValid = false;

      await leadService.updateLead(leadId.id || leadId, {
        lastWhatsAppContact: admin.firestore.FieldValue.serverTimestamp(),
        lastWhatsAppStatus: whatsappStatus,
        whatsappValid: false,
        whatsappRestricted: true,
        whatsappRestrictionReason: restrictionReason || "ecosystem_engagement",
        preferredContactMethod: "EMAIL", // Mark for email contact instead
        needsAlternateContact: true,
      });

      statusNote +=
        " (WhatsApp messaging restricted due to ecosystem policy - lead marked for alternate contact)";
    } else {
      // Normal successful validation
      await leadService.updateLead(leadId.id || leadId, {
        lastWhatsAppContact: admin.firestore.FieldValue.serverTimestamp(),
        lastWhatsAppStatus: whatsappStatus,
        whatsappValid: true, // Number is confirmed valid
      });

      statusNote += " (WhatsApp number verified and validation message sent)";
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

    // Return user-friendly error message in Elementor format
    let userMessage =
      "We're having trouble processing your submission. Please try again.";

    // Check for specific error types
    if (error.message && error.message.includes("validation")) {
      userMessage =
        "Phone number validation failed. Please check your WhatsApp number and try again.";
    } else if (error.message && error.message.includes("Firebase")) {
      userMessage =
        "System temporarily unavailable. Please try again in a moment.";
    } else if (error.message && error.message.includes("programInterested")) {
      userMessage = "Form processing error. Please try again.";
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

    // Extract only the 10 specific application fields we need
    const firstName = formData["First Name"];
    const lastName = formData["Last Name"];
    const email = formData["Email Address"];
    const phone = formData["Telephone/Mobile No"];
    const countryOfBirth = formData["Country of Birth"];
    const gender = formData["Gender"];
    const modeOfStudy = formData["Mode of Study"];
    const intake = formData["Preferred Intake"];
    const courseOfInterest = formData["Preferred Program"];
    const courseOfInterest2 = formData["Other Sources"]; // Using as secondary course option

    // Combine first and last name
    const name = `${firstName || ""} ${lastName || ""}`.trim() || "Unknown";

    // Validate required fields
    if (!email) {
      // Elementor expects 200 status with success: false for form validation errors
      return res.status(200).json({
        success: false,
        message: "Email is required. Please provide a valid email address.",
        data: {
          message: "Email is required. Please provide a valid email address.",
        },
      });
    }

    // WhatsApp validation if phone is provided (Application form doesn't strictly require WhatsApp validation)
    let validatedPhone = null;
    if (phone && phone.trim()) {
      // Use centralized validation function but only for formatting, not blocking
      const validation = await validateWhatsAppNumber(
        phone,
        name,
        "application",
        true
      );

      // For application form, we don't block on WhatsApp validation
      // Just use the normalized phone number
      if (validation.normalizedPhone) {
        validatedPhone = validation.normalizedPhone;
      } else {
        // If validation failed, still normalize the phone for storage
        validatedPhone = phone.toString().replace(/^\+/, "").replace(/\D/g, "");
      }

      logger.debug(`Application form phone normalized: ${validatedPhone}`);
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
          case "other":
            return "other";
          case "prefer not to say":
            return "prefer_not_to_say";
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
            return "on_campus";
          case "online":
            return "online";
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
            return "january";
          case "may":
            return "may";
          case "august":
          case "aug":
            return "august";
          default:
            return null;
        }
      };

      const normalizeProgram = (value) => {
        if (!value || value.trim() === "") return null;
        const normalized = value.toLowerCase().trim();

        // Map program names to expected values
        if (
          normalized.includes("bachelor") &&
          normalized.includes("information technology")
        ) {
          return "bachelor_information_technology";
        } else if (
          normalized.includes("bachelor") &&
          normalized.includes("business administration")
        ) {
          return "bachelor_business_administration";
        } else if (
          normalized.includes("bachelor") &&
          normalized.includes("commerce")
        ) {
          return "bachelor_commerce";
        } else if (
          normalized.includes("master") &&
          normalized.includes("information technology")
        ) {
          return "master_information_technology";
        } else if (
          normalized.includes("master") &&
          normalized.includes("business administration")
        ) {
          return "master_business_administration";
        } else if (
          normalized.includes("diploma") &&
          normalized.includes("information technology")
        ) {
          return "diploma_information_technology";
        } else if (
          normalized.includes("diploma") &&
          normalized.includes("business administration")
        ) {
          return "diploma_business_administration";
        } else if (normalized.includes("certificate")) {
          return "certificate_programs";
        }

        // Default fallback - if no match found, use the first available program
        logger.warn(
          `Unknown program "${value}", defaulting to bachelor_information_technology`
        );
        return "bachelor_information_technology";
      };

      // Create application data with the 10 specific fields mapped to expected format
      const applicationData = {
        name,
        email,
        phoneNumber: validatedPhone || phone,
        countryOfBirth,
        gender: normalizeGender(gender),
        modeOfStudy: normalizeModeOfStudy(modeOfStudy),
        preferredIntake: normalizeIntake(intake),
        preferredProgram: normalizeProgram(courseOfInterest),
        additionalInfo: {
          firstName,
          lastName,
          courseOfInterest2,
          originalValues: {
            gender: gender,
            modeOfStudy: modeOfStudy,
            preferredIntake: intake,
            preferredProgram: courseOfInterest,
          },
        },
      };

      logger.debug("Normalized application data:", applicationData);

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

      logger.debug(`Generic webhook phone normalized: ${validatedPhone}`);
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
      rawData: formData, // Store full payload for debugging
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
      logger.debug(`Starting WhatsApp validation for ${phone}`);

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
      logger.debug(`Checking for existing lead with phone: ${phone}`);
      existingLead = await leadService.findLeadByPhone(phone);
    }

    // If no lead found by phone, check by email
    if (!existingLead && email) {
      logger.debug(`Checking for existing lead with email: ${email}`);
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
          logger.debug(`Adding new phone number ${phone} to existing lead`);

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
          logger.debug(`Adding new email ${email} to existing lead`);

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
        phone: validatedPhone || phone,
        program,
        country,
        status: "CONTACTED", // User initiated contact via Meta Ads form
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

// Export both the router and the pendingValidations for use by WhatsApp webhook
module.exports = {
  router,
  pendingValidations,
};
