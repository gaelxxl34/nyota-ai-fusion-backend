const express = require("express");
const router = express.Router();
const { admin } = require("../config/firebase.config");
const WebhookForwarder = require("../services/webhookForwarder");
const WhatsAppValidationService = require("../services/whatsappValidationService");

// Initialize services
const forwarder = new WebhookForwarder();
const whatsappValidator = new WhatsAppValidationService();

// Webhook endpoint to receive form data
router.post("/receive", async (req, res) => {
  try {
    const formData = req.body;
    const timestamp = new Date().toISOString();

    console.log("📨 Webhook received:", JSON.stringify(formData, null, 2));

    // Extract email and other data from the webhook payload
    // Handle different field name formats from Elementor forms
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

    // Determine form type based on form_name or form_id
    let formType = formData.form_type || "inquiry";
    if (formData.form_name) {
      if (formData.form_name.toLowerCase().includes("application")) {
        formType = "admission";
      } else if (
        formData.form_name.toLowerCase().includes("request") ||
        formData.form_name.toLowerCase().includes("inquiry")
      ) {
        formType = "inquiry";
      }
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required in the webhook payload",
      });
    }

    // Validate WhatsApp phone number if provided
    if (phone) {
      console.log(`📞 Validating WhatsApp number: ${phone}`);

      try {
        const phoneValidation = await whatsappValidator.validateNumber(phone);

        if (!phoneValidation.isValid) {
          console.log(
            `❌ Phone validation failed for ${phone}:`,
            phoneValidation.error
          );
          return res.status(400).json({
            success: false,
            error: phoneValidation.error || "Invalid phone number provided",
            details: {
              providedNumber: phone,
              normalizedNumber: phoneValidation.normalizedNumber,
              validationType: phoneValidation.validationType,
            },
            suggestion:
              "Please check the phone number and ensure it's a valid WhatsApp number.",
          });
        }

        console.log(
          `✅ Phone validation successful for ${phone} (${phoneValidation.normalizedNumber})`
        );

        // Use the normalized number for further processing
        const validatedPhone = phoneValidation.normalizedNumber;

        // Update the phone variable to use the normalized number
        Object.assign(formData, { validatedPhone, phoneValidation });
      } catch (validationError) {
        console.error("❌ Phone validation service error:", validationError);

        // For service errors, we can either:
        // 1. Allow the submission (lenient approach)
        // 2. Block the submission (strict approach)

        // Using lenient approach - log warning but continue
        console.warn(
          `⚠️ Phone validation service unavailable, allowing submission for ${phone}`
        );
      }
    }

    const db = admin.firestore();

    // Check if contact already exists with this email
    const existingContactQuery = await db
      .collection("contacts")
      .where("email", "==", email)
      .get();

    // If contact already exists, don't create duplicate
    if (!existingContactQuery.empty) {
      console.log(
        `Contact with email ${email} already exists, skipping creation`
      );
      return res.status(200).json({
        success: true,
        message:
          "Contact with this email already exists, no new record created",
        email: email,
        existingContactId: existingContactQuery.docs[0].id,
      });
    }

    // Determine organization ID (you may need to adjust this logic)
    // For now, we'll use a default organization or the first organization
    const organizationsSnapshot = await db
      .collection("organizations")
      .limit(1)
      .get();
    let organizationId = null;

    if (!organizationsSnapshot.empty) {
      organizationId = organizationsSnapshot.docs[0].id;
    }

    // Create contact record
    const contactData = {
      name: name || "Unknown",
      email: email,
      phone: formData.validatedPhone || phone || "", // Use validated phone number if available
      phoneValidation: formData.phoneValidation || null, // Store validation info
      program: program || "",
      source: formData.source || "Webhook",
      formType: formType,
      status: formType === "admission" ? "closed_deal" : "new_inquiry", // Different status based on form type
      dealStatus: formType === "admission" ? "closed_won" : "open", // Marketing deal status
      marketingStage:
        formType === "admission" ? "deal_closed" : "lead_generation", // Marketing stage
      organizationId: organizationId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      webhookData: formData, // Store original webhook data
      submittedAt: timestamp,
    };

    const contactRef = await db.collection("contacts").add(contactData);
    console.log(`✅ Contact created with ID: ${contactRef.id}`);

    // If it's an inquiry form, create a contact that can be nurtured through marketing activities
    if (formType === "inquiry" || !formType) {
      // Update contact status to indicate it's ready for marketing activities
      await contactRef.update({
        leadStatus: "new_inquiry",
        marketingStage: "lead_nurturing",
        qualificationScore: 0, // Will be scored through marketing activities
        tags: ["inquiry", "marketing_active"],
        notes: "New inquiry - ready for marketing nurturing activities",
      });

      console.log(`✅ Contact marked for marketing nurturing activities`);
    }

    // If it's an admission form, this is a CLOSED DEAL - marketing activities stop here
    if (formType === "admission") {
      // Extract additional data for admission forms
      const dateOfBirth = formData["Date of Birth"];
      const country =
        formData["Country of Birth"] || formData["Country of Residence"];
      const gender = formData["Gender"];
      const address = formData["Postal Address"];
      const city = formData["City/Town"];
      const modeOfStudy = formData["Mode of Study"];
      const intake = formData["Preferred Intake"];
      const academicDocs = formData["Academic Documents"];
      const idDocument = formData["Identification Document"];
      const sponsor =
        formData[
          "Who Will Sponsor Your Education at International University of East Africa?*"
        ];
      const source = formData["Source of IUEA Interest"];

      const applicationData = {
        contactId: contactRef.id,
        name: name || "Unknown",
        email: email,
        phone: phone || "",
        program: program || "",
        status: "enrolled", // This is a closed deal
        dealStatus: "closed_won", // Marketing perspective: deal is won
        applicationId: `APP-${Date.now()}`,
        organizationId: organizationId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        // Additional application-specific fields
        personalDetails: {
          dateOfBirth: dateOfBirth,
          country: country,
          gender: gender,
          address: address,
          city: city,
        },
        programDetails: {
          modeOfStudy: modeOfStudy,
          intake: intake,
        },
        documents: [
          academicDocs && { type: "Academic Documents", url: academicDocs },
          idDocument && { type: "ID Document", url: idDocument },
        ].filter(Boolean),
        submittedDocuments: [academicDocs, idDocument].filter(Boolean),
        sponsorInfo: {
          sponsor: sponsor,
          address: formData["Sponsor Address"],
          phone: formData["Sponsor Telephone"],
          email: formData["Sponsor Email"],
        },
        source: source,
        marketingNotes:
          "Application submitted - deal closed, no further marketing activities needed",
        formData: formData,
      };

      const applicationRef = await db
        .collection("applications")
        .add(applicationData);
      console.log(
        `✅ Application created with ID: ${applicationRef.id} - DEAL CLOSED`
      );

      // Update contact to reflect this is now a closed deal
      await contactRef.update({
        applicationId: applicationRef.id,
        dealStatus: "closed_won",
        marketingStage: "deal_closed",
        closedAt: admin.firestore.FieldValue.serverTimestamp(),
        tags: ["application", "enrolled", "closed_deal"],
        notes:
          "Application submitted - student enrolled, marketing activities complete",
      });
    }

    res.status(200).json({
      success: true,
      message: "Webhook data processed successfully",
      contactId: contactRef.id,
      email: email,
      formType: formType,
      timestamp: timestamp,
    });
  } catch (error) {
    console.error("❌ Webhook processing error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process webhook data",
      details: error.message,
    });
  }
});

