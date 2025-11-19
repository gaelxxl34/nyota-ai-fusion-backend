/**
 * Suzy Sheets Service
 * Handles admitted leads with Redis caching for optimal performance
 */

const admin = require("firebase-admin");
const redisCache = require("./redisCache.service");

class SuzySheetsService {
  constructor() {
    this.db = admin.firestore();
    this.leadsCollection = "leads";
    this.cache = redisCache;
    this.targetStatuses = ["ADMITTED", "ENROLLED", "DEFERRED", "EXPIRED"];

    // Cache configuration
    this.CACHE_KEYS = {
      ADMITTED_LEADS: "suzy:admitted_leads",
      LEAD_DETAIL: "suzy:lead:",
    };

    this.CACHE_TTL = {
      ADMITTED_LEADS: 600, // 10 minutes for the full list
      LEAD_DETAIL: 1800, // 30 minutes for individual leads
    };
  }

  /**
   * Get all admitted leads with smart caching
   */
  async getAdmittedLeads() {
    try {
      // Check cache first
      const cachedLeads = await this.cache.get(this.CACHE_KEYS.ADMITTED_LEADS);
      if (cachedLeads) {
        console.log("✅ Returning admitted leads from Redis cache");
        return {
          success: true,
          data: cachedLeads,
          cached: true,
        };
      }

      console.log("📡 Fetching admitted leads from Firestore...");

      const leadDocs = await this._fetchLeadsByStatuses(this.targetStatuses);

      const leads = await Promise.all(
        leadDocs.map(async (doc) => {
          const data = doc.data();
          const applicationInfo = await this._getLatestApplicationForLead(
            doc.id
          );

          return {
            id: doc.id,
            name: this._resolveDisplayName(data, applicationInfo),
            regNo: this._resolveRegistrationNumber(data, applicationInfo),
            email: data.email,
            phone: data.phone,
            program: this._normalizeProgramField(
              data.interestedProgram ||
                data.program ||
                applicationInfo?.preferredProgram ||
                applicationInfo?.program ||
                null
            ),
            status: data.status,
            paymentStatus: data.paymentStatus || "PENDING",
            lastTouch: this._formatLastTouch(
              data.lastInteractionAt || data.updatedAt
            ),
            lastTouchDays: this._calculateDaysSince(
              data.lastInteractionAt || data.updatedAt
            ),
            notes: data.suzyNotes || data.notes || "",
            owner: data.assignedTo || "Suzy",
            createdAt: this._convertTimestamp(data.createdAt),
            updatedAt: this._convertTimestamp(data.updatedAt),
            lastInteractionAt: this._convertTimestamp(data.lastInteractionAt),
            application: applicationInfo,
            source: this._resolveSource(data, applicationInfo),
            modeOfStudy: this._resolveModeOfStudy(data, applicationInfo),
          };
        })
      );

      leads.sort((a, b) => (a.lastTouchDays || 0) - (b.lastTouchDays || 0));

      await this.cache.set(
        this.CACHE_KEYS.ADMITTED_LEADS,
        leads,
        this.CACHE_TTL.ADMITTED_LEADS
      );

      console.log(`✅ Fetched and cached ${leads.length} admitted leads`);

      return {
        success: true,
        data: leads,
        cached: false,
      };
    } catch (error) {
      console.error("❌ Error fetching admitted leads:", error);
      throw error;
    }
  }

  async _fetchLeadsByStatuses(statuses = []) {
    if (!statuses || statuses.length === 0) {
      return [];
    }

    const chunkSize = 10; // Firestore 'in' queries support up to 10 values
    const allDocs = [];

    for (let i = 0; i < statuses.length; i += chunkSize) {
      const chunk = statuses.slice(i, i + chunkSize);
      const snapshot = await this.db
        .collection(this.leadsCollection)
        .where("status", "in", chunk)
        .get();

      allDocs.push(...snapshot.docs);
    }

    // Deduplicate documents in case a lead matches multiple chunks
    const uniqueDocsMap = new Map();
    allDocs.forEach((doc) => {
      if (!uniqueDocsMap.has(doc.id)) {
        uniqueDocsMap.set(doc.id, doc);
      }
    });

    return Array.from(uniqueDocsMap.values());
  }

