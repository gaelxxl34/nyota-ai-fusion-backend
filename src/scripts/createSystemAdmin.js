const admin = require("firebase-admin");
const path = require("path");
const serviceAccount = require(path.join(
  __dirname,
  "../serviceAccountKey.json"
));

// Initialize Firebase Admin with service account
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function createSystemAdmin(email, password) {
  try {
    const db = admin.firestore();
    const auth = admin.auth();

    // Create the user in Firebase Auth
    const userRecord = await auth.createUser({
      email,
      password,
      emailVerified: true,
    });

    // Add user to systemAdmins collection
    await db.collection("systemAdmins").doc(userRecord.uid).set({
      email,
      role: "systemAdmin",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Set custom claims
    await auth.setCustomUserClaims(userRecord.uid, {
      role: "systemAdmin",
    });

    console.log("System admin created successfully:", userRecord.uid);
    return userRecord;
  } catch (error) {
    console.error("Error creating system admin:", error);
    throw error;
  }
}

// Main execution
if (require.main === module) {
  const [, , email, password] = process.argv;

  if (!email || !password) {
    console.error("Usage: node createSystemAdmin.js <email> <password>");
    process.exit(1);
  }

  createSystemAdmin(email, password)
    .then(() => {
      console.log("System admin created successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed to create system admin:", error);
      process.exit(1);
    });
}

module.exports = { createSystemAdmin };
