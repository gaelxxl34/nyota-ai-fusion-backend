#!/usr/bin/env node

/**
 * Discover Conversation Statuses Script
 * This script discovers what conversation statuses actually exist in the database
 */

const path = require("path");

// Set up environment
process.env.NODE_ENV = "development";

// Load environment variables
require("dotenv").config({
  path: path.join(__dirname, "../.env"),
});

// Initialize Firebase Admin
const admin = require("firebase-admin");
const serviceAccount = require("../serviceAccountKey.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}

const db = admin.firestore();

async function discoverConversationStatuses() {
  console.log("🔍 Discovering Conversation Statuses");
  console.log("====================================");

  try {
    // Get all conversations
    console.log("\n📊 Fetching all conversations...");
    const conversationsRef = db.collection("conversations");
    const snapshot = await conversationsRef.get();

    console.log(`Total conversations found: ${snapshot.size}`);

    if (snapshot.empty) {
      console.log("❌ No conversations found in the database");
      return;
    }

    // Discover all unique statuses
    const conversationStatuses = new Set();
    const leadStatuses = new Set();
    const sources = new Set();
    const leadStatusCounts = {};
    const conversationStatusCounts = {};
    const sourceCounts = {};

    let totalConversations = 0;
    let withMessages = 0;
    let withoutMessages = 0;

    console.log("\n🔍 Analyzing conversations...");

    snapshot.forEach((doc) => {
      const data = doc.data();
      totalConversations++;

      // Collect conversation statuses
      if (data.status) {
        conversationStatuses.add(data.status);
        conversationStatusCounts[data.status] =
          (conversationStatusCounts[data.status] || 0) + 1;
      }

      // Collect lead statuses
      if (data.leadStatus) {
        leadStatuses.add(data.leadStatus);
        leadStatusCounts[data.leadStatus] =
          (leadStatusCounts[data.leadStatus] || 0) + 1;
      }

      // Collect sources
      if (data.source) {
        sources.add(data.source);
        sourceCounts[data.source] = (sourceCounts[data.source] || 0) + 1;
      }

      // Check message count
      if (data.messageCount && data.messageCount > 0) {
        withMessages++;
      } else {
        withoutMessages++;
      }
    });

    // Display results
    console.log("\n✅ DISCOVERED DATA STRUCTURE:");
    console.log("==============================");

    console.log(`\n📊 TOTAL CONVERSATIONS: ${totalConversations}`);
    console.log(`   With Messages: ${withMessages}`);
    console.log(`   Without Messages: ${withoutMessages}`);

    console.log(`\n🔧 CONVERSATION STATUSES FOUND:`);
    if (conversationStatuses.size > 0) {
      Array.from(conversationStatuses)
        .sort()
        .forEach((status) => {
          console.log(
            `   • ${status}: ${conversationStatusCounts[status]} conversations`
          );
        });
    } else {
      console.log("   ❌ No conversation statuses found");
    }

    console.log(`\n👤 LEAD STATUSES FOUND:`);
    if (leadStatuses.size > 0) {
      Array.from(leadStatuses)
        .sort()
        .forEach((status) => {
          console.log(
            `   • ${status}: ${leadStatusCounts[status]} conversations`
          );
        });
    } else {
      console.log("   ❌ No lead statuses found");
    }

    console.log(`\n📍 SOURCES FOUND:`);
    if (sources.size > 0) {
      Array.from(sources)
        .sort()
        .forEach((source) => {
          console.log(`   • ${source}: ${sourceCounts[source]} conversations`);
        });
    } else {
      console.log("   ❌ No sources found");
    }

    // Sample a few documents to understand structure
    console.log(`\n🔍 SAMPLE CONVERSATION STRUCTURE:`);
    console.log("==================================");

    let sampleCount = 0;
    snapshot.forEach((doc) => {
      if (sampleCount < 3) {
        const data = doc.data();
        console.log(`\nSample ${sampleCount + 1} (ID: ${doc.id}):`);
        console.log(`  Status: ${data.status || "undefined"}`);
        console.log(`  Lead Status: ${data.leadStatus || "undefined"}`);
        console.log(`  Source: ${data.source || "undefined"}`);
        console.log(`  Message Count: ${data.messageCount || 0}`);
        console.log(
          `  Created: ${
            data.createdAt
              ? new Date(data.createdAt.toDate()).toISOString()
              : "undefined"
          }`
        );
        console.log(
          `  Last Activity: ${
            data.lastActivityAt
              ? new Date(data.lastActivityAt.toDate()).toISOString()
              : "undefined"
          }`
        );
        sampleCount++;
      }
    });

    // Generate the actual statistics object based on discovered data
    console.log(`\n📈 SUGGESTED STATISTICS STRUCTURE:`);
    console.log("===================================");

    const suggestedStats = {
      total: totalConversations,
      withMessages: withMessages,
      withoutMessages: withoutMessages,
      byConversationStatus: conversationStatusCounts,
      byLeadStatus: leadStatusCounts,
      bySource: sourceCounts,
    };

    console.log(JSON.stringify(suggestedStats, null, 2));

    console.log("\n✅ Discovery completed!");

    return {
      conversationStatuses: Array.from(conversationStatuses),
      leadStatuses: Array.from(leadStatuses),
      sources: Array.from(sources),
      totalConversations,
      stats: suggestedStats,
    };
  } catch (error) {
    console.error("\n❌ Error during discovery:", error);
    throw error;
  }
}

// Run the discovery
if (require.main === module) {
  discoverConversationStatuses()
    .then((result) => {
      console.log("\n🎉 Discovery completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Discovery failed:", error);
      process.exit(1);
    });
}

module.exports = { discoverConversationStatuses };
