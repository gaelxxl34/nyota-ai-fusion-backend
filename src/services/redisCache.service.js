const Redis = require("ioredis");

class RedisCacheService {
  constructor() {
    this.redis = null;
    this.isConnected = false;
    this.retryAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 1000; // 1 second

    // Cache TTLs (Time To Live) in seconds
    this.TTL = {
      CONVERSATIONS: 3600, // 1 hour
      CONVERSATION_MESSAGES: 1800, // 30 minutes
      LEAD_DATA: 7200, // 2 hours
      KNOWLEDGE_BASE: 86400, // 24 hours
      AI_RESPONSES: 3600, // 1 hour
      USER_SESSIONS: 1800, // 30 minutes
      ANALYTICS: 600, // 10 minutes
      CONVERSATION_LIST: 300, // 5 minutes (shorter for frequent updates)
      FACEBOOK_FORMS: 1800, // 30 minutes - Facebook forms don't change often
      FACEBOOK_PAGES: 3600, // 1 hour - Pages change even less frequently
      FACEBOOK_LEADS: 300, // 5 minutes - Fresh leads data
      FACEBOOK_CAMPAIGNS: 1800, // 30 minutes - Campaigns are relatively static
      FACEBOOK_STATS: 600, // 10 minutes - Stats can be cached longer
    };

    // Cache keys prefixes
    this.KEYS = {
      CONVERSATION: "conv:",
      CONVERSATION_MESSAGES: "conv_msg:",
      CONVERSATION_LIST: "conv_list:",
      LEAD_DATA: "lead:",
      LEAD_NAME: "lead_name:",
      KNOWLEDGE_BASE: "kb:",
      AI_RESPONSE: "ai_resp:",
      USER_SESSION: "session:",
      ANALYTICS: "analytics:",
      SYNC_TIMESTAMP: "sync:",
      FACEBOOK_FORMS: "fb_forms:",
      FACEBOOK_PAGES: "fb_pages:",
      FACEBOOK_LEADS: "fb_leads:",
      FACEBOOK_CAMPAIGNS: "fb_campaigns:",
      FACEBOOK_STATS: "fb_stats:",
    };

    this.initializeRedis();
  }

  async initializeRedis() {
    try {
      // Redis configuration with fallback options
      const redisConfig = {
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: process.env.REDIS_DB || 0,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keepAlive: 30000,
        connectTimeout: 10000,
        commandTimeout: 5000,
      };

      this.redis = new Redis(redisConfig);

      // Event handlers
      this.redis.on("connect", () => {
        console.log("🔗 Redis connected successfully");
        this.isConnected = true;
        this.retryAttempts = 0;
      });

      this.redis.on("ready", () => {
        console.log("✅ Redis is ready for operations");
      });

      this.redis.on("error", (error) => {
        console.error("❌ Redis connection error:", error.message);
        this.isConnected = false;
        this.handleConnectionError();
      });

      this.redis.on("close", () => {
        console.log("📪 Redis connection closed");
        this.isConnected = false;
      });

      this.redis.on("reconnecting", () => {
        console.log("🔄 Redis reconnecting...");
      });

      // Test connection
      await this.redis.connect();
      await this.redis.ping();
      console.log("🚀 Redis cache service initialized successfully");
    } catch (error) {
      console.warn("⚠️ Redis initialization failed:", error.message);
      console.log("📋 Falling back to in-memory caching");
      this.initializeFallbackCache();
    }
  }

