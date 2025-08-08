/**
 * Storage Service - Handles file operations with Firebase Storage
 */
const { getStorage } = require("firebase-admin/storage");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");
const { format } = require("util");

class StorageService {
  constructor() {
    this.storage = getStorage();
    this.bucket = this.storage.bucket(
      process.env.FIREBASE_STORAGE_BUCKET || "nyota-ai-fusion.appspot.com"
    );
  }

  /**
   * Upload a file to Firebase Storage
   * @param {Object} file - File object (e.g., from multer)
   * @param {String} path - Storage path
   * @returns {Promise<String>} Public URL of the uploaded file
   */
  async uploadFile(file, path) {
    try {
      // Create a reference to the file in Firebase Storage
      const fileRef = this.bucket.file(path);

      // Upload the file
      await fileRef.save(file.buffer, {
        metadata: {
          contentType: file.mimetype,
        },
      });

      // Make the file publicly accessible
      await fileRef.makePublic();

      // Get the public URL
      const publicUrl = format(
        `https://storage.googleapis.com/${this.bucket.name}/${fileRef.name}`
      );

      return publicUrl;
    } catch (error) {
      console.error("Error uploading file:", error);
      throw error;
    }
  }

  /**
   * Upload a base64-encoded file to Firebase Storage
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
   * Store a file buffer in Firebase Storage
   */
  async storeFile(fileBuffer, path, mimeType = null) {
    const fileRef = this.bucket.file(path);

    await fileRef.save(fileBuffer, {
      metadata: {
        contentType: mimeType,
      },
    });

    // Make the file publicly accessible
    await fileRef.makePublic();

    // Get the public URL
    return format(
      `https://storage.googleapis.com/${this.bucket.name}/${fileRef.name}`
    );
  }

  /**
   * Upload a file from a local path to Firebase Storage
   * @param {String} filePath - Path to the file
   * @param {String} storagePath - Storage path
   * @returns {Promise<String>} Public URL of the uploaded file
   */
  async uploadFromPath(filePath, storagePath) {
    try {
      // Get the MIME type based on file extension
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = this.getMimeType(ext);

      // Upload the file to Firebase Storage
      await this.bucket.upload(filePath, {
        destination: storagePath,
        metadata: {
          contentType: mimeType,
        },
      });

      // Make the file publicly accessible
      const fileRef = this.bucket.file(storagePath);
      await fileRef.makePublic();

      // Get the public URL
      const publicUrl = format(
        `https://storage.googleapis.com/${this.bucket.name}/${fileRef.name}`
      );

      return publicUrl;
    } catch (error) {
      console.error("Error uploading file from path:", error);
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