  /**
   * Update lead status (ENROLLED, DEFERRED, EXPIRED)
   */
  async updateLeadStatus(leadId, newStatus, userId) {
    try {
      const leadRef = this.db.collection(this.leadsCollection).doc(leadId);
      const leadDoc = await leadRef.get();

      if (!leadDoc.exists) {
        throw new Error("Lead not found");
      }

      const currentData = leadDoc.data();
      const now = admin.firestore.FieldValue.serverTimestamp();

      // Build timeline entry
      const timelineEntry = {
        status: newStatus,
        date: now,
        updatedBy: userId,
        note: `Status updated to ${newStatus} via Suzy Sheets`,
      };

      // Update the lead
      await leadRef.update({
        status: newStatus,
        timeline: admin.firestore.FieldValue.arrayUnion(timelineEntry),
        updatedAt: now,
        lastInteractionAt: now,
      });

      // Invalidate caches
      await this._invalidateLeadCaches(leadId);

      console.log(`✅ Updated lead ${leadId} to status ${newStatus}`);

      return {
        success: true,
        message: `Lead status updated to ${newStatus}`,
        leadId,
        newStatus,
      };
    } catch (error) {
      console.error(`❌ Error updating lead status:`, error);
      throw error;
    }
  }

  /**
   * Update Suzy's notes for a lead
   */
  async updateLeadNotes(leadId, notes, userId) {
    try {
      const leadRef = this.db.collection(this.leadsCollection).doc(leadId);
      const leadDoc = await leadRef.get();

      if (!leadDoc.exists) {
        throw new Error("Lead not found");
      }

      const now = admin.firestore.FieldValue.serverTimestamp();

      // Update notes and last interaction time
      await leadRef.update({
        suzyNotes: notes,
        notes: notes, // Also update general notes field
        updatedAt: now,
        lastInteractionAt: now,
      });

      // Invalidate caches
      await this._invalidateLeadCaches(leadId);

      console.log(`✅ Updated notes for lead ${leadId}`);

      return {
        success: true,
        message: "Notes updated successfully",
        leadId,
      };
    } catch (error) {
      console.error(`❌ Error updating lead notes:`, error);
      throw error;
    }
  }

  /**
   * Get a single lead detail with caching
   */
  async getLeadDetail(leadId) {
    try {
      // Check cache first
      const cacheKey = this.CACHE_KEYS.LEAD_DETAIL + leadId;
      const cachedLead = await this.cache.get(cacheKey);
      if (cachedLead) {
        console.log(`✅ Returning lead ${leadId} from Redis cache`);
        return {
          success: true,
          data: cachedLead,
          cached: true,
        };
      }

      console.log(`📡 Fetching lead ${leadId} from Firestore...`);

      // Fetch from Firestore
      const leadDoc = await this.db
        .collection(this.leadsCollection)
        .doc(leadId)
        .get();

      if (!leadDoc.exists) {
        throw new Error("Lead not found");
      }

      const data = leadDoc.data();
      const leadDetail = {
        id: leadDoc.id,
        name: `${data.firstName || ""} ${data.lastName || ""}`.trim(),
        regNo: data.regNo || leadDoc.id,
        email: data.email,
        phone: data.phone,
        program: data.interestedProgram || data.program || "N/A",
        status: data.status,
        paymentStatus: data.paymentStatus || "PENDING",
        lastTouch: this._formatLastTouch(
          data.lastInteractionAt || data.updatedAt
        ),
        lastTouchDays: this._calculateDaysSince(
          data.lastInteractionAt || data.updatedAt
        ),
        notes: data.suzyNotes || data.notes || "",
        owner: data.assignedTo || "Suzy",
        timeline: data.timeline || [],
        createdAt: this._convertTimestamp(data.createdAt),
        updatedAt: this._convertTimestamp(data.updatedAt),
        lastInteractionAt: this._convertTimestamp(data.lastInteractionAt),
      };

      // Cache the result
      await this.cache.set(cacheKey, leadDetail, this.CACHE_TTL.LEAD_DETAIL);

      console.log(`✅ Fetched and cached lead ${leadId}`);

      return {
        success: true,
        data: leadDetail,
        cached: false,
      };
    } catch (error) {
      console.error(`❌ Error fetching lead detail:`, error);
      throw error;
    }
  }