  initializeFallbackCache() {
    // Fallback in-memory cache for when Redis is not available
    this.fallbackCache = new Map();
    this.fallbackTTL = new Map();

    // Cleanup expired entries every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, expiry] of this.fallbackTTL.entries()) {
        if (now > expiry) {
          this.fallbackCache.delete(key);
          this.fallbackTTL.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }

  async handleConnectionError() {
    if (this.retryAttempts < this.maxRetries) {
      this.retryAttempts++;
      console.log(
        `🔄 Retrying Redis connection (${this.retryAttempts}/${this.maxRetries}) in ${this.retryDelay}ms...`
      );

      setTimeout(() => {
        this.initializeRedis();
      }, this.retryDelay * this.retryAttempts);
    } else {
      console.warn(
        "🚨 Max Redis retry attempts reached. Using fallback cache."
      );
      this.initializeFallbackCache();
    }
  }

  // Generic cache operations
  async set(key, value, ttl = null) {
    try {
      if (this.isConnected && this.redis) {
        const serializedValue = JSON.stringify(value);
        if (ttl) {
          await this.redis.setex(key, ttl, serializedValue);
        } else {
          await this.redis.set(key, serializedValue);
        }
        return true;
      } else {
        // Fallback cache
        this.fallbackCache.set(key, value);
        if (ttl) {
          this.fallbackTTL.set(key, Date.now() + ttl * 1000);
        }
        return true;
      }
    } catch (error) {
      console.error("❌ Redis SET error:", error.message);
      return false;
    }
  }

  async get(key) {
    try {
      if (this.isConnected && this.redis) {
        const value = await this.redis.get(key);
        return value ? JSON.parse(value) : null;
      } else {
        // Fallback cache
        const now = Date.now();
        const expiry = this.fallbackTTL.get(key);
        if (expiry && now > expiry) {
          this.fallbackCache.delete(key);
          this.fallbackTTL.delete(key);
          return null;
        }
        return this.fallbackCache.get(key) || null;
      }
    } catch (error) {
      console.error("❌ Redis GET error:", error.message);
      return null;
    }
  }

  async del(key) {
    try {
      if (this.isConnected && this.redis) {
        await this.redis.del(key);
      } else {
        this.fallbackCache.delete(key);
        this.fallbackTTL.delete(key);
      }
      return true;
    } catch (error) {
      console.error("❌ Redis DEL error:", error.message);
      return false;
    }
  }

  async exists(key) {
    try {
      if (this.isConnected && this.redis) {
        return await this.redis.exists(key);
      } else {
        const now = Date.now();
        const expiry = this.fallbackTTL.get(key);
        if (expiry && now > expiry) {
          this.fallbackCache.delete(key);
          this.fallbackTTL.delete(key);
          return false;
        }
        return this.fallbackCache.has(key);
      }
    } catch (error) {
      console.error("❌ Redis EXISTS error:", error.message);
      return false;
    }
  }

  async keys(pattern) {
    try {
      if (this.isConnected && this.redis) {
        return await this.redis.keys(pattern);
      } else {
        // Fallback: filter keys based on pattern
        const regex = new RegExp(pattern.replace("*", ".*"));
        return Array.from(this.fallbackCache.keys()).filter((key) =>
          regex.test(key)
        );
      }
    } catch (error) {
      console.error("❌ Redis KEYS error:", error.message);
      return [];
    }
  }

  // Conversation-specific cache methods
  async cacheConversation(conversationId, conversationData) {
    const key = this.KEYS.CONVERSATION + conversationId;
    const success = await this.set(
      key,
      conversationData,
      this.TTL.CONVERSATIONS
    );

    if (success) {
      console.log(`💾 Cached conversation: ${conversationId}`);

      // Also update the sync timestamp
      await this.updateSyncTimestamp("conversations");
    }

    return success;
  }

  async getCachedConversation(conversationId) {
    const key = this.KEYS.CONVERSATION + conversationId;
    const conversation = await this.get(key);

    if (conversation) {
      console.log(`⚡ Retrieved conversation from cache: ${conversationId}`);
    }

    return conversation;
  }

  async cacheConversationMessages(conversationId, messages) {
    const key = this.KEYS.CONVERSATION_MESSAGES + conversationId;
    const success = await this.set(
      key,
      messages,
      this.TTL.CONVERSATION_MESSAGES
    );

    if (success) {
      console.log(
        `💾 Cached ${messages.length} messages for conversation: ${conversationId}`
      );
    }

    return success;
  }

  async getCachedConversationMessages(conversationId) {
    const key = this.KEYS.CONVERSATION_MESSAGES + conversationId;
    const messages = await this.get(key);

    if (messages) {
      console.log(
        `⚡ Retrieved ${messages.length} messages from cache for conversation: ${conversationId}`
      );
    }

    return messages;
  }

  async cacheConversationList(listKey, conversations) {
    const key = this.KEYS.CONVERSATION_LIST + listKey;
    const success = await this.set(
      key,
      conversations,
      this.TTL.CONVERSATION_LIST
    );

    if (success) {
      console.log(
        `💾 Cached conversation list (${listKey}): ${conversations.length} conversations`
      );
    }

    return success;
  }

  async getCachedConversationList(listKey) {
    const key = this.KEYS.CONVERSATION_LIST + listKey;
    const conversations = await this.get(key);

    if (conversations) {
      console.log(
        `⚡ Retrieved conversation list from cache (${listKey}): ${conversations.length} conversations`
      );
    }

    return conversations;
  }

  // Lead data caching
  async cacheLeadData(leadId, leadData) {
    const key = this.KEYS.LEAD_DATA + leadId;
    return await this.set(key, leadData, this.TTL.LEAD_DATA);
  }

  async getCachedLeadData(leadId) {
    const key = this.KEYS.LEAD_DATA + leadId;
    return await this.get(key);
  }

  async cacheLeadName(leadId, leadName) {
    const key = this.KEYS.LEAD_NAME + leadId;
    return await this.set(key, leadName, this.TTL.LEAD_DATA);
  }

  async getCachedLeadName(leadId) {
    const key = this.KEYS.LEAD_NAME + leadId;
    return await this.get(key);
  }

  // Knowledge base caching
  async cacheKnowledgeBase(knowledgeData) {
    const key = this.KEYS.KNOWLEDGE_BASE + "full";
    return await this.set(key, knowledgeData, this.TTL.KNOWLEDGE_BASE);
  }

  async getCachedKnowledgeBase() {
    const key = this.KEYS.KNOWLEDGE_BASE + "full";
    return await this.get(key);
  }

  // AI response caching
  async cacheAIResponse(messageHash, response) {
    const key = this.KEYS.AI_RESPONSE + messageHash;
    return await this.set(key, response, this.TTL.AI_RESPONSES);
  }

  async getCachedAIResponse(messageHash) {
    const key = this.KEYS.AI_RESPONSE + messageHash;
    return await this.get(key);
  }

  // Sync management
  async updateSyncTimestamp(type) {
    const key = this.KEYS.SYNC_TIMESTAMP + type;
    const timestamp = Date.now();
    await this.set(key, timestamp);
    return timestamp;
  }

  async getSyncTimestamp(type) {
    const key = this.KEYS.SYNC_TIMESTAMP + type;
    return await this.get(key);
  }

  // Cache invalidation methods
  async invalidateConversation(conversationId) {
    const keys = [
      this.KEYS.CONVERSATION + conversationId,
      this.KEYS.CONVERSATION_MESSAGES + conversationId,
    ];

    for (const key of keys) {
      await this.del(key);
    }

    // Invalidate conversation lists as well
    await this.invalidateConversationLists();

    console.log(`🗑️ Invalidated cache for conversation: ${conversationId}`);
  }

  async invalidateConversationLists() {
    const pattern = this.KEYS.CONVERSATION_LIST + "*";
    const keys = await this.keys(pattern);

    for (const key of keys) {
      await this.del(key);
    }

    console.log(`🗑️ Invalidated ${keys.length} conversation list caches`);
  }

  async invalidateLeadData(leadId) {
    const keys = [this.KEYS.LEAD_DATA + leadId, this.KEYS.LEAD_NAME + leadId];

    for (const key of keys) {
      await this.del(key);
    }

    console.log(`🗑️ Invalidated cache for lead: ${leadId}`);
  }

  // Facebook data caching methods
  async cacheFacebookPages(pages) {
    const key = this.KEYS.FACEBOOK_PAGES + "all";
    const success = await this.set(key, pages, this.TTL.FACEBOOK_PAGES);
    if (success) {
      console.log(`💾 Cached ${pages.length} Facebook pages`);
    }
    return success;
  }

  async getCachedFacebookPages() {
    const key = this.KEYS.FACEBOOK_PAGES + "all";
    const pages = await this.get(key);
    if (pages) {
      console.log(`⚡ Retrieved ${pages.length} Facebook pages from cache`);
    }
    return pages;
  }

  async cacheFacebookLeadForms(forms) {
    const key = this.KEYS.FACEBOOK_FORMS + "all";
    const success = await this.set(key, forms, this.TTL.FACEBOOK_FORMS);
    if (success) {
      console.log(`💾 Cached ${forms.length} Facebook lead forms`);
    }
    return success;
  }

  async getCachedFacebookLeadForms() {
    const key = this.KEYS.FACEBOOK_FORMS + "all";
    const forms = await this.get(key);
    if (forms) {
      console.log(
        `⚡ Retrieved ${forms.length} Facebook lead forms from cache`
      );
    }
    return forms;
  }

  async cacheFacebookFormLeads(formId, leads) {
    const key = this.KEYS.FACEBOOK_LEADS + formId;
    const success = await this.set(key, leads, this.TTL.FACEBOOK_LEADS);
    if (success) {
      console.log(`💾 Cached ${leads.length} leads for form ${formId}`);
    }
    return success;
  }

  async getCachedFacebookFormLeads(formId) {
    const key = this.KEYS.FACEBOOK_LEADS + formId;
    const leads = await this.get(key);
    if (leads) {
      console.log(
        `⚡ Retrieved ${leads.length} leads from cache for form ${formId}`
      );
    }
    return leads;
  }

  async cacheFacebookCampaigns(campaigns) {
    const key = this.KEYS.FACEBOOK_CAMPAIGNS + "all";
    const success = await this.set(key, campaigns, this.TTL.FACEBOOK_CAMPAIGNS);
    if (success) {
      console.log(`💾 Cached ${campaigns.length} Facebook campaigns`);
    }
    return success;
  }

  async getCachedFacebookCampaigns() {
    const key = this.KEYS.FACEBOOK_CAMPAIGNS + "all";
    const campaigns = await this.get(key);
    if (campaigns) {
      console.log(
        `⚡ Retrieved ${campaigns.length} Facebook campaigns from cache`
      );
    }
    return campaigns;
  }

  async cacheFacebookFormStats(formId, stats) {
    const key = this.KEYS.FACEBOOK_STATS + formId;
    const success = await this.set(key, stats, this.TTL.FACEBOOK_STATS);
    if (success) {
      console.log(`💾 Cached stats for Facebook form ${formId}`);
    }
    return success;
  }

  async getCachedFacebookFormStats(formId) {
    const key = this.KEYS.FACEBOOK_STATS + formId;
    const stats = await this.get(key);
    if (stats) {
      console.log(`⚡ Retrieved stats from cache for form ${formId}`);
    }
    return stats;
  }

  async cacheFacebookLeadFormsData(data) {
    const key = this.KEYS.FACEBOOK_FORMS + "comprehensive_data";
    const success = await this.set(key, data, this.TTL.FACEBOOK_FORMS);
    if (success) {
      console.log(
        `💾 Cached comprehensive Facebook forms data (${
          data.leadForms?.length || 0
        } forms, ${data.recentLeads?.length || 0} recent leads)`
      );
    }
    return success;
  }

  async getCachedFacebookLeadFormsData() {
    const key = this.KEYS.FACEBOOK_FORMS + "comprehensive_data";
    const data = await this.get(key);
    if (data) {
      console.log(
        `⚡ Retrieved comprehensive Facebook forms data from cache (${
          data.leadForms?.length || 0
        } forms, ${data.recentLeads?.length || 0} recent leads)`
      );
    }
    return data;
  }

  async cacheFacebookAllLeads(leads) {
    const key = this.KEYS.FACEBOOK_LEADS + "all_forms_all_leads";
    const success = await this.set(key, leads, this.TTL.FACEBOOK_LEADS);
    if (success) {
      console.log(`💾 Cached ${leads.length} leads from all Facebook forms`);
    }
    return success;
  }

  async getCachedFacebookAllLeads() {
    const key = this.KEYS.FACEBOOK_LEADS + "all_forms_all_leads";
    const leads = await this.get(key);
    if (leads) {
      console.log(`⚡ Retrieved ${leads.length} leads from cache (all forms)`);
    }
    return leads;
  }

  // Invalidate Facebook-specific cache
  async invalidateFacebookCache() {
    const patterns = [
      this.KEYS.FACEBOOK_FORMS + "*",
      this.KEYS.FACEBOOK_PAGES + "*",
      this.KEYS.FACEBOOK_LEADS + "*",
      this.KEYS.FACEBOOK_CAMPAIGNS + "*",
      this.KEYS.FACEBOOK_STATS + "*",
    ];

    let totalInvalidated = 0;

    for (const pattern of patterns) {
      const keys = await this.keys(pattern);
      for (const key of keys) {
        await this.del(key);
      }
      totalInvalidated += keys.length;
    }

    console.log(`🗑️ Invalidated ${totalInvalidated} Facebook cache entries`);
    return totalInvalidated;
  }

  async invalidateFacebookFormCache(formId) {
    const keys = [
      this.KEYS.FACEBOOK_LEADS + formId,
      this.KEYS.FACEBOOK_STATS + formId,
    ];

    for (const key of keys) {
      await this.del(key);
    }

    // Also invalidate comprehensive data cache
    await this.del(this.KEYS.FACEBOOK_FORMS + "comprehensive_data");
    await this.del(this.KEYS.FACEBOOK_LEADS + "all_forms_all_leads");

    console.log(`🗑️ Invalidated cache for Facebook form: ${formId}`);
  }

  // Bulk operations for efficiency
  async mget(keys) {
    try {
      if (this.isConnected && this.redis) {
        const values = await this.redis.mget(...keys);
        return values.map((value) => (value ? JSON.parse(value) : null));
      } else {
        return keys.map((key) => this.get(key));
      }
    } catch (error) {
      console.error("❌ Redis MGET error:", error.message);
      return keys.map(() => null);
    }
  }

  async mset(keyValuePairs, ttl = null) {
    try {
      if (this.isConnected && this.redis) {
        const pipeline = this.redis.pipeline();

        for (let i = 0; i < keyValuePairs.length; i += 2) {
          const key = keyValuePairs[i];
          const value = JSON.stringify(keyValuePairs[i + 1]);

          if (ttl) {
            pipeline.setex(key, ttl, value);
          } else {
            pipeline.set(key, value);
          }
        }

        await pipeline.exec();
        return true;
      } else {
        for (let i = 0; i < keyValuePairs.length; i += 2) {
          await this.set(keyValuePairs[i], keyValuePairs[i + 1], ttl);
        }
        return true;
      }
    } catch (error) {
      console.error("❌ Redis MSET error:", error.message);
      return false;
    }
  }

  // Cache statistics
  async getCacheStats() {
    try {
      if (this.isConnected && this.redis) {
        const info = await this.redis.info("memory");
        const stats = {};

        info.split("\r\n").forEach((line) => {
          const [key, value] = line.split(":");
          if (key && value) {
            stats[key] = value;
          }
        });

        return {
          connected: true,
          redis: true,
          memory: stats,
          fallback: false,
        };
      } else {
        return {
          connected: false,
          redis: false,
          fallbackSize: this.fallbackCache ? this.fallbackCache.size : 0,
          fallback: true,
        };
      }
    } catch (error) {
      console.error("❌ Error getting cache stats:", error.message);
      return { error: error.message };
    }
  }

  // Cleanup and shutdown
  async cleanup() {
    if (this.redis) {
      await this.redis.quit();
      console.log("🔌 Redis connection closed");
    }

    if (this.fallbackCache) {
      this.fallbackCache.clear();
      this.fallbackTTL.clear();
    }
  }

  // Health check
  async healthCheck() {
    try {
      if (this.isConnected && this.redis) {
        const pong = await this.redis.ping();
        return { status: "healthy", redis: true, response: pong };
      } else {
        return { status: "healthy", redis: false, fallback: true };
      }
    } catch (error) {
      return { status: "unhealthy", error: error.message };
    }
  }
}

module.exports = new RedisCacheService();
