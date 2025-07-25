const express = require("express");
const router = express.Router();
const { admin } = require("../config/firebase.config");
const { LEAD_SOURCES } = require("../config/lead.constants");
const WebhookForwarder = require("../services/webhookForwarder");
const LeadService = require("../services/leadService");
const whatsappMessageService = require("../services/whatsappMessageService");
const ApplicationService = require("../services/applicationService");

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
 * Process WordPress website inquiries
 * This handles form submissions from the WordPress website
 * Expected fields: firstname, lastname, email, phone, message
 */
router.post("/wordpress", validateWebhookSource, async (req, res) => {
  try {
    const formData = req.body;
    console.log(
      "📨 WordPress webhook received:",
      JSON.stringify(formData, null, 2)
    );

    // Extract data using exact field names provided by developer
    // Handle both lowercase and capitalized field names from Elementor
    const firstName = formData.firstname || formData["First Name"];
    const lastName = formData.lastname || formData["Last Name"];
    const email = formData.email || formData["Email"];
    const phone = formData.phone || formData["Phone Number"];
    const message = formData.message || formData["Message"];

    // Combine first and last name
    const name = `${firstName || ""} ${lastName || ""}`.trim() || "Unknown";

    // Validate required fields
    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    // Initialize services
    const db = admin.firestore();
    const leadService = new LeadService(db);

    // Check for duplicate leads by phone or email
    let existingLead = null;
    let actionTaken = "";

    // First check by phone number if available
    if (phone && phone.trim()) {
      console.log(`🔍 Checking for existing lead with phone: ${phone}`);
      existingLead = await leadService.findLeadByPhone(phone);
    }

    // If no lead found by phone, check by email
    if (!existingLead && email) {
      console.log(`🔍 Checking for existing lead with email: ${email}`);
      existingLead = await leadService.findLeadByEmail(email);
    }

    let leadId;
    let statusNote = "";

    if (existingLead) {
      // Update existing lead with WordPress inquiry information
      console.log(
        `♻️ Updating existing lead ${existingLead.id} with WordPress inquiry data`
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
        phone,
        message,
        status: initialStatus,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      leadId = await leadService.createLead(leadData, LEAD_SOURCES.WEBSITE);
      actionTaken = "created_new_lead";
      statusNote = "New lead created from WordPress inquiry";
    }

    // Send WhatsApp welcome message if phone is provided (asynchronously)
    if (phone && phone.trim()) {
      // Send welcome message only for new leads or leads with no previous WhatsApp contact
      const shouldSendMessage =
        actionTaken === "created_new_lead" ||
        (actionTaken === "updated_existing_lead" &&
          (!existingLead.lastWhatsAppContact ||
            Date.now() - existingLead.lastWhatsAppContact.toMillis() >
              1000 * 60 * 60 * 24 * 7)); // Only resend if more than 7 days

      if (shouldSendMessage) {
        // Custom welcome message for IUEA inquiries
        const welcomeMessage = `Hello ${name}! 👋\n\nThank you for your interest in IUEA (International University of East Africa)! 🎓\n\nWe're excited to help you with your educational journey. Are you interested in any specific program? Our admissions team will contact you soon to discuss your options.\n\nBest regards,\nIUEA Admissions Team`;

        // Send message asynchronously - don't wait for response
        whatsappMessageService
          .sendMessage(phone, welcomeMessage, "text", {
            source: "wordpress_webhook",
            leadId: leadId.id, // Use the actual ID string
            messageType: "welcome",
          })
          .then((whatsappResult) => {
            // Update lead with WhatsApp status after message is sent
            if (whatsappResult && whatsappResult.success === false) {
              console.error(
                "❌ Failed to send WhatsApp message:",
                whatsappResult.error
              );

              // Update lead status asynchronously
              leadService
                .updateLead(leadId.id, {
                  lastWhatsAppStatus: "FAILED",
                  lastWhatsAppError: whatsappResult.error,
                  lastWhatsAppContact:
                    admin.firestore.FieldValue.serverTimestamp(),
                })
                .catch((updateError) => {
                  console.error(
                    "❌ Failed to update lead WhatsApp status:",
                    updateError
                  );
                });
            } else {
              // Update lead with successful WhatsApp contact
              leadService
                .updateLead(leadId.id, {
                  lastWhatsAppStatus: "SUCCESS",
                  lastWhatsAppContact:
                    admin.firestore.FieldValue.serverTimestamp(),
                })
                .catch((updateError) => {
                  console.error(
                    "❌ Failed to update lead WhatsApp status:",
                    updateError
                  );
                });
            }
          })
          .catch((error) => {
            console.error("❌ Error sending WhatsApp message:", error);
          });

        statusNote += " (WhatsApp message being sent asynchronously)";
      } else {
        statusNote +=
          " (Skipped WhatsApp message - already contacted recently)";
      }
    } else {
      // No phone provided
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
    console.error("❌ Error processing WordPress webhook:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process WordPress webhook",
      details: error.message,
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
    console.log(
      "📨 Google Ads webhook received:",
      JSON.stringify(formData, null, 2)
    );

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
      return res.status(400).json({
        success: false,
        error: "Email is required",
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
      console.log(`🔍 Checking for existing lead with phone: ${phone}`);
      existingLead = await leadService.findLeadByPhone(phone);
    }

    // If no lead found by phone, check by email
    if (!existingLead && email) {
      console.log(`🔍 Checking for existing lead with email: ${email}`);
      existingLead = await leadService.findLeadByEmail(email);
    }

    let leadId;
    let statusNote = "";

    if (existingLead) {
      // Update existing lead with Google Ads information
      console.log(
        `♻️ Updating existing lead ${existingLead.id} with Google Ads data`
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
      console.log(`🆕 Creating new lead for Google Ads inquiry`);

      const leadData = {
        firstName,
        lastName,
        name,
        email,
        phone: phone || null,
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

    // Send WhatsApp welcome message if phone is provided (asynchronously)
    if (phone && phone.trim()) {
      // Send welcome message only for new leads or leads with no previous WhatsApp contact
      const shouldSendMessage =
        actionTaken === "created_new_lead" ||
        (actionTaken === "updated_existing_lead" &&
          (!existingLead.lastWhatsAppContact ||
            Date.now() - existingLead.lastWhatsAppContact.toMillis() >
              1000 * 60 * 60 * 24 * 7)); // Only resend if more than 7 days

      if (shouldSendMessage) {
        // Custom welcome message for Google Ads leads
        const welcomeMessage = `Hello ${name}! 👋\n\nThank you for your interest in IUEA (International University of East Africa) through our Google Ad! 🎓\n\n${
          programInterested
            ? `We see you're interested in: ${programInterested}\n\n`
            : ""
        }We're excited to help you with your educational journey. Our admissions team will contact you soon to discuss your options and answer any questions you may have.\n\nBest regards,\nIUEA Admissions Team`;

        // Send message asynchronously - don't wait for response
        whatsappMessageService
          .sendMessage(phone, welcomeMessage, "text", {
            source: "google_ads_webhook",
            leadId: leadId.id,
            messageType: "welcome",
            program: programInterested,
          })
          .then((whatsappResult) => {
            // Update lead with WhatsApp status after message is sent
            if (whatsappResult && whatsappResult.success === false) {
              console.error(
                "❌ Failed to send WhatsApp message:",
                whatsappResult.error
              );

              // Update lead status asynchronously
              leadService
                .updateLead(leadId.id, {
                  lastWhatsAppStatus: "FAILED",
                  lastWhatsAppError: whatsappResult.error,
                  lastWhatsAppContact:
                    admin.firestore.FieldValue.serverTimestamp(),
                })
                .catch((updateError) => {
                  console.error(
                    "❌ Failed to update lead WhatsApp status:",
                    updateError
                  );
                });
            } else {
              // Update lead with successful WhatsApp contact
              leadService
                .updateLead(leadId.id, {
                  lastWhatsAppStatus: "SUCCESS",
                  lastWhatsAppContact:
                    admin.firestore.FieldValue.serverTimestamp(),
                })
                .catch((updateError) => {
                  console.error(
                    "❌ Failed to update lead WhatsApp status:",
                    updateError
                  );
                });
            }
          })
          .catch((error) => {
            console.error("❌ Error sending WhatsApp message:", error);
          });

        statusNote += " (WhatsApp message being sent asynchronously)";
      } else {
        statusNote +=
          " (Skipped WhatsApp message - already contacted recently)";
      }
    } else {
      // No phone provided
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
    console.error("❌ Error processing Google Ads webhook:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process Google Ads webhook",
      details: error.message,
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
    console.log(
      "📨 Application form webhook received:",
      JSON.stringify(formData, null, 2)
    );

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
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
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
      // Create application data with the 10 specific fields mapped to expected format
      const applicationData = {
        name,
        email,
        phoneNumber: phone,
        countryOfBirth,
        gender,
        modeOfStudy,
        preferredIntake: intake,
        preferredProgram: courseOfInterest,
        additionalInfo: {
          firstName,
          lastName,
          courseOfInterest2,
        },
      };

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

      console.log(
        `📋 Application processed: ${result.application.id}, Lead: ${result.lead?.id}`
      );
    } catch (submitError) {
      console.error("❌ Error submitting application:", submitError);
      return res.status(500).json({
        success: false,
        error: "Failed to submit application",
        details: submitError.message,
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
    console.error("❌ Error processing application form webhook:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process application form webhook",
      details: error.message,
    });
  }
});

// Keep the original generic webhook for backward compatibility
router.post("/receive", async (req, res) => {
  try {
    const formData = req.body;
    console.log(
      "📨 Generic webhook received:",
      JSON.stringify(formData, null, 2)
    );

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

    // Initialize services
    const db = admin.firestore();
    const leadService = new LeadService(db);

    // Create lead record
    const leadData = {
      name,
      email,
      phone,
      program,
      rawData: formData, // Store full payload for debugging
      status: "INQUIRY",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const leadId = await leadService.createLead(leadData, LEAD_SOURCES.OTHER);

    // Send WhatsApp welcome message if phone is provided
    if (phone) {
      try {
        await whatsappMessageService.sendWelcomeMessage(phone, name);
      } catch (whatsappError) {
        console.error("❌ Failed to send WhatsApp message:", whatsappError);
      }
    }

    res.status(200).json({
      success: true,
      message: "Generic webhook processed successfully",
      leadId,
    });
  } catch (error) {
    console.error("❌ Error processing generic webhook:", error);
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
    console.log(
      "📨 Meta Ads webhook received:",
      JSON.stringify(formData, null, 2)
    );

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

    // Initialize services
    const db = admin.firestore();
    const leadService = new LeadService(db);

    // Check for duplicate leads by phone or email
    let existingLead = null;
    let actionTaken = "";

    // First check by phone number
    if (phone && phone.trim()) {
      console.log(`🔍 Checking for existing lead with phone: ${phone}`);
      existingLead = await leadService.findLeadByPhone(phone);
    }

    // If no lead found by phone, check by email
    if (!existingLead && email) {
      console.log(`🔍 Checking for existing lead with email: ${email}`);
      existingLead = await leadService.findLeadByEmail(email);
    }

    let leadId;
    let statusNote = "";

    if (existingLead) {
      // Update existing lead with Meta Ads information
      console.log(
        `♻️ Updating existing lead ${existingLead.id} with Meta Ads data`
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
          console.log(`📱 Adding new phone number ${phone} to existing lead`);

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
            console.error(
              "❌ Failed to update lead with new phone number:",
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
          console.log(`📧 Adding new email ${email} to existing lead`);

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
            console.error(
              "❌ Failed to update lead with new email:",
              updateError
            );
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
      console.log(`🆕 Creating new lead for Meta Ads inquiry`);

      const leadData = {
        firstName,
        lastName,
        name,
        email,
        phone,
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

    // Send WhatsApp welcome message if phone is provided (asynchronously)
    if (phone && phone.trim()) {
      // Send welcome message for new leads OR existing leads with new phone numbers
      const shouldSendMessage =
        actionTaken === "created_new_lead" ||
        (actionTaken === "updated_existing_lead" &&
          statusNote.includes("New phone number added"));

      if (shouldSendMessage) {
        // Personalized welcome message for Meta Ads leads
        const welcomeMessage = `Hello ${
          firstName || "there"
        }! 👋\n\nThank you for your interest in our programs through Facebook/Instagram! 🎓\n\nWe're excited to help you with your educational journey. ${
          program
            ? `We've noted your interest in the ${program} program.`
            : "Our team will help you find the right program for you."
        }\n\nOur admissions team will contact you soon to discuss your options.\n\nBest regards,\nAdmissions Team`;

        // Send message asynchronously - don't wait for response
        whatsappMessageService
          .sendMessage(phone, welcomeMessage, "text", {
            source: "meta_ads_webhook",
            leadId: leadId.id, // Use the actual ID string
            messageType:
              actionTaken === "created_new_lead"
                ? "welcome"
                : "new_number_welcome",
          })
          .then((whatsappResult) => {
            // Update lead with WhatsApp status after message is sent
            if (whatsappResult && whatsappResult.success === false) {
              console.error(
                "❌ Failed to send WhatsApp message:",
                whatsappResult.error
              );

              // Update lead asynchronously
              leadService
                .updateLead(leadId.id, {
                  lastWhatsAppStatus: "FAILED",
                  lastWhatsAppError: whatsappResult.error,
                  lastWhatsAppContact:
                    admin.firestore.FieldValue.serverTimestamp(),
                })
                .catch((updateError) => {
                  console.error(
                    "❌ Failed to update lead WhatsApp status:",
                    updateError
                  );
                });
            } else {
              console.log("✅ WhatsApp welcome message sent successfully");

              // Update lead with successful WhatsApp contact
              leadService
                .updateLead(leadId.id, {
                  lastWhatsAppStatus: "SUCCESS",
                  lastWhatsAppContact:
                    admin.firestore.FieldValue.serverTimestamp(),
                })
                .catch((updateError) => {
                  console.error(
                    "❌ Failed to update lead WhatsApp status:",
                    updateError
                  );
                });
            }
          })
          .catch((error) => {
            console.error("❌ Error sending WhatsApp message:", error);
          });

        statusNote += " (WhatsApp welcome message being sent asynchronously)";
      } else {
        // For existing leads with the same phone number, we don't send another welcome message
        statusNote +=
          " (No duplicate WhatsApp message sent - using same phone number)";
      }
    } else {
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
    console.error("❌ Error processing Meta Ads webhook:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process Meta Ads webhook",
    });
  }
});

module.exports = router;
