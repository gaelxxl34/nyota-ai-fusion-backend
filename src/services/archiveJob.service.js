const { admin } = require("../config/firebase.config");
const logger = require("../utils/logger");

const ARCHIVE_ROOT_COLLECTION = "archives";
const ARCHIVE_DOCUMENTS_SUBCOLLECTION = "documents";
const MAX_BATCH_SIZE = 250;
const INTAKE_ORDER = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const SUPPORTED_COLLECTIONS = [
  {
    id: "messages",
    label: "Messages",
    yearFields: ["year", "academicYear", "metadata.academicYear"],
    intakeFields: ["intake", "intakePeriod", "metadata.intake"],
  },
  {
    id: "leads",
    label: "Leads",
    yearFields: ["academicYear", "year", "metadata.academicYear"],
    intakeFields: ["intake", "intakePeriod", "semester", "metadata.intake"],
  },
  {
    id: "users",
    label: "Users",
    yearFields: ["academicYear", "year"],
    intakeFields: ["intake", "intakePeriod"],
  },
  {
    id: "conversations",
    label: "Conversations",
    yearFields: ["academicYear", "year", "metadata.academicYear"],
    intakeFields: ["intake", "intakePeriod", "metadata.intake"],
  },
  {
    id: "applications",
    label: "Applications",
    yearFields: ["academicYear", "year", "applicationYear"],
    intakeFields: ["intake", "intakePeriod", "applicationIntake"],
  },
  {
    id: "applicationDrafts",
    label: "Application Drafts",
    yearFields: ["academicYear", "year"],
    intakeFields: ["intake", "intakePeriod"],
  },
  {
    id: "campaigns",
    label: "Campaigns",
    yearFields: ["academicYear", "year"],
    intakeFields: ["intake", "intakePeriod"],
  },
  {
    id: "organizations",
    label: "Organizations",
    yearFields: ["academicYear", "year"],
    intakeFields: ["intake", "intakePeriod"],
  },
  {
    id: "test",
    label: "Test",
    yearFields: ["academicYear", "year"],
    intakeFields: ["intake", "intakePeriod"],
  },
];

class ArchiveJobService {
  constructor(db = admin.firestore()) {
    this.db = db;
  }

  getSupportedCollections() {
    return SUPPORTED_COLLECTIONS;
  }

  async getCollectionStats(collectionId) {
    try {
      const collectionRef = this.db.collection(collectionId);
      const aggregate = await collectionRef.count().get();
      return {
        id: collectionId,
        count: aggregate.data().count,
      };
    } catch (error) {
      logger.warn("Unable to run count aggregate", {
        collectionId,
        error: error.message,
      });
      return {
        id: collectionId,
        count: null,
        error: error.message,
      };
    }
  }

  async getAvailableFilters(collectionId) {
    const collectionConfig = SUPPORTED_COLLECTIONS.find(
      (item) => item.id === collectionId
    );

    if (!collectionConfig) {
      throw new Error(`Unsupported collection: ${collectionId}`);
    }

    const years = new Set();
    const intakes = new Set();

    const snapshot = await this.db.collection(collectionId).limit(2000).get();
    snapshot.docs.forEach((doc) => {
      this.addFilterValuesFromDocument(
        doc.data(),
        collectionConfig,
        years,
        intakes
      );
    });

    // Check archived collections
    const archivedSnapshot = await this.db
      .collection(ARCHIVE_ROOT_COLLECTION)
      .where("collectionId", "==", collectionId)
      .limit(100)
      .get();

    archivedSnapshot.docs.forEach((doc) => {
      const archive = doc.data();
      const filters = archive?.filters || {};

      if (filters.year) {
        years.add(String(filters.year));
      }
      if (filters.intake) {
        intakes.add(String(filters.intake));
      }
    });

    return {
      collectionId,
      years: this.sortYears(Array.from(years)),
      intakes: this.sortIntakes(Array.from(intakes)),
    };
  }

