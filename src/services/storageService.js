/**
 * Storage Service - Handles file operations with Firebase Storage
 * Uses Firebase Client SDK pattern for public URL generation
 */
const { initializeApp } = require("firebase/app");
const {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} = require("firebase/storage");
const { getAuth, signInWithCustomToken } = require("firebase/auth");
const admin = require("firebase-admin");

class StorageService {
  constructor() {
    // Initialize Firebase Client SDK
    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
    };

    // Initialize Firebase app for client SDK
    this.app = initializeApp(firebaseConfig, "storage-client");
    this.storage = getStorage(this.app);
    this.auth = getAuth(this.app);
    this.isAuthenticated = false;

    console.log("✅ Firebase Client SDK Storage initialized");

    // Authenticate on initialization
    this.authenticate();
  }

  /**
   * Authenticate with Firebase using Admin SDK to create custom token
   */
  async authenticate() {
    try {
      // Create a custom token using Admin SDK
      const uid = "storage-service-user";
      const customToken = await admin.auth().createCustomToken(uid);

      // Sign in with the custom token using Client SDK
      await signInWithCustomToken(this.auth, customToken);

      this.isAuthenticated = true;
      console.log("✅ Firebase Client SDK authenticated successfully");
    } catch (error) {
      console.error("❌ Firebase authentication failed:", error);
      this.isAuthenticated = false;
    }
  }

  /**
   * Ensure user is authenticated before storage operations
   */
  async ensureAuthenticated() {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    if (!this.isAuthenticated) {
      throw new Error(
        "Firebase authentication failed - cannot perform storage operations"
      );
    }
  }

  /**
   * Upload a file to Firebase Storage and return public download URL
   * @param {Object} file - File object (e.g., from multer)
   * @param {String} path - Storage path
   * @returns {Promise<String>} Public URL of the uploaded file
   */
  async uploadFile(file, path) {
    try {
      // Ensure user is authenticated
      await this.ensureAuthenticated();

      // Create a reference to the file in Firebase Storage
      const storageRef = ref(this.storage, path);

      // Upload the file
      const snapshot = await uploadBytes(storageRef, file.buffer, {
        contentType: file.mimetype,
      });

      // Get the public download URL
      const downloadURL = await getDownloadURL(snapshot.ref);

      console.log(`✅ File uploaded successfully: ${downloadURL}`);
      return downloadURL;
    } catch (error) {
      console.error("Error uploading file:", error);
      throw error;
    }
  }

  /**
   * Upload a base64-encoded file to Firebase Storage and return public download URL
   * @param {String} base64String - Base64-encoded file content
   * @param {String} path - Storage path
   * @param {String} mimeType - MIME type of the file
   * @returns {Promise<String>} Public URL of the uploaded file
   */
  async uploadBase64File(base64String, path, mimeType = null) {
    try {
      // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
      const base64Data = base64String.includes("base64,")
        ? base64String.split("base64,")[1]
        : base64String;

      // If mimeType is not provided, try to extract it from the data URL
      if (!mimeType && base64String.includes("data:")) {
        mimeType = base64String.split(";")[0].split(":")[1];
      }

      // Convert base64 to buffer
      const buffer = Buffer.from(base64Data, "base64");

      return this.storeFile(buffer, path, mimeType);
    } catch (error) {
      console.error("Error uploading base64 file:", error);
      throw error;
    }
  }

  /**
   * Store a file buffer in Firebase Storage and return public download URL
   * @param {Buffer} fileBuffer - File buffer
   * @param {String} path - Storage path
   * @param {String} mimeType - MIME type of the file
   * @returns {Promise<String>} Public URL of the uploaded file
   */
  async storeFile(fileBuffer, path, mimeType = null) {
    try {
      // Ensure user is authenticated
      await this.ensureAuthenticated();

      // Debug: Check buffer size
      console.log(
        `🔍 Buffer debug - Size: ${
          fileBuffer?.length || 0
        } bytes, Type: ${typeof fileBuffer}`
      );

      if (!fileBuffer || fileBuffer.length === 0) {
        throw new Error("File buffer is empty or undefined");
      }

      // Create a reference to the file in Firebase Storage
      const storageRef = ref(this.storage, path);

      // Upload the file buffer
      const snapshot = await uploadBytes(storageRef, fileBuffer, {
        contentType: mimeType,
      });

      // Get the public download URL
      const downloadURL = await getDownloadURL(snapshot.ref);

      console.log(`✅ File stored successfully: ${downloadURL}`);
      return downloadURL;
    } catch (error) {
      console.error("Error storing file:", error);
      throw error;
    }
  }

  /**
   * Upload a file from a local path to Firebase Storage and return public download URL
   * @param {String} filePath - Path to the file
   * @param {String} storagePath - Storage path
   * @returns {Promise<String>} Public URL of the uploaded file
   */
  async uploadFromPath(filePath, storagePath) {
    try {
      const fs = require("fs");
      const path = require("path");

      // Read the file
      const fileBuffer = fs.readFileSync(filePath);

      // Get the MIME type based on file extension
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = this.getMimeType(ext);

      // Use storeFile method
      return this.storeFile(fileBuffer, storagePath, mimeType);
    } catch (error) {
      console.error("Error uploading file from path:", error);
      throw error;
    }
  }

  /**
   * Delete a file from Firebase Storage
   * @param {String} storagePath - Storage path to the file
   * @returns {Promise<void>}
   */
  async deleteFile(storagePath) {
    try {
      console.log(`🗑️ Attempting to delete file: ${storagePath}`);

      // Clean up the path if it contains Firebase Storage URL components
      if (
        storagePath.includes("firebasestorage.googleapis.com") ||
        storagePath.includes("storage.googleapis.com")
      ) {
        console.log(
          `⚠️ Path appears to be a full URL, extracting file path...`
        );

        if (storagePath.includes("/o/")) {
          // Extract path after /o/
          const match = storagePath.match(/\/o\/([^?]+)/);
          if (match && match[1]) {
            storagePath = decodeURIComponent(match[1]);
            console.log(`🔄 Extracted file path from URL: ${storagePath}`);
          }
        }
      } else if (storagePath.startsWith("b/") && storagePath.includes("/o/")) {
        // Extract just the file path after /o/
        const match = storagePath.match(/\/o\/(.+?)($|\?)/);
        if (match && match[1]) {
          storagePath = decodeURIComponent(match[1]);
          console.log(`🔄 Corrected storage path: ${storagePath}`);
        }
      }

      // Use Admin SDK for delete operations (has full permissions)
      const bucket = admin.storage().bucket();

      // Log the bucket name for debugging
      console.log(`🪣 Using bucket: ${bucket.name}`);

      // Ensure the path doesn't start with a slash
      if (storagePath.startsWith("/")) {
        storagePath = storagePath.substring(1);
        console.log(`🔄 Removed leading slash: ${storagePath}`);
      }

      const file = bucket.file(storagePath);
      console.log(`🔎 Checking if file exists at path: ${storagePath}`);

      // Check if file exists first
      const [exists] = await file.exists();
      if (!exists) {
        console.log(`ℹ️ File does not exist: ${storagePath}`);

        // Try to list files with similar paths for debugging
        try {
          const parentPath = storagePath.split("/").slice(0, -1).join("/");
          console.log(`📂 Checking parent directory: ${parentPath}`);

          const [files] = await bucket.getFiles({
            prefix: parentPath,
          });

          console.log(`📂 Found ${files.length} files in parent directory:`);
          files.slice(0, 5).forEach((f) => console.log(`- ${f.name}`));
          if (files.length > 5) console.log(`... and ${files.length - 5} more`);

          // Try a fuzzy match
          const baseName = storagePath.split("/").pop();
          console.log(`� Looking for files similar to: ${baseName}`);

          const similarFiles = files.filter((f) => {
            const fileName = f.name.split("/").pop();
            // Check if it contains major parts of the filename (without tokens)
            const baseNameParts = baseName.split("_");
            if (baseNameParts.length >= 3) {
              return baseNameParts
                .slice(0, 3)
                .every((part) => fileName.includes(part));
            }
            return fileName.includes(baseName.split("_").pop());
          });

          if (similarFiles.length > 0) {
            console.log(`🔍 Found ${similarFiles.length} similar files:`);
            similarFiles.forEach((f) => console.log(`- ${f.name}`));
            console.log(
              `⚠️ File not found, but similar files exist. Will NOT delete similar files for safety.`
            );
          } else {
            console.log(`ℹ️ No similar files found in directory.`);
          }
        } catch (listErr) {
          console.log(
            `⚠️ Could not list files in parent directory: ${listErr.message}`
          );
        }

        // Return without error - file doesn't exist is not a critical error
        console.log(
          `ℹ️ File deletion skipped - file does not exist: ${storagePath}`
        );
        return;
      }

      // Delete the file using Admin SDK
      await file.delete();
      console.log(`✅ File deleted successfully: ${storagePath}`);
    } catch (error) {
      console.error(`Error deleting file ${storagePath}:`, error);
      throw error;
    }
  }

  /**
   * Get MIME type based on file extension
   * @param {String} ext - File extension
   * @returns {String} MIME type
   */
  getMimeType(ext) {
    const mimeTypes = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".txt": "text/plain",
    };

    return mimeTypes[ext] || "application/octet-stream";
  }
}

module.exports = StorageService;
