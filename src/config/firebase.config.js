const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

let firebaseApp = null;

const initializeFirebase = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // First check for service account file
    const serviceAccountPath = path.join(
      __dirname,
      "../../serviceAccountKey.json"
    );

    if (fs.existsSync(serviceAccountPath)) {
      console.log("Loading Firebase credentials from serviceAccountKey.json");
      const serviceAccount = JSON.parse(
        fs.readFileSync(serviceAccountPath, "utf8")
      );

      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    } else {
      // Fallback to environment variables
      console.log(
        "Service account file not found, using environment variables"
      );

      if (
        !process.env.FIREBASE_PRIVATE_KEY ||
        !process.env.FIREBASE_CLIENT_EMAIL
      ) {
        throw new Error(
          "Firebase credentials missing from environment variables"
        );
      }

      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey,
        }),
      });
    }

    // Verify Firebase connection
    admin
      .firestore()
      .listCollections()
      .then(() => {
        console.log("✅ Firebase Firestore connection verified");
      });

    return firebaseApp;
  } catch (error) {
    console.error("Firebase initialization error:", error);
    throw error;
  }
};

module.exports = {
  admin,
  initializeFirebase,
  getFirebaseAdmin: () => admin,
  isInitialized: () => !!firebaseApp,
};