  async listJobs(limit = 20) {
    const snapshot = await this.db
      .collection("archiveJobs")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => this.decorateJob(doc.id, doc.data()));
  }

  async getNextPendingJob() {
    const snapshot = await this.db
      .collection("archiveJobs")
      .where("status", "==", "pending")
      .orderBy("createdAt", "asc")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    return this.decorateJob(doc.id, doc.data());
  }

  async getJob(jobId) {
    const doc = await this.db.collection("archiveJobs").doc(jobId).get();

    if (!doc.exists) {
      throw new Error(`Archive job not found: ${jobId}`);
    }

    return this.decorateJob(doc.id, doc.data());
  }

  async executeArchive({ collectionId, year, intake, action, requestedBy }) {
    const collectionConfig = SUPPORTED_COLLECTIONS.find(
      (item) => item.id === collectionId
    );

    if (!collectionConfig) {
      throw new Error(`Unsupported collection: ${collectionId}`);
    }

    if (!action || !["archive", "delete"].includes(action)) {
      throw new Error("Action must be either 'archive' or 'delete'");
    }

    const filters = {
      year: year || null,
      intake: intake || null,
    };

    const jobData = {
      collectionId,
      collectionLabel: collectionConfig.label,
      filters,
      action,
      requestedBy,
      status: "running",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Fetch matching documents
    const documents = await this.fetchMatchingDocuments(
      { collectionId, filters },
      collectionConfig
    );

    const stats = {
      scanned: documents.length,
      matched: documents.length,
      archived: 0,
      deleted: 0,
    };

    if (documents.length === 0) {
      throw new Error("No documents found matching the specified filters");
    }

    // Process documents immediately
    let archiveSnapshot = null;

    if (action === "archive") {
      archiveSnapshot = await this.createArchiveSnapshot(
        collectionConfig,
        filters,
        documents,
        requestedBy
      );
      stats.archived = documents.length;
    } else if (action === "delete") {
      await this.deleteDocuments(collectionId, documents);
      stats.deleted = documents.length;
    }

    // Record completion
    const completedJobData = {
      ...jobData,
      status: "completed",
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      stats,
      archiveId: archiveSnapshot?.archiveId || null,
      archivePath: archiveSnapshot?.path || null,
    };

    const jobRef = await this.db
      .collection("archiveJobs")
      .add(completedJobData);

    const jobSnapshot = await jobRef.get();
    const decoratedJob = this.decorateJob(jobSnapshot.id, jobSnapshot.data());

    logger.info(`Archive ${action} completed`, {
      collectionId,
      documentCount: documents.length,
      filters,
      archiveId: archiveSnapshot?.archiveId || null,
    });

    return decoratedJob;
  }

  async fetchMatchingDocuments(
    { collectionId, filters = {} },
    collectionConfig
  ) {
    if (!collectionConfig) {
      throw new Error(`Unsupported collection: ${collectionId}`);
    }

    const snapshot = await this.db.collection(collectionId).get();

    const matches = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();

      if (this.matchesFilters(data, filters, collectionConfig)) {
        matches.push({
          id: doc.id,
          data,
        });
      }
    });

    return matches;
  }

  async createArchiveSnapshot(
    collectionConfig,
    filters,
    documents,
    requestedBy
  ) {
    // Generate a descriptive document ID
    const documentId = this.generateArchiveDocumentId(
      collectionConfig.id,
      filters
    );

    const archiveRef = this.db
      .collection(ARCHIVE_ROOT_COLLECTION)
      .doc(documentId);

    // Check if archive already exists
    const existingArchive = await archiveRef.get();
    if (existingArchive.exists) {
      const archiveName = this.formatArchiveName(
        collectionConfig.label,
        filters
      );
      throw new Error(
        `Archive already exists for ${archiveName}. Please delete the existing archive first or choose different filters.`
      );
    }

    const metadata = {
      collectionId: collectionConfig.id,
      collectionLabel: collectionConfig.label,
      filters: {
        year: filters.year || null,
        intake: filters.intake || null,
      },
      documentCount: documents.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: this.sanitizeRequestedBy(requestedBy),
      status: "archiving",
    };

    await archiveRef.set(metadata);

    const batches = this.chunkDocuments(documents, MAX_BATCH_SIZE);
    for (const batch of batches) {
      const writeBatch = this.db.batch();

      batch.forEach((document) => {
        const archiveDocRef = archiveRef
          .collection(ARCHIVE_DOCUMENTS_SUBCOLLECTION)
          .doc(document.id);

        const archivedData = {
          ...this.serializeFirestoreData(document.data),
          _archivedAt: admin.firestore.FieldValue.serverTimestamp(),
          _archivedBy: this.sanitizeRequestedBy(requestedBy),
          _archivedFilters: {
            year: filters.year || null,
            intake: filters.intake || null,
          },
        };

        writeBatch.set(archiveDocRef, archivedData);
      });

      await writeBatch.commit();
    }

    await archiveRef.update({
      status: "completed",
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("Archive snapshot created", {
      collectionId: collectionConfig.id,
      documentCount: documents.length,
      filters,
      archiveId: archiveRef.id,
    });

    return {
      archiveId: archiveRef.id,
      path: `${ARCHIVE_ROOT_COLLECTION}/${archiveRef.id}`,
    };
  }

  async deleteDocuments(collectionId, documents) {
    const batches = this.chunkDocuments(documents, MAX_BATCH_SIZE);

    for (const batch of batches) {
      const writeBatch = this.db.batch();
      batch.forEach((document) => {
        const sourceRef = this.db.collection(collectionId).doc(document.id);
        writeBatch.delete(sourceRef);
      });
      await writeBatch.commit();
    }

    logger.info(`Deleted ${documents.length} documents from ${collectionId}`);
  }

  async checkArchiveExists(collectionId, year, intake) {
    const archiveId = this.generateArchiveDocumentId(collectionId, {
      year: year || null,
      intake: intake || null,
    });

    const archiveRef = this.db
      .collection(ARCHIVE_ROOT_COLLECTION)
      .doc(archiveId);
    const archiveDoc = await archiveRef.get();

    return archiveDoc.exists;
  }

  async deleteArchive(archiveId) {
    if (!archiveId) {
      throw new Error("archiveId is required");
    }

    const archiveRef = this.db
      .collection(ARCHIVE_ROOT_COLLECTION)
      .doc(archiveId);
    const archiveDoc = await archiveRef.get();

    let deletedDocumentCount = 0;

    if (archiveDoc.exists) {
      const documentsSnapshot = await archiveRef
        .collection(ARCHIVE_DOCUMENTS_SUBCOLLECTION)
        .get();

      deletedDocumentCount = documentsSnapshot.size;

      if (!documentsSnapshot.empty) {
        const documentRefs = documentsSnapshot.docs.map((doc) => doc.ref);
        const batches = this.chunkDocuments(documentRefs, MAX_BATCH_SIZE);

        for (const batch of batches) {
          const writeBatch = this.db.batch();
          batch.forEach((docRef) => {
            writeBatch.delete(docRef);
          });
          await writeBatch.commit();
        }
      }

      await archiveRef.delete();
    } else {
      logger.warn("Archive record not found during deletion", { archiveId });
    }

    // Delete related archive job records (and logs)
    const jobSnapshot = await this.db
      .collection("archiveJobs")
      .where("archiveId", "==", archiveId)
      .get();

    const deletedJobs = [];

    if (!jobSnapshot.empty) {
      for (const jobDoc of jobSnapshot.docs) {
        await this.deleteJobDocument(jobDoc.ref);
        deletedJobs.push(jobDoc.id);
      }
    }

    logger.info(`Archive deleted: ${archiveId}`, {
      archiveId,
      documentCount: deletedDocumentCount,
      deletedJobs,
    });

    return {
      success: true,
      archiveId,
      deletedDocuments: deletedDocumentCount,
      deletedJobs,
      archiveMissing: !archiveDoc.exists,
    };
  }

  async deleteJobDocument(jobRef) {
    if (!jobRef) {
      return;
    }

    const logsSnapshot = await jobRef.collection("logs").get();

    if (!logsSnapshot.empty) {
      const logRefs = logsSnapshot.docs.map((doc) => doc.ref);
      const batches = this.chunkDocuments(logRefs, MAX_BATCH_SIZE);

      for (const batch of batches) {
        const writeBatch = this.db.batch();
        batch.forEach((logRef) => {
          writeBatch.delete(logRef);
        });
        await writeBatch.commit();
      }
    }

    await jobRef.delete();
  }

  generateArchiveDocumentId(collectionId, filters) {
    const parts = [collectionId];

    if (filters.intake) {
      parts.push(String(filters.intake).toLowerCase());
    }

    if (filters.year) {
      parts.push(String(filters.year));
    }

    return parts.join("-");
  }

  formatArchiveName(collectionLabel, filters) {
    const parts = [collectionLabel];

    if (filters.intake) {
      const intake = String(filters.intake);
      parts.push(
        intake.charAt(0).toUpperCase() + intake.slice(1).toLowerCase()
      );
    }

    if (filters.year) {
      parts.push(String(filters.year));
    }

    return parts.join(" - ");
  }

  sanitizeRequestedBy(requestedBy) {
    if (!requestedBy) {
      return null;
    }

    const { uid = null, email = null, name = null } = requestedBy;
    return { uid, email, name };
  }

  findFieldValue(data, paths = []) {
    for (const path of paths) {
      const value = this.getNestedValue(data, path);
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return null;
  }

  getNestedValue(obj, path) {
    if (!obj || !path) {
      return undefined;
    }

    const segments = path.split(".");
    let current = obj;

    for (const segment of segments) {
      if (current && Object.prototype.hasOwnProperty.call(current, segment)) {
        current = current[segment];
      } else {
        return undefined;
      }
    }

    return current;
  }

  matchesFilters(data, filters, collectionConfig) {
    const { year, intake } = filters;

    // If no filters specified, match all documents
    if (!year && !intake) {
      return true;
    }

    const yearValue = this.findFieldValue(data, collectionConfig.yearFields);
    const intakeValue = this.findFieldValue(
      data,
      collectionConfig.intakeFields
    );

    // If year filter is specified
    if (year) {
      // If document has no year field, include it (could be legacy data)
      if (!yearValue) {
        return true;
      }
      // If document has year field but doesn't match, exclude it
      if (String(yearValue) !== String(year)) {
        return false;
      }
    }

    // If intake filter is specified
    if (intake) {
      // If document has no intake field, include it (could be legacy data)
      if (!intakeValue) {
        return true;
      }
      // If document has intake field but doesn't match, exclude it
      if (String(intakeValue).toLowerCase() !== String(intake).toLowerCase()) {
        return false;
      }
    }

    return true;
  }

  chunkDocuments(documents, size) {
    const chunks = [];
    for (let i = 0; i < documents.length; i += size) {
      chunks.push(documents.slice(i, i + size));
    }
    return chunks;
  }

  async getJobLogs(jobId, { limit = 200 } = {}) {
    if (!jobId) {
      throw new Error("jobId is required to fetch logs");
    }

    const logsSnapshot = await this.db
      .collection("archiveJobs")
      .doc(jobId)
      .collection("logs")
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return logsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...this.serializeFirestoreData(doc.data()),
    }));
  }

  addFilterValuesFromDocument(data, collectionConfig, yearsSet, intakesSet) {
    if (!data) {
      return;
    }

    const yearValue = this.findFieldValue(data, collectionConfig.yearFields);
    const intakeValue = this.findFieldValue(
      data,
      collectionConfig.intakeFields
    );

    if (yearValue) {
      yearsSet.add(String(yearValue));
    }

    if (intakeValue) {
      intakesSet.add(String(intakeValue));
    }
  }

  sortYears(values) {
    if (!Array.isArray(values)) {
      return [];
    }

    const numeric = [];
    const text = [];

    values.forEach((value) => {
      const trimmed = String(value).trim();
      const parsed = Number.parseInt(trimmed, 10);
      if (!Number.isNaN(parsed) && trimmed.length === String(parsed).length) {
        numeric.push({ original: trimmed, numeric: parsed });
      } else {
        text.push(trimmed);
      }
    });

    numeric.sort((a, b) => a.numeric - b.numeric);
    text.sort((a, b) => a.localeCompare(b));

    return [...numeric.map((item) => item.original), ...text];
  }

  sortIntakes(values) {
    if (!Array.isArray(values)) {
      return [];
    }

    const orderIndex = (value) => {
      const normalized = String(value).trim().toLowerCase();
      const index = INTAKE_ORDER.indexOf(normalized);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };

    return values
      .map((value) => String(value).trim())
      .sort((a, b) => {
        const aIndex = orderIndex(a);
        const bIndex = orderIndex(b);

        if (aIndex === bIndex) {
          return a.localeCompare(b);
        }
        return aIndex - bIndex;
      });
  }

  serializeFirestoreData(value) {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.serializeFirestoreData(item));
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (value instanceof admin.firestore.Timestamp) {
      return value.toDate().toISOString();
    }

    if (value instanceof admin.firestore.GeoPoint) {
      return {
        latitude: value.latitude,
        longitude: value.longitude,
      };
    }

    if (value instanceof admin.firestore.DocumentReference) {
      return value.path;
    }

    if (typeof value === "object") {
      const result = {};
      for (const key of Object.keys(value)) {
        result[key] = this.serializeFirestoreData(value[key]);
      }
      return result;
    }

    return value;
  }

  decorateJob(id, data) {
    return {
      id,
      ...this.serializeFirestoreData(data),
    };
  }

  async exportArchive(archiveId, format = "csv") {
    const archiveRef = this.db
      .collection(ARCHIVE_ROOT_COLLECTION)
      .doc(archiveId);
    const archiveDoc = await archiveRef.get();

    if (!archiveDoc.exists) {
      throw new Error(`Archive not found: ${archiveId}`);
    }

    const archiveData = archiveDoc.data();
    const documentsSnapshot = await archiveRef
      .collection(ARCHIVE_DOCUMENTS_SUBCOLLECTION)
      .get();

    if (documentsSnapshot.empty) {
      throw new Error("No documents found in archive");
    }

    const documents = documentsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...this.serializeFirestoreData(doc.data()),
    }));

    // Get all unique keys from all documents, excluding metadata fields
    const allKeys = new Set();
    const excludedFields = ["_archivedBy", "_archivedFilters", "_archivedAt"];

    documents.forEach((doc) => {
      Object.keys(doc).forEach((key) => {
        if (!excludedFields.includes(key)) {
          allKeys.add(key);
        }
      });
    });

    const columns = Array.from(allKeys).sort();

    if (format === "csv") {
      return this.generateCSV(documents, columns, archiveId);
    } else {
      return this.generateExcel(documents, columns, archiveId, archiveData);
    }
  }

  generateCSV(documents, columns, archiveId) {
    // Create header row
    const rows = [columns.join(",")];

    // Create data rows - one row per document
    documents.forEach((doc) => {
      const row = columns.map((col) => {
        const value = doc[col];
        if (value === null || value === undefined) return "";

        const stringValue =
          typeof value === "object" ? JSON.stringify(value) : String(value);

        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (
          stringValue.includes(",") ||
          stringValue.includes('"') ||
          stringValue.includes("\n")
        ) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      });
      rows.push(row.join(","));
    });

    const csv = rows.join("\n");
    return {
      data: Buffer.from(csv, "utf8"),
      filename: `${archiveId}.csv`,
      contentType: "text/csv",
    };
  }

  generateExcel(documents, columns, archiveId, archiveMetadata) {
    const XLSX = require("xlsx");

    // Flatten nested objects for better column representation
    const flattenedDocuments = documents.map((doc) => {
      const flattened = {};
      columns.forEach((col) => {
        const value = doc[col];
        if (value === null || value === undefined) {
          flattened[col] = "";
        } else if (typeof value === "object" && !Array.isArray(value)) {
          flattened[col] = JSON.stringify(value);
        } else if (Array.isArray(value)) {
          flattened[col] = JSON.stringify(value);
        } else {
          flattened[col] = value;
        }
      });
      return flattened;
    });

    // Create worksheet from flattened data
    const worksheet = XLSX.utils.json_to_sheet(flattenedDocuments, {
      header: columns,
    });

    // Set column widths for better readability
    const columnWidths = columns.map((col) => {
      const maxLength = Math.max(
        col.length,
        ...flattenedDocuments.map((row) => {
          const val = String(row[col] || "");
          return val.length;
        })
      );
      return { wch: Math.min(maxLength + 2, 50) };
    });
    worksheet["!cols"] = columnWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Archive Data");

    // Add metadata sheet
    const metadataSheet = XLSX.utils.json_to_sheet([
      {
        Field: "Collection",
        Value: archiveMetadata.collectionLabel || archiveMetadata.collectionId,
      },
      {
        Field: "Year",
        Value: archiveMetadata.filters?.year || "All",
      },
      {
        Field: "Intake",
        Value: archiveMetadata.filters?.intake || "All",
      },
      {
        Field: "Document Count",
        Value: archiveMetadata.documentCount || documents.length,
      },
      {
        Field: "Created At",
        Value: archiveMetadata.createdAt
          ? new Date(archiveMetadata.createdAt._seconds * 1000).toISOString()
          : "Unknown",
      },
    ]);
    XLSX.utils.book_append_sheet(workbook, metadataSheet, "Metadata");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return {
      data: buffer,
      filename: `${archiveId}.xlsx`,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
}

module.exports = ArchiveJobService;