  /**
   * Invalidate all caches related to a lead
   */
  async _invalidateLeadCaches(leadId) {
    try {
      // Invalidate the admitted leads list
      await this.cache.del(this.CACHE_KEYS.ADMITTED_LEADS);

      // Invalidate the specific lead detail
      const leadCacheKey = this.CACHE_KEYS.LEAD_DETAIL + leadId;
      await this.cache.del(leadCacheKey);

      console.log(`🗑️ Invalidated caches for lead ${leadId}`);
    } catch (error) {
      console.error("❌ Error invalidating caches:", error);
    }
  }

  /**
   * Force refresh the admitted leads cache
   */
  async refreshAdmittedLeadsCache() {
    try {
      // Delete the cache
      await this.cache.del(this.CACHE_KEYS.ADMITTED_LEADS);
      console.log("🗑️ Cleared admitted leads cache");

      // Fetch fresh data (which will re-cache)
      const result = await this.getAdmittedLeads();
      console.log("✅ Refreshed admitted leads cache");

      return result;
    } catch (error) {
      console.error("❌ Error refreshing cache:", error);
      throw error;
    }
  }

  _normalizeProgramField(program) {
    if (!program) return "N/A";

    if (typeof program === "string") {
      return program;
    }

    if (Array.isArray(program)) {
      const parts = program
        .map((item) => this._normalizeProgramField(item))
        .filter((value) => typeof value === "string" && value.trim().length);
      return parts.length ? parts.join(", ") : "N/A";
    }

    if (typeof program === "object") {
      const name =
        program.name || program.displayName || program.label || program.full;
      const code = program.code || program.id || program.value;

      if (name && code) {
        return `${name} (${code})`;
      }

      return name || code || "N/A";
    }

    return String(program);
  }

  _resolveDisplayName(leadData = {}, applicationInfo = null) {
    const leadCombined = this._combineName(
      leadData.firstName || leadData.first_name || leadData.givenName,
      leadData.lastName || leadData.last_name || leadData.familyName
    );
    if (leadCombined) return leadCombined;

    if (typeof leadData.name === "string" && leadData.name.trim()) {
      return leadData.name.trim();
    }

    if (leadData.name && typeof leadData.name === "object") {
      const nameCombined = this._combineName(
        leadData.name.first ||
          leadData.name.firstName ||
          leadData.name.given ||
          leadData.name.givenName,
        leadData.name.last ||
          leadData.name.lastName ||
          leadData.name.family ||
          leadData.name.familyName
      );
      if (nameCombined) return nameCombined;

      const fallbackName = leadData.name.full || leadData.name.display;
      if (typeof fallbackName === "string" && fallbackName.trim()) {
        return fallbackName.trim();
      }
    }

    if (leadData.profile && typeof leadData.profile === "object") {
      const profileCombined = this._combineName(
        leadData.profile.firstName || leadData.profile.givenName,
        leadData.profile.lastName || leadData.profile.familyName
      );
      if (profileCombined) return profileCombined;
    }

    if (applicationInfo) {
      const appCombined = this._combineName(
        applicationInfo.firstName ||
          applicationInfo.first_name ||
          applicationInfo.givenName,
        applicationInfo.lastName ||
          applicationInfo.last_name ||
          applicationInfo.familyName
      );
      if (appCombined) return appCombined;

      if (
        applicationInfo.applicant &&
        typeof applicationInfo.applicant === "object"
      ) {
        const applicantCombined = this._combineName(
          applicationInfo.applicant.firstName ||
            applicationInfo.applicant.givenName,
          applicationInfo.applicant.lastName ||
            applicationInfo.applicant.familyName
        );
        if (applicantCombined) return applicantCombined;
      }

      if (
        typeof applicationInfo.name === "string" &&
        applicationInfo.name.trim()
      ) {
        return applicationInfo.name.trim();
      }

      if (applicationInfo.name && typeof applicationInfo.name === "object") {
        const appNameCombined = this._combineName(
          applicationInfo.name.first || applicationInfo.name.givenName,
          applicationInfo.name.last || applicationInfo.name.familyName
        );
        if (appNameCombined) return appNameCombined;

        const fallbackName =
          applicationInfo.name.full || applicationInfo.name.display;
        if (typeof fallbackName === "string" && fallbackName.trim()) {
          return fallbackName.trim();
        }
      }
    }

    return "Unknown Student";
  }

