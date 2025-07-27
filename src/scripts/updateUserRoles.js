/**
 * Script to update user roles in the system
 *
 * This script can be used to:
 * - Migrate from old role names to new role names
 * - Clean up organizationId fields (since this is a single-org system)
 * - Ensure all users have proper roles assigned
 *
 * Usage: node src/scripts/updateUserRoles.js
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

// Initialize Firebase Admin
const serviceAccount = require("../serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

// Valid roles in the system
const VALID_ROLES = [
  "superAdmin",
  "admin",
  "marketingManager",
  "admissionsOfficer",
  "teamMember",
];

// Default role for users without a role
const DEFAULT_ROLE = "teamMember";

async function updateUserRoles() {
  console.log("🚀 Starting user role update process...\n");

  try {
    // Get all users from Firestore
    const usersSnapshot = await db.collection("users").get();

    if (usersSnapshot.empty) {
      console.log("❌ No users found in the database.");
      return;
    }

    console.log(`📊 Found ${usersSnapshot.size} users to process.\n`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const updateDetails = [];

    // Process each user
    for (const doc of usersSnapshot.docs) {
      const userId = doc.id;
      const userData = doc.data();
      const currentRole = userData.role;
      let needsUpdate = false;
      const updates = {};

      try {
        // Check if user has a valid role
        if (!currentRole || !VALID_ROLES.includes(currentRole)) {
          console.log(
            `⚠️  User ${
              userData.email || userId
            } has invalid role '${currentRole}'. Setting to '${DEFAULT_ROLE}'`
          );
          updates.role = DEFAULT_ROLE;
          updates.roleUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
          needsUpdate = true;
        }

        // Remove organizationId if it exists (single-org system)
        if (userData.organizationId) {
          console.log(
            `🧹 Removing organizationId from user ${userData.email || userId}`
          );
          updates.organizationId = admin.firestore.FieldValue.delete();
          needsUpdate = true;
        }

        if (needsUpdate) {
          // Update Firestore
          await doc.ref.update(updates);

          // Update Firebase Auth custom claims if role was updated
          if (updates.role) {
            try {
              await auth.setCustomUserClaims(userId, {
                role: updates.role,
                userId: userId,
              });
              console.log(
                `✅ Updated auth claims for ${userData.email || userId}`
              );
            } catch (authError) {
              console.warn(
                `⚠️  Could not update auth claims for ${userId}: ${authError.message}`
              );
            }
          }

          updateDetails.push({
            userId,
            email: userData.email,
            oldRole: currentRole || "none",
            newRole: updates.role || currentRole,
            status: "updated",
            updates: Object.keys(updates),
          });
          updatedCount++;
        } else {
          console.log(
            `⏭️  Skipping user ${userData.email || userId}: no updates needed`
          );
          updateDetails.push({
            userId,
            email: userData.email,
            role: currentRole,
            status: "skipped",
          });
          skippedCount++;
        }
      } catch (error) {
        console.error(`❌ Error processing user ${userId}:`, error.message);
        updateDetails.push({
          userId,
          email: userData.email,
          role: currentRole,
          status: "error",
          error: error.message,
        });
        errorCount++;
      }
    }

    // Generate summary report
    console.log("\n" + "=".repeat(60));
    console.log("📊 UPDATE SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total users processed: ${usersSnapshot.size}`);
    console.log(`✅ Successfully updated: ${updatedCount}`);
    console.log(`⏭️  Skipped (no updates needed): ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log("=".repeat(60) + "\n");

    // Show current role distribution
    const roleDistribution = {};
    for (const doc of usersSnapshot.docs) {
      const userData = doc.data();
      const role = userData.role || DEFAULT_ROLE;
      roleDistribution[role] = (roleDistribution[role] || 0) + 1;
    }

    console.log("📊 CURRENT ROLE DISTRIBUTION:");
    console.log("-".repeat(30));
    VALID_ROLES.forEach((role) => {
      const count = roleDistribution[role] || 0;
      console.log(`${role.padEnd(20)} : ${count} users`);
    });
    console.log("-".repeat(30) + "\n");

    // Save update log
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logFileName = `role_update_${timestamp}.json`;
    const logsDir = path.join(__dirname, "logs");

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const logPath = path.join(logsDir, logFileName);

    // Write update log
    fs.writeFileSync(
      logPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          summary: {
            totalUsers: usersSnapshot.size,
            updated: updatedCount,
            skipped: skippedCount,
            errors: errorCount,
          },
          roleDistribution,
          details: updateDetails,
        },
        null,
        2
      )
    );

    console.log(`📝 Update log saved to: ${logPath}`);
  } catch (error) {
    console.error("❌ Fatal error during update:", error);
    process.exit(1);
  }
}

// Main execution
console.log(
  "⚠️  This script will update user roles in your production database."
);
console.log("⚠️  Make sure you have a backup before proceeding.\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("Do you want to continue? (yes/no): ", async (answer) => {
  if (answer.toLowerCase() === "yes") {
    await updateUserRoles();
    console.log("\n✅ Update process completed!");
  } else {
    console.log("\n❌ Update cancelled.");
  }
  rl.close();
  process.exit(0);
});
