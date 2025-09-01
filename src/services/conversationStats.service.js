const admin = require("firebase-admin");
const redisCache = require("./redisCache.service");

/**
 * Conversation Statistics Service
 * Analyzes conversation data and provides detailed statistics by status
 * Updated to match actual database structure
 */
class ConversationStatsService {
  constructor() {
    this.db = admin.firestore();
    this.CACHE_TTL = parseInt(process.env.CACHE_TTL_ANALYTICS) || 600; // 10 minutes
    this.CACHE_KEY = "conversation_stats";
  }

  /**
   * Get comprehensive conversation statistics based on actual database structure
   * @returns {Object} Statistics object with counts by status, lead status, and totals
   */
  async getConversationStatistics() {
    try {
      console.log("📊 Starting conversation statistics analysis...");

      // Get all conversations from Firestore
      const conversationsSnapshot = await this.db
        .collection("conversations")
        .get();

      const stats = {
        total: 0,
        // Based on discovered data - only 'active' status exists
        byConversationStatus: {
          active: 0,
        },
        // Based on discovered lead statuses in your database
        byLeadStatus: {
          INTERESTED: 0,
          APPLIED: 0,
          QUALIFIED: 0,
          ADMITTED: 0,
          ENROLLED: 0,
        },
        withMessages: 0,
        withoutMessages: 0,
        recentActivity: {
          last24h: 0,
          last7days: 0,
          last30days: 0,
        },
        totalMessages: 0,
        averageMessagesPerConversation: 0,
        dailyActivity: [],
        lastUpdated: new Date().toISOString(),
      };

      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last7days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const last30days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      let totalMessages = 0;
      let conversationsWithMessages = 0;
      const dailyActivity = {};

      // Process each conversation
      conversationsSnapshot.forEach((doc) => {
        const conversationData = doc.data();
        stats.total++;

        // Conversation status (all are 'active' based on discovery)
        const conversationStatus = conversationData.status || "active";
        if (stats.byConversationStatus.hasOwnProperty(conversationStatus)) {
          stats.byConversationStatus[conversationStatus]++;
        }

        // Lead status analysis (using leadStatus field directly from conversation)
        const leadStatus = conversationData.leadStatus;
        if (leadStatus && stats.byLeadStatus.hasOwnProperty(leadStatus)) {
          stats.byLeadStatus[leadStatus]++;
        }

        // Message count analysis (using messageCount field)
        const messageCount = conversationData.messageCount || 0;
        if (messageCount > 0) {
          stats.withMessages++;
          conversationsWithMessages++;
          totalMessages += messageCount;
        } else {
          stats.withoutMessages++;
        }

        // Recent activity analysis
        const createdAt = conversationData.createdAt;
        if (createdAt) {
          const createdDate = createdAt.toDate
            ? createdAt.toDate()
            : new Date(createdAt);

          if (createdDate > last24h) {
            stats.recentActivity.last24h++;
          }
          if (createdDate > last7days) {
            stats.recentActivity.last7days++;
          }
          if (createdDate > last30days) {
            stats.recentActivity.last30days++;
          }

          // Build daily activity for charts
          const dateKey = createdDate.toISOString().split("T")[0];
          dailyActivity[dateKey] = (dailyActivity[dateKey] || 0) + 1;
        }
      });

      // Calculate averages
      stats.totalMessages = totalMessages;
      stats.averageMessagesPerConversation =
        conversationsWithMessages > 0
          ? Math.round((totalMessages / conversationsWithMessages) * 100) / 100
          : 0;

      // Convert daily activity to sorted array (last 30 days only)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      stats.dailyActivity = Object.entries(dailyActivity)
        .filter(([date]) => new Date(date) >= thirtyDaysAgo)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      console.log("✅ Conversation statistics analysis completed");
      console.log(`📈 Total conversations: ${stats.total}`);
      console.log(`💬 Total messages: ${totalMessages}`);
      console.log(`📊 Conversations with messages: ${stats.withMessages}`);

      return stats;
    } catch (error) {
      console.error("❌ Error analyzing conversation statistics:", error);
      throw error;
    }
  }

