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

      // Fetch from Firestore
      const snapshot = await this.db
        .collection(this.leadsCollection)
        .where("status", "==", "ADMITTED")
        .get();

      const leads = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        leads.push({
          id: doc.id,
          name: `${data.firstName || ""} ${data.lastName || ""}`.trim(),
          regNo: data.regNo || doc.id,
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
          createdAt: this._convertTimestamp(data.createdAt),
          updatedAt: this._convertTimestamp(data.updatedAt),
          lastInteractionAt: this._convertTimestamp(data.lastInteractionAt),
        });
      });

      // Sort by most recent contact first
      leads.sort((a, b) => a.lastTouchDays - b.lastTouchDays);

      // Cache the results
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
