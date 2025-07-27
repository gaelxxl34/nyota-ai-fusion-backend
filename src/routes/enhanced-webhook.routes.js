const express = require("express");
const router = express.Router();
const { admin } = require("../config/firebase.config");
const { LEAD_SOURCES } = require("../config/lead.constants");
const WebhookForwarder = require("../services/webhookForwarder");
const LeadService = require("../services/leadService");
const whatsappMessageService = require("../services/whatsappMessageService");
const ApplicationService = require("../services/applicationService");
const logger = require("../utils/logger");

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

/**
 * Centralized WhatsApp validation function
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
      "Invalid phone number. Please enter a valid international phone number (10-15 digits).";

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

  logger.debug(`Phone normalized: ${normalizedPhone} (source: ${source})`);
  logger.debug(`Testing WhatsApp number: ${normalizedPhone}`);

  // Wait 2 seconds before testing to avoid rate limits
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Customize test message based on source
  let testMessage;
  switch (source) {
    case "wordpress":
      testMessage = `Hello ${name}! 👋\n\nThank you for your interest in IUEA. We're processing your inquiry.\n\nThis is a verification message to confirm your WhatsApp number.`;
      break;
    case "google_ads":
      testMessage = `Hello ${name}! 👋\n\nThank you for your interest in IUEA through our Google Ad. We're processing your inquiry.\n\nThis is a verification message to confirm your WhatsApp number.`;
      break;
    case "meta_ads":
      testMessage = `Hello ${name}! 👋\n\nThank you for your interest in our programs through Facebook/Instagram. We're processing your inquiry.\n\nThis is a verification message to confirm your WhatsApp number.`;
      break;
    default:
      testMessage = `Hello ${name}! 👋\n\nThank you for your interest. We're processing your inquiry.\n\nThis is a verification message to confirm your WhatsApp number.`;
  }

  try {
    const validationResult = await whatsappMessageService.sendMessage(
      normalizedPhone,
      testMessage,
      "text",
      {
        source: `${source}_webhook_validation`,
        messageType: "validation",
      }
    );

    // Check if it's a 24-hour window error (which means number is valid but can't receive messages)
    const is24HourError =
      validationResult?.error &&
      (validationResult.error.includes("24 hour") ||
        validationResult.error.includes("outside the allowed window") ||
        validationResult.error.includes("template message") ||
        validationResult.error.includes("131047")); // WhatsApp error code for 24-hour window

    // Check for invalid number errors
    const isInvalidNumber =
      validationResult?.error &&
      (validationResult.error.includes("131026") || // Not a valid WhatsApp user
        validationResult.error.includes("131051") || // Invalid/Unsupported recipient
        validationResult.error.includes("not registered on WhatsApp") ||
        validationResult.error.includes("invalid number"));

    if (!validationResult.success && !is24HourError) {
      // Real error - number not on WhatsApp
      logger.error(`WhatsApp validation failed: ${validationResult.error}`);

      const errorMessage =
        "The phone number provided is not registered on WhatsApp. Please provide a valid WhatsApp number.";

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
            details: validationResult.error,
          },
        },
      };
    }

    if (is24HourError) {
      logger.debug(
        `WhatsApp number valid but can't send due to 24-hour policy`
      );
      return {
        isValid: true,
        normalizedPhone,
        is24HourRestricted: true,
        validationResult,
      };
    }

    logger.debug(`WhatsApp validation successful`);
    return {
      isValid: true,
      normalizedPhone,
      is24HourRestricted: false,
      validationResult,
    };
  } catch (validationError) {
    logger.error("WhatsApp validation error:", validationError);

    const errorMessage =
      "Unable to verify WhatsApp number. Please ensure the number is correct and try again.";

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
      // Elementor expects 200 status with success: false for form validation errors
      return res.status(200).json({
        success: false,
        message: "Email is required. Please provide a valid email address.",
        data: {
          message: "Email is required. Please provide a valid email address.",
        },
      });
    }

    // WhatsApp validation if phone is provided
    let validatedPhone = null;
    let whatsappValidationResult = null;

    if (phone && phone.trim()) {
      // Use centralized validation function
      const validation = await validateWhatsAppNumber(
        phone,
        name,
        "wordpress",
        true
      );

      // If validation failed, return the error response
      if (!validation.isValid) {
        return res
          .status(validation.errorResponse.status)
          .json(validation.errorResponse.body);
      }

      // If we get here, the number is either valid or has 24-hour restriction
      validatedPhone = validation.normalizedPhone;
      whatsappValidationResult = validation.validationResult;
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
      // Determine initial status based on phone availability
      let initialStatus = "INQUIRY";

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

      leadId = await leadService.createLead(leadData, LEAD_SOURCES.WEBSITE);
      actionTaken = "created_new_lead";
      statusNote = "New lead created from WordPress inquiry";
    }

    // Update WhatsApp status based on validation result
    if (phone && phone.trim() && validatedPhone) {
      // Get validation result from our centralized validation
      const validation = await validateWhatsAppNumber(
        phone,
        name,
        "wordpress",
        true
      );

      if (validation.is24HourRestricted) {
        await leadService.updateLead(leadId.id || leadId, {
          lastWhatsAppStatus: "VALID_24HR_LIMIT",
          lastWhatsAppContact: admin.firestore.FieldValue.serverTimestamp(),
          whatsappValid: true,
        });
        statusNote +=
          " (WhatsApp number verified but can't send messages due to 24-hour policy)";
      } else if (validation.isValid && !validation.is24HourRestricted) {
        await leadService.updateLead(leadId.id || leadId, {
          lastWhatsAppStatus: "SUCCESS",
          lastWhatsAppContact: admin.firestore.FieldValue.serverTimestamp(),
          whatsappValid: true,
        });
        statusNote += " (WhatsApp number verified successfully)";

        // Send follow-up welcome message only for new leads
        if (actionTaken === "created_new_lead") {
          const welcomeMessage = `Welcome to IUEA! 🎓\n\nWe've received your inquiry and our admissions team will contact you soon to discuss your educational journey.\n\nAre you interested in any specific program? Feel free to let us know!\n\nBest regards,\nIUEA Admissions Team`;

          // Send asynchronously - don't wait
          setTimeout(() => {
            whatsappMessageService
              .sendMessage(validatedPhone, welcomeMessage, "text", {
                source: "wordpress_webhook_followup",
                leadId: leadId.id || leadId,
                messageType: "welcome",
              })
              .catch((error) => {
                logger.error("Error sending follow-up message:", error);
              });
          }, 5000); // 5 second delay for follow-up
        }
      }
    } else if (!phone) {
      statusNote += " (No phone number provided for WhatsApp contact)";
    }

    res.status(200).json({
      success: true,
      message: "WordPress webhook processed successfully",
      leadId: leadId?.id || leadId,
      actionTaken,
      statusNote,
    });
  } catch (error) {
    logger.error("Error processing WordPress webhook:", error);

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
 * Process Google Ads lead form submissions
 * Expected fields: firstname, lastname, email, phone, program_interested
 */
