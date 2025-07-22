const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

console.log("🔥 Initializing Firebase...");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
console.log("✅ Firebase initialized");

async function updateConversations() {
  try {
    console.log("📋 Getting conversations...");
    const conversations = await db.collection("conversations").get();
    console.log(
      `📊 Found ${conversations.docs.length} conversations to update`
    );

    for (const doc of conversations.docs) {
      const data = doc.data();
      console.log(
        `🔍 Processing conversation ${doc.id}, current organizationId: ${data.organizationId}`
      );

      if (!data.organizationId) {
        await doc.ref.update({
          organizationId: "dev_org_123",
          updatedAt: new Date(),
        });
        console.log(
          `✅ Updated conversation ${doc.id} with organizationId: dev_org_123`
        );
      } else {
        console.log(
          `⏭️  Conversation ${doc.id} already has organizationId: ${data.organizationId}`
        );
      }
    }

    console.log("🎉 All conversations processed successfully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error updating conversations:", error);
    process.exit(1);
  }
}

updateConversations();
