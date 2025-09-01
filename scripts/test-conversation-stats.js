#!/usr/bin/env node

/**
 * Conversation Statistics Test Script
 * This script tests the conversation statistics service and displays the results
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

// Import the conversation stats service
const conversationStatsService = require("../src/services/conversationStats.service");

async function testConversationStats() {
  console.log("🧪 Testing Conversation Statistics Service");
  console.log("==========================================");

  try {
    // Test basic conversation counts
    console.log("\n📊 Getting conversation counts...");
    const counts = await conversationStatsService.getConversationCounts();

    console.log("\n✅ Conversation Counts:");
    console.log(`Total Conversations: ${counts.total}`);
    console.log(`Active: ${counts.active}`);
    console.log(`With Messages: ${counts.withMessages}`);
    console.log(`Without Messages: ${counts.withoutMessages}`);
    console.log(`Recent 24h: ${counts.recent24h}`);
    console.log(`Recent 7 days: ${counts.recent7days}`);
    console.log(`Recent 30 days: ${counts.recent30days}`);

    console.log("\n📈 By Lead Status:");
    Object.entries(counts.byLeadStatus).forEach(([status, count]) => {
      if (count > 0) {
        console.log(`  ${status}: ${count}`);
      }
    });

    // Test detailed statistics
    console.log("\n📊 Getting detailed statistics...");
    const fullStats =
      await conversationStatsService.getConversationStatistics();

    console.log("\n✅ Detailed Statistics:");
    console.log(`Total Messages: ${fullStats.totalMessages}`);
    console.log(
      `Average Messages per Conversation: ${fullStats.averageMessagesPerConversation}`
    );
    console.log(`Daily Activity Records: ${fullStats.dailyActivity.length}`);

    // Test conversion rates
    console.log("\n� Getting conversion rates...");
    const conversionRates = await conversationStatsService.getConversionRates();

    console.log("\n✅ Conversion Rates:");
    console.log(
      `Interested to Applied: ${conversionRates.interestedToApplied}%`
    );
    console.log(`Applied to Qualified: ${conversionRates.appliedToQualified}%`);
    console.log(
      `Qualified to Admitted: ${conversionRates.qualifiedToAdmitted}%`
    );
    console.log(`Admitted to Enrolled: ${conversionRates.admittedToEnrolled}%`);
    console.log(`Overall Conversion: ${conversionRates.overallConversion}%`);

    // Test dashboard summary
    console.log("\n📊 Getting dashboard summary...");
    const dashboardSummary =
      await conversationStatsService.getDashboardSummary();

    console.log("\n✅ Dashboard Summary:");
    console.log(
      `Total Conversations: ${dashboardSummary.overview.totalConversations}`
    );
    console.log(
      `Active Conversations: ${dashboardSummary.overview.activeConversations}`
    );
    console.log(
      `Average Messages: ${dashboardSummary.overview.averageMessagesPerConversation}`
    );
    console.log(
      `Recent Activity (24h): ${dashboardSummary.recentActivity.last24Hours}`
    );

    // Test caching
    console.log("\n🚀 Testing cached statistics...");
    const cachedStats =
      await conversationStatsService.getCachedConversationStats();
    console.log(`Cache test successful - Total: ${cachedStats.total}`);

    console.log("\n✅ All tests completed successfully!");
  } catch (error) {
    console.error("\n❌ Error during testing:", error);
    process.exit(1);
  }
}

// Run the test
testConversationStats()
  .then(() => {
    console.log("\n🎉 Test completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Test failed:", error);
    process.exit(1);
  });