// Proxy endpoint for external webhooks (like from http://64.23.250.205/webhook)
router.post("/proxy", async (req, res) => {
  try {
    console.log("🌐 External webhook received via proxy");
    console.log("📡 Headers:", JSON.stringify(req.headers, null, 2));
    console.log("📦 Body:", JSON.stringify(req.body, null, 2));

    // Process the webhook through the forwarder
    const result = await forwarder.processWebhook(req.body, {
      source: "external-proxy",
      userAgent: req.headers["user-agent"],
      ip: req.ip || req.connection.remoteAddress,
      originalUrl: req.originalUrl,
    });

    if (result.success) {
      res.status(200).json({
        success: true,
        message: "Webhook processed successfully via proxy",
        processingTime: result.processingTime,
        timestamp: result.timestamp,
        data: result.data,
      });
    } else {
      res.status(400).json({
        success: false,
        message: "Webhook processing failed",
        error: result.error,
        processingTime: result.processingTime,
        timestamp: result.timestamp,
      });
    }
  } catch (error) {
    console.error("❌ Proxy webhook error:", error);
    res.status(500).json({
      success: false,
      error: "Proxy webhook processing failed",
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get all contacts for data center
router.get("/contacts", async (req, res) => {
  try {
    console.log(
      "📋 Fetching contacts for organizationId:",
      req.query.organizationId
    );
    const { organizationId } = req.query;
    const db = admin.firestore();

    let query = db.collection("contacts");

    if (organizationId) {
      query = query.where("organizationId", "==", organizationId);
    }

    // Add ordering - but handle case where createdAt might not exist
    try {
      query = query.orderBy("createdAt", "desc");
    } catch (orderError) {
      console.warn("Could not order by createdAt, using default order");
    }

    const snapshot = await query.get();
    const contacts = [];

    console.log(`📊 Found ${snapshot.size} contacts`);

    snapshot.forEach((doc) => {
      const data = doc.data();
      contacts.push({
        id: doc.id,
        ...data,
        createdAt:
          data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        submittedAt:
          data.submittedAt ||
          data.createdAt?.toDate?.()?.toISOString() ||
          new Date().toISOString(),
      });
    });

    // Sort by createdAt desc on the client side (since we might not have the index)
    contacts.sort((a, b) => {
      const dateA = new Date(a.createdAt);
      const dateB = new Date(b.createdAt);
      return dateB - dateA; // Descending order
    });

    console.log("✅ Successfully fetched contacts");
    res.json({
      success: true,
      contacts: contacts,
      count: contacts.length,
    });
  } catch (error) {
    console.error("❌ Error fetching contacts:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch contacts",
      details: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// Get all applications for data center
router.get("/applications", async (req, res) => {
  try {
    console.log(
      "📋 Fetching applications for organizationId:",
      req.query.organizationId
    );
    const { organizationId } = req.query;
    const db = admin.firestore();

    let query = db.collection("applications");

    if (organizationId) {
      query = query.where("organizationId", "==", organizationId);
    }

    // Try to order by createdAt, but fallback if index doesn't exist
    let snapshot;
    try {
      query = query.orderBy("createdAt", "desc");
      snapshot = await query.get();
    } catch (indexError) {
      if (indexError.code === 9) {
        // FAILED_PRECONDITION
        console.warn(
          "⚠️ Composite index not ready for applications, using simpler query"
        );
        // Fallback: query without ordering
        let fallbackQuery = db.collection("applications");
        if (organizationId) {
          fallbackQuery = fallbackQuery.where(
            "organizationId",
            "==",
            organizationId
          );
        }
        snapshot = await fallbackQuery.get();
      } else {
        throw indexError;
      }
    }
    const applications = [];

    console.log(`📊 Found ${snapshot.size} applications`);

    snapshot.forEach((doc) => {
      const data = doc.data();
      applications.push({
        id: doc.id,
        ...data,
        createdAt:
          data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        submittedAt:
          data.submittedAt ||
          data.createdAt?.toDate?.()?.toISOString() ||
          new Date().toISOString(),
        // Ensure documents field exists
        documents: data.submittedDocuments || data.documents || [],
      });
    });

    // Sort by createdAt desc on the client side (since we might not have the index)
    applications.sort((a, b) => {
      const dateA = new Date(a.createdAt);
      const dateB = new Date(b.createdAt);
      return dateB - dateA; // Descending order
    });

    console.log("✅ Successfully fetched applications");
    res.json({
      success: true,
      applications: applications,
      count: applications.length,
    });
  } catch (error) {
    console.error("❌ Error fetching applications:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch applications",
      details: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// Phone number validation endpoint for frontend forms
router.post("/validate-phone", async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      });
    }

    console.log(`📞 Validating phone number: ${phoneNumber}`);

    const validation = await whatsappValidator.validateNumber(phoneNumber);

    console.log(`📊 Validation result:`, validation);

    // Return appropriate response based on validation result
    if (validation.isValid) {
      res.json({
        success: true,
        isValid: true,
        normalizedNumber: validation.normalizedNumber,
        validationType: validation.validationType,
        isWhatsAppValid: validation.isWhatsAppValid,
        message: validation.isWhatsAppValid
          ? "Valid WhatsApp number"
          : "Valid phone number format (WhatsApp status unknown)",
      });
    } else {
      res.status(400).json({
        success: false,
        isValid: false,
        error: validation.error,
        normalizedNumber: validation.normalizedNumber,
        validationType: validation.validationType,
        suggestion:
          "Please check the phone number and ensure it's a valid WhatsApp number.",
      });
    }
  } catch (error) {
    console.error("❌ Error validating phone number:", error);
    res.status(500).json({
      success: false,
      error: "Phone validation service temporarily unavailable",
      details: error.message,
    });
  }
});

module.exports = router;
