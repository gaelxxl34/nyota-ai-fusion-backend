const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

// Initialize Firebase
const serviceAccountPath = path.join(__dirname, "../../serviceAccountKey.json");
if (!fs.existsSync(serviceAccountPath)) {
  console.error("serviceAccountKey.json not found");
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function resetUserPassword(email, newPassword) {
  try {
    // Find user by email
    const user = await admin.auth().getUserByEmail(email);
    console.log(`Found user: ${user.uid} (${user.email})`);

    // Update password
    await admin.auth().updateUser(user.uid, {
      password: newPassword,
    });

    console.log(`Password has been reset for ${email}`);

    // Print user information
    console.log("User details:");
    console.log(JSON.stringify(user, null, 2));

    // Check if user has Firestore data
    const db = admin.firestore();
    const systemAdminDoc = await db
      .collection("systemAdmins")
      .doc(user.uid)
      .get();
    const userDoc = await db.collection("users").doc(user.uid).get();

    if (systemAdminDoc.exists) {
      console.log("User is a system admin");
      console.log(JSON.stringify(systemAdminDoc.data(), null, 2));
    } else if (userDoc.exists) {
      console.log("User is a regular user");
      console.log(JSON.stringify(userDoc.data(), null, 2));
    } else {
      console.warn("User exists in Auth but not in Firestore!");
    }

    return true;
  } catch (error) {
    console.error("Error resetting password:", error);
    return false;
  }
}

// Execute if called directly
if (require.main === module) {
  const [, , email, password] = process.argv;

  if (!email || !password) {
    console.error("Usage: node resetUserPassword.js <email> <newPassword>");
    process.exit(1);
  }

  resetUserPassword(email, password)
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Script error:", error);
      process.exit(1);
    });
}

module.exports = { resetUserPassword };