  /**
   * Get simplified conversation counts for dashboard
   * @returns {Object} Simplified stats for dashboard display
   */
  async getConversationCounts() {
    try {
      const fullStats = await this.getConversationStatistics();

      return {
        total: fullStats.total,
        active: fullStats.byConversationStatus.active || 0,
        withMessages: fullStats.withMessages,
        withoutMessages: fullStats.withoutMessages,
        recent24h: fullStats.recentActivity.last24h,
        recent7days: fullStats.recentActivity.last7days,
        recent30days: fullStats.recentActivity.last30days,
        byLeadStatus: fullStats.byLeadStatus,
        lastUpdated: fullStats.lastUpdated,
      };
    } catch (error) {
      console.error("❌ Error getting conversation counts:", error);
      throw error;
    }
  }

  /**
   * Get conversion rate statistics
   */
  async getConversionRates() {
    try {
      const stats = await this.getConversationStatistics();
      const leadStats = stats.byLeadStatus;

      const interested = leadStats.INTERESTED || 0;
      const applied = leadStats.APPLIED || 0;
      const qualified = leadStats.QUALIFIED || 0;
      const admitted = leadStats.ADMITTED || 0;
      const enrolled = leadStats.ENROLLED || 0;

      return {
        interestedToApplied:
          interested > 0 ? Math.round((applied / interested) * 10000) / 100 : 0,
        appliedToQualified:
          applied > 0 ? Math.round((qualified / applied) * 10000) / 100 : 0,
        qualifiedToAdmitted:
          qualified > 0 ? Math.round((admitted / qualified) * 10000) / 100 : 0,
        admittedToEnrolled:
          admitted > 0 ? Math.round((enrolled / admitted) * 10000) / 100 : 0,
        overallConversion:
          interested > 0
            ? Math.round((enrolled / interested) * 10000) / 100
            : 0,
        totalInterested: interested,
        totalApplied: applied,
        totalQualified: qualified,
        totalAdmitted: admitted,
        totalEnrolled: enrolled,
      };
    } catch (error) {
      console.error("❌ Error calculating conversion rates:", error);
      throw error;
    }
  }

  /**
   * Get dashboard summary for super admin
   */
  async getDashboardSummary() {
    try {
      console.log("📊 Generating dashboard summary...");

      const [basicStats, conversionRates] = await Promise.all([
        this.getCachedConversationStats(),
        this.getConversionRates(),
      ]);

      const summary = {
        overview: {
          totalConversations: basicStats.total,
          activeConversations: basicStats.byConversationStatus.active || 0,
          conversationsWithMessages: basicStats.withMessages,
          conversationsWithoutMessages: basicStats.withoutMessages,
          averageMessagesPerConversation:
            basicStats.averageMessagesPerConversation || 0,
          totalMessages: basicStats.totalMessages || 0,
        },
        leadStatuses: basicStats.byLeadStatus,
        recentActivity: {
          last24Hours: basicStats.recentActivity.last24h,
          last7Days: basicStats.recentActivity.last7days,
          last30Days: basicStats.recentActivity.last30days,
        },
        conversionRates,
        dailyActivity: basicStats.dailyActivity || [],
        lastUpdated: new Date().toISOString(),
      };

      console.log("✅ Dashboard summary generated");
      return summary;
    } catch (error) {
      console.error("❌ Error generating dashboard summary:", error);
      throw error;
    }
  }

  /**
   * Get conversation statistics with caching
   * @param {boolean} forceRefresh - Force refresh from database
   * @returns {Object} Cached or fresh statistics
   */
  async getCachedConversationStats(forceRefresh = false) {
    try {
      // Try to get from cache first
      if (!forceRefresh) {
        const cachedStats = await redisCache.get(this.CACHE_KEY);

        if (cachedStats) {
          console.log("⚡ Retrieved conversation stats from cache");
          return cachedStats;
        }
      }

      // Get fresh stats
      console.log("🔄 Cache miss - fetching fresh conversation stats");
      const stats = await this.getConversationStatistics();

      // Cache the results
      await redisCache.set(this.CACHE_KEY, stats, this.CACHE_TTL);
      console.log(
        `💾 Cached conversation statistics for ${this.CACHE_TTL} seconds`
      );

      return stats;
    } catch (error) {
      console.error("❌ Error getting cached conversation stats:", error);
      throw error;
    }
  }

  /**
   * Invalidate conversation stats cache
   */
  async invalidateCache() {
    try {
      await redisCache.del(this.CACHE_KEY);
      console.log("🗑️ Conversation stats cache invalidated");
    } catch (error) {
      console.error("❌ Error invalidating cache:", error);
    }
  }
}

module.exports = new ConversationStatsService();
