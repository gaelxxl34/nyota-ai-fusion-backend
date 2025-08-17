const express = require("express");
const router = express.Router();
const logger = require("../utils/logger");

/**
 * SendGrid Event Webhook Handler
 * This endpoint receives delivery status updates from SendGrid
 */
router.post(
  "/sendgrid-events",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      console.log("📧 SendGrid webhook received");

      // Parse the events
      const events = JSON.parse(req.body);

      for (const event of events) {
        await handleSendGridEvent(event);
      }

      res.status(200).send("OK");
    } catch (error) {
      console.error("❌ Error processing SendGrid webhook:", error);
      res.status(500).send("Error processing webhook");
    }
  }
);

/**
 * Handle individual SendGrid events
 */
async function handleSendGridEvent(event) {
  const {
    event: eventType,
    email,
    timestamp,
    sg_message_id,
    reason,
    status,
    response,
    bounce_classification,
  } = event;

  console.log(`📧 SendGrid Event: ${eventType} for ${email}`);

  switch (eventType) {
    case "delivered":
      console.log(`✅ Email delivered successfully to ${email}`);
      await updateEmailStatus(sg_message_id, "delivered", null);
      break;

    case "bounce":
      console.log(`❌ Email bounced to ${email}. Reason: ${reason}`);
      await updateEmailStatus(sg_message_id, "bounced", reason);
      await handleBounce(email, reason, bounce_classification);
      break;

    case "blocked":
      console.log(`🚫 Email blocked to ${email}. Reason: ${reason}`);
      await updateEmailStatus(sg_message_id, "blocked", reason);
      break;

    case "dropped":
      console.log(`📤 Email dropped to ${email}. Reason: ${reason}`);
      await updateEmailStatus(sg_message_id, "dropped", reason);
      break;

    case "deferred":
      console.log(`⏸️ Email deferred to ${email}. Response: ${response}`);
      await updateEmailStatus(sg_message_id, "deferred", response);
      break;

    case "processed":
      console.log(`🔄 Email processed for ${email}`);
      await updateEmailStatus(sg_message_id, "processed", null);
      break;

    case "open":
      console.log(`👁️ Email opened by ${email}`);
      await updateEmailStatus(sg_message_id, "opened", null);
      break;

    case "click":
      console.log(`🖱️ Email clicked by ${email}`);
      await updateEmailStatus(sg_message_id, "clicked", null);
      break;

    case "spam_report":
      console.log(`🚨 Email marked as spam by ${email}`);
      await updateEmailStatus(sg_message_id, "spam", null);
      await handleSpamReport(email);
      break;

    case "unsubscribe":
      console.log(`📝 User unsubscribed: ${email}`);
      await updateEmailStatus(sg_message_id, "unsubscribed", null);
      await handleUnsubscribe(email);
      break;

    default:
      console.log(`ℹ️ Unknown event type: ${eventType} for ${email}`);
  }
}

/**
 * Update email status in database
 */
async function updateEmailStatus(messageId, status, reason) {
  try {
    // You can implement database storage here
    console.log(`📊 Updating email status: ${messageId} -> ${status}`);

    // Example implementation:
    // await EmailLog.updateOne(
    //   { messageId: messageId },
    //   {
    //     status: status,
    //     reason: reason,
    //     updatedAt: new Date()
    //   }
    // );
  } catch (error) {
    console.error("❌ Error updating email status:", error);
  }
}

/**
 * Handle bounced emails
 */
async function handleBounce(email, reason, classification) {
  try {
    console.log(`🔍 Processing bounce for ${email}`);

    // Hard bounce - remove from mailing list
    if (classification === "Invalid" || classification === "Bounce") {
      console.log(`🚨 Hard bounce detected for ${email} - marking as invalid`);
      // await markEmailAsInvalid(email);
    }

    // Soft bounce - retry later
    if (classification === "Deferred") {
      console.log(`⏱️ Soft bounce detected for ${email} - will retry`);
      // await scheduleRetry(email);
    }

    // Log bounce for analytics
    // await logBounce(email, reason, classification);
  } catch (error) {
    console.error("❌ Error handling bounce:", error);
  }
}

/**
 * Handle spam reports
 */
async function handleSpamReport(email) {
  try {
    console.log(`🚨 Processing spam report for ${email}`);
    // await addToSuppressionList(email, 'spam');
  } catch (error) {
    console.error("❌ Error handling spam report:", error);
  }
}

/**
 * Handle unsubscribes
 */
async function handleUnsubscribe(email) {
  try {
    console.log(`📝 Processing unsubscribe for ${email}`);
    // await addToSuppressionList(email, 'unsubscribe');
  } catch (error) {
    console.error("❌ Error handling unsubscribe:", error);
  }
}

module.exports = router;