router.post("/google-ads", validateWebhookSource, async (req, res) => {
  try {
    const formData = req.body;
    logger.webhook("Google Ads", formData);

    // Extract data using direct field names (like WordPress webhook)
    const firstName = formData.firstname || formData.first_name;
    const lastName = formData.lastname || formData.last_name;
    const email = formData.email;
    const phone = formData.phone;
    const programInterested =
      formData.program_interested ||
      formData.program ||
      formData.course_interested;

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

    // WhatsApp validation if phone is provided
    let validatedPhone = null;
    let whatsappValidationResult = null;

    if (phone && phone.trim()) {
      // Use centralized validation function
      const validation = await validateWhatsAppNumber(
        phone,
        name,
        "google_ads",
        true
      );

      // If validation failed, return the error response
      if (!validation.isValid) {
        return res
          .status(validation.errorResponse.status)
          .json(validation.errorResponse.body);
      }

      // If we get here, the number is either valid or has 24-hour restriction
      validatedPhone = validation.normalizedPhone;
      whatsappValidationResult = validation.validationResult;
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
      // Update existing lead with Google Ads information
      logger.info(
        `Updating existing lead ${existingLead.id} with Google Ads data`
      );

      // Update the lead with Google Ads info (using a simpler approach)
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
      // Create new lead
      logger.info(`Creating new lead for Google Ads inquiry`);

      const leadData = {
        firstName,
        lastName,
        name,
        email,
        phone: validatedPhone || phone || null,
        program: programInterested,
        googleAdsInfo: {
          campaignId:
            formData.google_campaign_id || formData.campaign_id || null,
          adGroupId:
            formData.google_ad_group_id || formData.ad_group_id || null,
          clickId: formData.gclid || null,
          rawPayload: formData,
        },
        status: "INQUIRY",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      leadId = await leadService.createLead(leadData, LEAD_SOURCES.GOOGLE_ADS);
      actionTaken = "created_new_lead";
      statusNote = "New lead created from Google Ads inquiry";
    }

    // Update WhatsApp status based on validation result
    if (phone && phone.trim() && validatedPhone) {
      // Get validation result from our centralized validation
      const validation = await validateWhatsAppNumber(
        phone,
        name,
        "google_ads",
        true
      );

      if (validation.is24HourRestricted) {
        await leadService.updateLead(leadId.id || leadId, {
          lastWhatsAppStatus: "VALID_24HR_LIMIT",
          lastWhatsAppContact: admin.firestore.FieldValue.serverTimestamp(),
          whatsappValid: true,
        });
        statusNote +=
          " (WhatsApp number verified but can't send messages due to 24-hour policy)";
      } else if (validation.isValid && !validation.is24HourRestricted) {
        await leadService.updateLead(leadId.id || leadId, {
          lastWhatsAppStatus: "SUCCESS",
          lastWhatsAppContact: admin.firestore.FieldValue.serverTimestamp(),
          whatsappValid: true,
        });
        statusNote += " (WhatsApp number verified successfully)";

        // Send follow-up welcome message only for new leads
        if (actionTaken === "created_new_lead") {
          const welcomeMessage = `Welcome to IUEA! 🎓\n\n${
            programInterested
              ? `We see you're interested in: ${programInterested}\n\n`
              : ""
          }We've received your inquiry through Google Ads and our admissions team will contact you soon.\n\nFeel free to ask any questions!\n\nBest regards,\nIUEA Admissions Team`;

          // Send asynchronously - don't wait
          setTimeout(() => {
            whatsappMessageService
              .sendMessage(validatedPhone, welcomeMessage, "text", {
                source: "google_ads_webhook_followup",
                leadId: leadId.id || leadId,
                messageType: "welcome",
                program: programInterested,
              })
              .catch((error) => {
                logger.error("Error sending follow-up message:", error);
              });
          }, 5000); // 5 second delay for follow-up
        }
      }
    } else if (!phone) {
      statusNote += " (No phone number provided for WhatsApp contact)";
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
    logger.error("Error processing Google Ads webhook:", error);

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

      if (
        result.lead &&
        !result.lead.timeline?.find((t) => t.status === "APPLIED")
      ) {
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
      status: "INQUIRY",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const leadId = await leadService.createLead(leadData, LEAD_SOURCES.OTHER);

    // Send WhatsApp welcome message if phone is provided
    if (validatedPhone || phone) {
      try {
        await whatsappMessageService.sendWelcomeMessage(
          validatedPhone || phone,
          name
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

    // WhatsApp validation if phone is provided
    let validatedPhone = null;
    let whatsappValidationResult = null;

    if (phone && phone.trim()) {
      // Use centralized validation function (Meta Ads is not on Elementor, so isElementorForm = false)
      const validation = await validateWhatsAppNumber(
        phone,
        firstName || name,
        "meta_ads",
        false
      );

      // If validation failed, return the error response
      if (!validation.isValid) {
        return res
          .status(validation.errorResponse.status)
          .json(validation.errorResponse.body);
      }

      // If we get here, the number is either valid or has 24-hour restriction
      validatedPhone = validation.normalizedPhone;
      whatsappValidationResult = validation.validationResult;
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
        status: "INQUIRY",
        source: LEAD_SOURCES.META_ADS,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        // Store original Meta Ads data for reference
        metaAdsData: formData,
      };

      leadId = await leadService.createLead(leadData, LEAD_SOURCES.META_ADS);
      actionTaken = "created_new_lead";
      statusNote = "New lead created from Meta Ads inquiry";
    }

    // Update WhatsApp status based on validation result
    if (phone && phone.trim() && validatedPhone) {
      // Get validation result from our centralized validation
      const validation = await validateWhatsAppNumber(
        phone,
        firstName || name,
        "meta_ads",
        false
      );

      if (validation.is24HourRestricted) {
        await leadService.updateLead(leadId.id || leadId, {
          lastWhatsAppStatus: "VALID_24HR_LIMIT",
          lastWhatsAppContact: admin.firestore.FieldValue.serverTimestamp(),
          whatsappValid: true,
        });
        statusNote +=
          " (WhatsApp number verified but can't send messages due to 24-hour policy)";
      } else if (validation.isValid && !validation.is24HourRestricted) {
        await leadService.updateLead(leadId.id || leadId, {
          lastWhatsAppStatus: "SUCCESS",
          lastWhatsAppContact: admin.firestore.FieldValue.serverTimestamp(),
          whatsappValid: true,
        });
        statusNote += " (WhatsApp number verified successfully)";

        // Send follow-up welcome message only for new leads OR new phone numbers
        const shouldSendFollowup =
          actionTaken === "created_new_lead" ||
          (actionTaken === "updated_existing_lead" &&
            statusNote.includes("New phone number added"));

        if (shouldSendFollowup) {
          const welcomeMessage = `Welcome! 🎓\n\n${
            program
              ? `We've noted your interest in the ${program} program.`
              : "Our team will help you find the right program for you."
          }\n\nWe've received your inquiry through Facebook/Instagram and our admissions team will contact you soon.\n\nBest regards,\nAdmissions Team`;

          // Send asynchronously - don't wait
          setTimeout(() => {
            whatsappMessageService
              .sendMessage(validatedPhone, welcomeMessage, "text", {
                source: "meta_ads_webhook_followup",
                leadId: leadId.id || leadId,
                messageType:
                  actionTaken === "created_new_lead"
                    ? "welcome"
                    : "new_number_welcome",
              })
              .catch((error) => {
                logger.error("Error sending follow-up message:", error);
              });
          }, 5000); // 5 second delay for follow-up
        }
      }
    } else if (!phone) {
      statusNote += " (No phone number provided for WhatsApp contact)";
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

// Validation status endpoint removed - no longer needed with simplified approach

module.exports = router;
