/**
 * Script to check and update pending WhatsApp validations
 * This can be run periodically to clean up stale pending validations
 */

const admin = require("firebase-admin");
const path = require("path");

// Initialize Firebase Admin
const serviceAccount = require(path.join(
  __dirname,
  "../../serviceAccountKey.json"
));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function checkPendingValidations() {
  try {
    console.log("🔍 Checking for pending WhatsApp validations...");

    // Find all leads with pending validation status
    const snapshot = await db
      .collection("leads")
      .where("whatsappValidationStatus", "==", "PENDING")
      .get();

    if (snapshot.empty) {
      console.log("✅ No pending validations found");
      return;
    }

    console.log(`📋 Found ${snapshot.size} leads with pending validation`);

    const now = Date.now();
    const TIMEOUT_MINUTES = 5; // Consider validation failed after 5 minutes

    for (const doc of snapshot.docs) {
      const lead = doc.data();
      const leadId = doc.id;

      // Check if validation has been pending for too long
      const createdAt = lead.createdAt?.toMillis() || 0;
      const minutesPending = (now - createdAt) / (1000 * 60);

      if (minutesPending > TIMEOUT_MINUTES) {
        console.log(
          `⏰ Lead ${leadId} validation timeout (${minutesPending.toFixed(
            1
          )} minutes)`
        );

        // Update lead to mark validation as failed
        await doc.ref.update({
          whatsappValidationStatus: "TIMEOUT",
          whatsappValidated: false,
          whatsappValidationError:
            "Validation timeout - no delivery confirmation received",
          whatsappValidationDate: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`❌ Marked lead ${leadId} as validation timeout`);
      } else {
        console.log(
          `⏳ Lead ${leadId} still pending (${minutesPending.toFixed(
            1
          )} minutes)`
        );
      }
    }

    console.log("✅ Pending validation check completed");
  } catch (error) {
    console.error("❌ Error checking pending validations:", error);
  } finally {
    // Close the app
    await admin.app().delete();
  }
}

// Run the check
checkPendingValidations();
