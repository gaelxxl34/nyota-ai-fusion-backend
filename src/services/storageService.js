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
      // Ensure user is authenticated
      await this.ensureAuthenticated();

      // Create a reference to the file in Firebase Storage
      const storageRef = ref(this.storage, storagePath);

      // Delete the file
      await deleteObject(storageRef);

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
