/**
 * Email Tracking Model
 * Tracks email delivery status, bounces, opens, clicks, etc.
 */

class EmailTracker {
  constructor() {
    this.emailLogs = new Map(); // In-memory storage (replace with database)
  }

  /**
   * Log sent email
   */
  logSentEmail(messageId, recipientEmail, subject, campaignId = null) {
    const logEntry = {
      messageId,
      recipientEmail,
      subject,
      campaignId,
      status: "sent",
      sentAt: new Date(),
      events: [],
      bounced: false,
      delivered: false,
      opened: false,
      clicked: false,
      lastUpdated: new Date(),
    };

    this.emailLogs.set(messageId, logEntry);
    console.log(`📊 Email logged: ${messageId} to ${recipientEmail}`);

    return logEntry;
  }

  /**
   * Update email status from webhook events
   */
  updateEmailStatus(messageId, eventType, eventData = {}) {
    const log = this.emailLogs.get(messageId);

    if (!log) {
      console.warn(`⚠️ No email log found for message ID: ${messageId}`);
      return null;
    }

    // Add event to history
    log.events.push({
      type: eventType,
      timestamp: new Date(),
      data: eventData,
    });

    // Update status flags
    switch (eventType) {
      case "delivered":
        log.delivered = true;
        log.status = "delivered";
        break;

      case "bounce":
        log.bounced = true;
        log.status = "bounced";
        log.bounceReason = eventData.reason;
        log.bounceClassification = eventData.bounce_classification;
        break;

      case "blocked":
      case "dropped":
        log.status = eventType;
        log.reason = eventData.reason;
        break;

      case "open":
        log.opened = true;
        if (log.status === "delivered") {
          log.status = "opened";
        }
        break;

      case "click":
        log.clicked = true;
        log.status = "clicked";
        break;

      case "spam_report":
        log.status = "spam";
        break;

      case "unsubscribe":
        log.status = "unsubscribed";
        break;
    }

    log.lastUpdated = new Date();
    this.emailLogs.set(messageId, log);

    console.log(`📊 Email status updated: ${messageId} -> ${log.status}`);
    return log;
  }

  /**
   * Get email status by message ID
   */
  getEmailStatus(messageId) {
    return this.emailLogs.get(messageId) || null;
  }

  /**
   * Get all bounced emails
   */
  getBouncedEmails() {
    const bounced = [];
    for (const [messageId, log] of this.emailLogs) {
      if (log.bounced) {
        bounced.push(log);
      }
    }
    return bounced;
  }

  /**
   * Get campaign statistics
   */
  getCampaignStats(campaignId) {
    const stats = {
      total: 0,
      sent: 0,
      delivered: 0,
      bounced: 0,
      opened: 0,
      clicked: 0,
      failed: 0,
      deliveryRate: 0,
      openRate: 0,
      clickRate: 0,
    };

    for (const [messageId, log] of this.emailLogs) {
      if (log.campaignId === campaignId) {
        stats.total++;

        if (log.status === "sent" || log.delivered) stats.sent++;
        if (log.delivered) stats.delivered++;
        if (log.bounced) stats.bounced++;
        if (log.opened) stats.opened++;
        if (log.clicked) stats.clicked++;
        if (["bounced", "blocked", "dropped"].includes(log.status)) {
          stats.failed++;
        }
      }
    }

    // Calculate rates
    if (stats.total > 0) {
      stats.deliveryRate = ((stats.delivered / stats.total) * 100).toFixed(2);
      stats.openRate =
        stats.delivered > 0
          ? ((stats.opened / stats.delivered) * 100).toFixed(2)
          : 0;
      stats.clickRate =
        stats.opened > 0
          ? ((stats.clicked / stats.opened) * 100).toFixed(2)
          : 0;
    }

    return stats;
  }

  /**
   * Check if email address should be suppressed
   */
  shouldSuppressEmail(email) {
    // Check for recent bounces or spam reports
    for (const [messageId, log] of this.emailLogs) {
      if (log.recipientEmail === email) {
        if (log.bounced && log.bounceClassification === "Invalid") {
          return { suppress: true, reason: "Hard bounce - invalid email" };
        }
        if (log.status === "spam") {
          return { suppress: true, reason: "Marked as spam" };
        }
        if (log.status === "unsubscribed") {
          return { suppress: true, reason: "User unsubscribed" };
        }
      }
    }

    return { suppress: false, reason: null };
  }

  /**
   * Get delivery statistics summary
   */
  getDeliveryStats() {
    const stats = {
      totalEmails: this.emailLogs.size,
      delivered: 0,
      bounced: 0,
      opened: 0,
      clicked: 0,
      failed: 0,
    };

    for (const [messageId, log] of this.emailLogs) {
      if (log.delivered) stats.delivered++;
      if (log.bounced) stats.bounced++;
      if (log.opened) stats.opened++;
      if (log.clicked) stats.clicked++;
      if (["bounced", "blocked", "dropped"].includes(log.status)) {
        stats.failed++;
      }
    }

    return stats;
  }
}

// Export singleton instance
module.exports = new EmailTracker();
