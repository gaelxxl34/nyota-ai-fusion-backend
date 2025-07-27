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

/**
 * Creates a super admin user with full system access
 * @param {string} email - The email address for the super admin
 * @param {string} password - The password for the super admin
 * @param {string} name - The display name for the super admin (optional)
 * @returns {Promise<Object>} The created user record
 */
async function createSuperAdmin(email, password, name = null) {
  try {
    const db = admin.firestore();
    const auth = admin.auth();

    console.log(`Creating super admin with email: ${email}`);

    // Create the user in Firebase Auth
    const userRecord = await auth.createUser({
      email,
      password,
      emailVerified: true,
      displayName: name || email.split("@")[0],
    });

    console.log(`✅ Firebase Auth user created: ${userRecord.uid}`);

    // Set custom claims for immediate role recognition
    await auth.setCustomUserClaims(userRecord.uid, {
      role: "superAdmin",
    });

    console.log("✅ Custom claims set");

    // Add user to users collection with superAdmin role
    const userData = {
      uid: userRecord.uid,
      email,
      name: name || email.split("@")[0],
      displayName: name || email.split("@")[0],
      role: "superAdmin",
      status: "active",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: "system",
      lastLogin: null,
    };

    await db.collection("users").doc(userRecord.uid).set(userData);

    console.log("✅ User document created in Firestore");
    console.log("\n🎉 Super admin created successfully!");
    console.log("📧 Email:", email);
    console.log("🔑 Password:", password);
    console.log("🆔 User ID:", userRecord.uid);
    console.log("👤 Display Name:", userData.displayName);
    console.log(
      "\n⚡ The user can now log in with full super admin privileges"
    );

    return userRecord;
  } catch (error) {
    if (error.code === "auth/email-already-exists") {
      console.error("❌ Error: A user with this email already exists");
    } else if (error.code === "auth/invalid-email") {
      console.error("❌ Error: Invalid email address format");
    } else if (error.code === "auth/weak-password") {
      console.error(
        "❌ Error: Password is too weak. Please use a stronger password"
      );
    } else {
      console.error("❌ Error creating super admin:", error.message);
    }
    throw error;
  }
}

/**
 * Updates an existing user to super admin role
 * @param {string} email - The email address of the existing user
 * @returns {Promise<Object>} The updated user record
 */
async function upgradeToSuperAdmin(email) {
  try {
    const db = admin.firestore();
    const auth = admin.auth();

    console.log(`Upgrading user to super admin: ${email}`);

    // Get user by email
    const userRecord = await auth.getUserByEmail(email);

    if (!userRecord) {
      throw new Error("User not found");
    }

    // Set custom claims
    await auth.setCustomUserClaims(userRecord.uid, {
      role: "superAdmin",
    });

    // Update user document in Firestore
    await db.collection("users").doc(userRecord.uid).update({
      role: "superAdmin",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      upgradedToSuperAdmin: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("✅ User upgraded to super admin successfully!");
    console.log("🆔 User ID:", userRecord.uid);
    console.log("📧 Email:", email);

    return userRecord;
  } catch (error) {
    console.error("❌ Error upgrading user to super admin:", error.message);
    throw error;
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "create") {
    const [, email, password, name] = args;

    if (!email || !password) {
      console.error(
        "\n📋 Usage: node createSuperAdmin.js create <email> <password> [name]"
      );
      console.error("\n📝 Example:");
      console.error(
        "   node createSuperAdmin.js create admin@iuea.ac.ug SecurePass123 'John Doe'"
      );
      process.exit(1);
    }

    createSuperAdmin(email, password, name)
      .then(() => {
        process.exit(0);
      })
      .catch((error) => {
        process.exit(1);
      });
  } else if (command === "upgrade") {
    const [, email] = args;

    if (!email) {
      console.error("\n📋 Usage: node createSuperAdmin.js upgrade <email>");
      console.error("\n📝 Example:");
      console.error("   node createSuperAdmin.js upgrade existing@iuea.ac.ug");
      process.exit(1);
    }

    upgradeToSuperAdmin(email)
      .then(() => {
        process.exit(0);
      })
      .catch((error) => {
        process.exit(1);
      });
  } else {
    console.error("\n🛠️  Super Admin Management Tool");
    console.error("\n📋 Commands:");
    console.error("   create  - Create a new super admin user");
    console.error("   upgrade - Upgrade an existing user to super admin");
    console.error("\n📝 Usage:");
    console.error(
      "   node createSuperAdmin.js create <email> <password> [name]"
    );
    console.error("   node createSuperAdmin.js upgrade <email>");
    console.error("\n💡 Examples:");
    console.error(
      "   node createSuperAdmin.js create admin@iuea.ac.ug SecurePass123 'John Doe'"
    );
    console.error("   node createSuperAdmin.js upgrade existing@iuea.ac.ug");
    process.exit(1);
  }
}

module.exports = { createSuperAdmin, upgradeToSuperAdmin };
