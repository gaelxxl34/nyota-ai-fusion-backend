/**
 * Script to recheck lead qualifications
 * This script can be run manually or scheduled to run periodically
 */

const LeadService = require("../services/leadService");
const WhatsAppLeadIntegration = require("../services/whatsappLeadIntegration");
const { initializeFirebase } = require("../config/firebase.config");
const admin = require("firebase-admin");

async function main() {
  try {
    // Initialize Firebase
    const app = initializeFirebase();
    const db = admin.firestore();

    // Initialize services
    const leadService = new LeadService(db);
    const whatsappIntegration = new WhatsAppLeadIntegration(leadService, db);

    // Run the recheck
    const updatedCount = await whatsappIntegration.recheckLeadQualifications();

    console.log(`Recheck completed. Updated ${updatedCount} leads.`);
    process.exit(0);
  } catch (error) {
    console.error("Error running lead qualification recheck:", error);
    process.exit(1);
  }
}

main();
