const express = require("express");
const router = express.Router();
const redisCache = require("../services/redisCache.service");
const conversationService = require("../services/conversationService");

/**
 * Cache management and monitoring routes
 */

// Get cache statistics and health status
router.get("/stats", async (req, res) => {
  try {
    const stats = await redisCache.getCacheStats();
    const healthCheck = await redisCache.healthCheck();

    res.json({
      success: true,
      cache: {
        stats,
        health: healthCheck,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Force refresh conversations cache
router.post("/conversations/refresh", async (req, res) => {
  try {
    console.log("🔄 Manual cache refresh requested for conversations...");

    // Invalidate conversation lists
    await redisCache.invalidateConversationLists();

    // Force sync from Firestore
    await conversationService.syncConversationsFromFirestore();

    res.json({
      success: true,
      message: "Conversations cache refreshed successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error refreshing conversations cache:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get cached conversations with options
router.get("/conversations", async (req, res) => {
  try {
    const options = {
      limit: parseInt(req.query.limit) || 25,
      offset: parseInt(req.query.offset) || 0,
      status: req.query.status || "active",
      includeClosed: req.query.includeClosed === "true",
      leadStatus: req.query.leadStatus || null,
      forceRefresh: req.query.forceRefresh === "true",
    };

    const result = await conversationService.getActiveConversationsWithCache(
      options
    );

    res.json({
      success: true,
      data: result,
      cached: result.source === "cache" || result.fromCache === true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error getting cached conversations:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Clear specific conversation cache
router.delete("/conversations/:id", async (req, res) => {
  try {
    const conversationId = req.params.id;

    console.log(
      `🗑️ Manual cache invalidation for conversation: ${conversationId}`
    );

    await redisCache.invalidateConversation(conversationId);

    res.json({
      success: true,
      message: `Cache cleared for conversation ${conversationId}`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error clearing conversation cache:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Clear all conversation caches
router.delete("/conversations", async (req, res) => {
  try {
    console.log("🗑️ Manual cache clear for all conversations...");

    await redisCache.invalidateConversationLists();

    // Also clear individual conversation caches
    const conversationKeys = await redisCache.keys(
      redisCache.KEYS.CONVERSATION + "*"
    );
    const messageKeys = await redisCache.keys(
      redisCache.KEYS.CONVERSATION_MESSAGES + "*"
    );

    for (const key of [...conversationKeys, ...messageKeys]) {
      await redisCache.del(key);
    }

    res.json({
      success: true,
      message: `Cleared ${
        conversationKeys.length + messageKeys.length
      } conversation caches`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error clearing all conversation caches:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get cache size and usage information
router.get("/size", async (req, res) => {
  try {
    const conversationKeys = await redisCache.keys(
      redisCache.KEYS.CONVERSATION + "*"
    );
    const messageKeys = await redisCache.keys(
      redisCache.KEYS.CONVERSATION_MESSAGES + "*"
    );
    const listKeys = await redisCache.keys(
      redisCache.KEYS.CONVERSATION_LIST + "*"
    );
    const leadKeys = await redisCache.keys(redisCache.KEYS.LEAD_NAME + "*");
    const knowledgeKeys = await redisCache.keys(
      redisCache.KEYS.KNOWLEDGE_BASE + "*"
    );
    const aiResponseKeys = await redisCache.keys(
      redisCache.KEYS.AI_RESPONSE + "*"
    );

    const cacheInfo = {
      conversations: conversationKeys.length,
      messages: messageKeys.length,
      conversationLists: listKeys.length,
      leadNames: leadKeys.length,
      knowledgeBase: knowledgeKeys.length,
      aiResponses: aiResponseKeys.length,
      total:
        conversationKeys.length +
        messageKeys.length +
        listKeys.length +
        leadKeys.length +
        knowledgeKeys.length +
        aiResponseKeys.length,
    };

    res.json({
      success: true,
      cache: cacheInfo,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error getting cache size:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Warm up cache - preload commonly accessed data
router.post("/warmup", async (req, res) => {
  try {
    console.log("🔥 Starting cache warmup...");

    const startTime = Date.now();

    // Warm up conversations cache
    const conversationsResult =
      await conversationService.getActiveConversationsWithCache({
        limit: 50,
        forceRefresh: true,
      });

    console.log(
      `✅ Warmed up ${conversationsResult.conversations.length} conversations`
    );

    const loadTime = Date.now() - startTime;

    res.json({
      success: true,
      message: "Cache warmup completed",
      loadTime: `${loadTime}ms`,
      itemsWarmed: {
        conversations: conversationsResult.conversations.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error during cache warmup:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test cache performance
router.get("/performance-test", async (req, res) => {
  try {
    const iterations = parseInt(req.query.iterations) || 10;

    console.log(
      `🏃‍♂️ Running cache performance test with ${iterations} iterations...`
    );

    const results = {
      cached: [],
      uncached: [],
    };

    // Test cached performance
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await conversationService.getActiveConversationsWithCache({ limit: 25 });
      const end = Date.now();
      results.cached.push(end - start);
    }

    // Test uncached performance
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await conversationService.getActiveConversationsWithCache({
        limit: 25,
        forceRefresh: true,
      });
      const end = Date.now();
      results.uncached.push(end - start);
    }

    const cachedAvg =
      results.cached.reduce((a, b) => a + b, 0) / results.cached.length;
    const uncachedAvg =
      results.uncached.reduce((a, b) => a + b, 0) / results.uncached.length;
    const improvement = (
      ((uncachedAvg - cachedAvg) / uncachedAvg) *
      100
    ).toFixed(2);

    res.json({
      success: true,
      performance: {
        iterations,
        cached: {
          average: `${cachedAvg.toFixed(2)}ms`,
          min: `${Math.min(...results.cached)}ms`,
          max: `${Math.max(...results.cached)}ms`,
          all: results.cached,
        },
        uncached: {
          average: `${uncachedAvg.toFixed(2)}ms`,
          min: `${Math.min(...results.uncached)}ms`,
          max: `${Math.max(...results.uncached)}ms`,
          all: results.uncached,
        },
        improvement: `${improvement}% faster`,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error in performance test:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Clear all caches (emergency cleanup)
router.delete("/all", async (req, res) => {
  try {
    console.log("🚨 Emergency cache clear - removing all cached data...");

    const patterns = [
      redisCache.KEYS.CONVERSATION + "*",
      redisCache.KEYS.CONVERSATION_MESSAGES + "*",
      redisCache.KEYS.CONVERSATION_LIST + "*",
      redisCache.KEYS.LEAD_DATA + "*",
      redisCache.KEYS.LEAD_NAME + "*",
      redisCache.KEYS.KNOWLEDGE_BASE + "*",
      redisCache.KEYS.AI_RESPONSE + "*",
      redisCache.KEYS.ANALYTICS + "*",
    ];

    let totalCleared = 0;

    for (const pattern of patterns) {
      const keys = await redisCache.keys(pattern);
      for (const key of keys) {
        await redisCache.del(key);
      }
      totalCleared += keys.length;
    }

    res.json({
      success: true,
      message: `Emergency cache clear completed - ${totalCleared} items removed`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error during emergency cache clear:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