  _resolveRegistrationNumber(leadData = {}, applicationInfo = null) {
    const candidates = [];
    const addCandidate = (value) => {
      if (typeof value === "string" && value.trim()) {
        candidates.push(value.trim());
      }
    };

    addCandidate(leadData.registrationNumber);
    addCandidate(leadData.regNumber);
    addCandidate(leadData.regNo);

    if (applicationInfo) {
      addCandidate(applicationInfo.registrationNumber);
      addCandidate(applicationInfo.registration_number);
      addCandidate(applicationInfo.regNo);
      addCandidate(applicationInfo.regNumber);
      addCandidate(applicationInfo.studentRegNo);

      if (
        applicationInfo.student &&
        typeof applicationInfo.student === "object"
      ) {
        addCandidate(applicationInfo.student.registrationNumber);
        addCandidate(applicationInfo.student.regNo);
      }

      if (applicationInfo.raw && typeof applicationInfo.raw === "object") {
        addCandidate(applicationInfo.raw.registrationNumber);
        addCandidate(applicationInfo.raw.regNo);
        addCandidate(applicationInfo.raw.registration_number);
      }
    }

    if (candidates.length > 0) {
      return candidates[0];
    }

    return "N/A";
  }

  _combineName(first, last) {
    const firstPart = typeof first === "string" ? first.trim() : "";
    const lastPart = typeof last === "string" ? last.trim() : "";

    const combined = `${firstPart} ${lastPart}`.trim();
    return combined.length ? combined : null;
  }

  _resolveSource(leadData = {}, applicationInfo = null) {
    const candidate =
      this._pickFirstString([
        leadData.source,
        leadData.leadSource,
        leadData.sourceName,
        leadData.sourceType,
        leadData.tracking?.source,
        leadData.tracking?.utmSource,
        leadData.metadata?.source,
        applicationInfo?.source,
        applicationInfo?.raw?.source,
        applicationInfo?.raw?.leadSource,
        applicationInfo?.raw?.metadata?.source,
      ]) || "UNKNOWN";

    return candidate;
  }

  _resolveModeOfStudy(leadData = {}, applicationInfo = null) {
    const candidate = this._pickFirstString([
      leadData.modeOfStudy,
      leadData.studyMode,
      leadData.preferredStudyMode,
      leadData.programMode,
      leadData.study_mode,
      applicationInfo?.modeOfStudy,
      applicationInfo?.raw?.modeOfStudy,
      applicationInfo?.raw?.studyMode,
    ]);

    if (!candidate) {
      return null;
    }

    const value = candidate.toLowerCase();
    if (value.includes("campus")) {
      return "On Campus";
    }
    if (value.includes("online")) {
      return "Online";
    }
    return candidate;
  }

  _pickFirstString(values = []) {
    for (const value of values) {
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  }

  async _getLatestApplicationForLead(leadId) {
    try {
      const snapshot = await this.db
        .collection("applications")
        .where("leadId", "==", leadId)
        .get();

      if (snapshot.empty) {
        return null;
      }

      let selected = null;

      snapshot.forEach((doc) => {
        const data = doc.data();
        const updatedAt = this._convertTimestamp(data.updatedAt);
        const submittedAt = this._convertTimestamp(data.submittedAt);
        const candidateTimestamp = updatedAt || submittedAt || null;

        if (
          !selected ||
          (candidateTimestamp &&
            (!selected.timestamp || candidateTimestamp > selected.timestamp))
        ) {
          selected = {
            id: doc.id,
            data,
            timestamp: candidateTimestamp,
          };
        }
      });

      if (!selected) {
        return null;
      }

      const data = selected.data;

      return {
        id: selected.id,
        registrationNumber:
          data.registrationNumber ||
          data.registration_number ||
          data.regNo ||
          data.regNumber ||
          null,
        preferredProgram: data.preferredProgram || null,
        program: data.program || null,
        name: data.name || null,
        firstName:
          data.firstName ||
          data.first_name ||
          data.givenName ||
          (data.applicant && data.applicant.firstName) ||
          null,
        lastName:
          data.lastName ||
          data.last_name ||
          data.familyName ||
          (data.applicant && data.applicant.lastName) ||
          null,
        student: data.student || null,
        modeOfStudy:
          data.modeOfStudy || data.studyMode || data.study_mode || null,
        source:
          data.source ||
          data.leadSource ||
          data.applicationSource ||
          (data.metadata && data.metadata.source) ||
          null,
        submittedAt: this._convertTimestamp(data.submittedAt),
        updatedAt: this._convertTimestamp(data.updatedAt),
        raw: data,
      };
    } catch (error) {
      console.warn(
        `⚠️ Unable to fetch latest application for lead ${leadId}:`,
        error.message
      );
      return null;
    }
  }

  /**
   * Helper: Format last touch date to human-readable format
   */
  _formatLastTouch(timestamp) {
    if (!timestamp) return "Never";

    const date = this._convertTimestamp(timestamp);
    if (!date) return "Never";

    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
    } else if (diffDays === 0) {
      return "Today";
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks !== 1 ? "s" : ""} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  /**
   * Helper: Calculate days since timestamp
   */
  _calculateDaysSince(timestamp) {
    if (!timestamp) return 9999; // Large number for sorting

    const date = this._convertTimestamp(timestamp);
    if (!date) return 9999;

    const now = new Date();
    const diffMs = now - date;
    return diffMs / (1000 * 60 * 60 * 24); // Return fractional days for precise sorting
  }

  /**
   * Helper: Convert Firestore timestamp to JavaScript Date
   */
  _convertTimestamp(timestamp) {
    if (!timestamp) return null;

    try {
      // Firestore Timestamp
      if (timestamp._seconds !== undefined) {
        return new Date(timestamp._seconds * 1000);
      }
      if (timestamp.seconds !== undefined) {
        return new Date(timestamp.seconds * 1000);
      }
      // Already a Date
      if (timestamp instanceof Date) {
        return timestamp;
      }
      // String
      if (typeof timestamp === "string") {
        return new Date(timestamp);
      }
      // Number (unix timestamp)
      if (typeof timestamp === "number") {
        return timestamp > 1000000000000
          ? new Date(timestamp)
          : new Date(timestamp * 1000);
      }

      return null;
    } catch (error) {
      console.error("❌ Error converting timestamp:", error);
      return null;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    try {
      const admittedLeadsExists = await this.cache.exists(
        this.CACHE_KEYS.ADMITTED_LEADS
      );

      return {
        admittedLeadsCached: admittedLeadsExists,
        cacheKeys: this.CACHE_KEYS,
        cacheTTL: this.CACHE_TTL,
      };
    } catch (error) {
      console.error("❌ Error getting cache stats:", error);
      return { error: error.message };
    }
  }
}

module.exports = new SuzySheetsService();
