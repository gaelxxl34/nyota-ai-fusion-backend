/**
 * Facebook Hybrid Leads Service
 * Combines webhook real-time processing with periodic polling backup
 * Ensures no leads are missed even if webhooks fail
 */

const cron = require("node-cron");
const logger = require("../utils/logger");
const redisCache = require("./redisCache.service");
const FacebookLeadFormsService = require("./facebookLeadFormsService");

// Import lead service properly
let leadService = null;
try {
  const { leadService: importedLeadService } = require("./leadService");
  leadService = importedLeadService;
} catch (error) {
  logger.warn("Could not import leadService:", error.message);
}

class FacebookHybridLeadsService {
  constructor() {
    this.facebookService = new FacebookLeadFormsService();
    this.pollingJob = null;
    this.isPollingEnabled = process.env.FB_POLLING_ENABLED !== "false"; // Default true
    this.lastWebhookTime = new Date();
    this.pollingInterval =
      parseInt(process.env.FB_POLLING_INTERVAL_MINUTES) || 15; // Default 15 minutes
    this.maxPollingInterval =
      parseInt(process.env.FB_MAX_POLLING_INTERVAL) || 30; // Max 30 minutes
    this.minPollingInterval =
      parseInt(process.env.FB_MIN_POLLING_INTERVAL) || 5; // Min 5 minutes
    this.processedLeadIds = new Set(); // Track processed leads to avoid duplicates
    this.stats = {
      webhooksReceived: 0,
      pollingRuns: 0,
      leadsFoundByPolling: 0,
      duplicatesPrevented: 0,
      lastPollingTime: null,
      lastWebhookTime: null,
    };

    this.init();
  }

  /**
   * Initialize the hybrid service
   */
  init() {
    logger.info("🔄 Initializing Facebook Hybrid Leads Service");

    // Start periodic polling
    this.startPeriodicPolling();

    // Log service status
    logger.info("✅ Facebook Hybrid Leads Service initialized", {
      pollingInterval: `${this.pollingInterval} minutes`,
      isEnabled: this.isPollingEnabled,
    });
  }

  /**
   * Start periodic polling with cron job
   */
  startPeriodicPolling() {
    if (this.pollingJob) {
      this.pollingJob.destroy();
    }

    // Run every X minutes based on configuration
    const cronExpression = `*/${this.pollingInterval} * * * *`;

    this.pollingJob = cron.schedule(
      cronExpression,
      async () => {
        await this.performPeriodicPoll();
      },
      {
        scheduled: true,
        timezone: "Africa/Kampala", // Uganda timezone
      }
    );

    logger.info(
      `📅 Periodic polling scheduled every ${this.pollingInterval} minutes`
    );
  }

  /**
   * Update polling interval based on webhook activity
   */
  updatePollingInterval() {
    const timeSinceLastWebhook = new Date() - this.lastWebhookTime;
    const minutesSinceWebhook = timeSinceLastWebhook / (1000 * 60);

    let newInterval;

    if (minutesSinceWebhook < 30) {
      // Recent webhook activity - less frequent polling
      newInterval = Math.min(this.maxPollingInterval, this.pollingInterval + 5);
    } else if (minutesSinceWebhook > 60) {
      // No recent webhooks - more frequent polling
      newInterval = Math.max(this.minPollingInterval, this.pollingInterval - 5);
    } else {
      // Moderate activity - keep current interval
      newInterval = this.pollingInterval;
    }

    if (newInterval !== this.pollingInterval) {
      logger.info(
        `🔄 Adjusting polling interval from ${this.pollingInterval} to ${newInterval} minutes`
      );
      this.pollingInterval = newInterval;
      this.startPeriodicPolling(); // Restart with new interval
    }
  }

  /**
   * Record webhook activity
   */
  recordWebhookActivity(leadgenId) {
    this.lastWebhookTime = new Date();
    this.stats.webhooksReceived++;
    this.stats.lastWebhookTime = this.lastWebhookTime;

    // Add to processed leads set
    if (leadgenId) {
      this.processedLeadIds.add(leadgenId);

      // Clean up old processed IDs (keep last 1000)
      if (this.processedLeadIds.size > 1000) {
        const idsArray = Array.from(this.processedLeadIds);
        this.processedLeadIds = new Set(idsArray.slice(-1000));
      }
    }

    // Update polling frequency based on activity
    this.updatePollingInterval();

    logger.info("📨 Webhook activity recorded", {
      leadgenId,
      totalWebhooks: this.stats.webhooksReceived,
      nextPollingIn: `${this.pollingInterval} minutes`,
    });
  }

  /**
   * Perform periodic polling for new leads
   */
  async performPeriodicPoll() {
    if (!this.isPollingEnabled) {
      return;
    }

    try {
      logger.info("🔍 Starting periodic Facebook leads polling...");
      this.stats.pollingRuns++;
      this.stats.lastPollingTime = new Date();

      // Get lead forms data with recent leads
      const formsData = await this.facebookService.getAllLeadFormsData(
        false,
        true
      );

      if (!formsData || !formsData.leadForms) {
        logger.warn("⚠️ No lead forms found during polling");
        return;
      }

      let newLeadsFound = 0;
      const pollingCutoff = new Date(
        Date.now() - this.pollingInterval * 2 * 60 * 1000
      ); // Check leads from 2x polling interval ago

      // Process each form's recent leads
      for (const form of formsData.leadForms) {
        if (!form.recentLeads || form.recentLeads.length === 0) {
          continue;
        }

        logger.info(
          `📋 Checking form "${form.name}" (${form.id}) - ${form.recentLeads.length} recent leads`
        );

        for (const lead of form.recentLeads) {
          try {
            // Skip if already processed by webhook
            if (this.processedLeadIds.has(lead.id)) {
              this.stats.duplicatesPrevented++;
              continue;
            }

            // Skip very old leads (beyond our polling window)
            const leadCreatedTime = new Date(lead.created_time);
            if (leadCreatedTime < pollingCutoff) {
              continue;
            }

            // Check if lead already exists in our system
            const existingLead = await this.checkIfLeadExists(lead);
            if (existingLead) {
              logger.info(
                `📝 Lead ${lead.id} already exists in system (${existingLead.id})`
              );
              this.processedLeadIds.add(lead.id);
              continue;
            }

            // Process new lead found by polling
            logger.info(
              `🆕 New lead found by polling: ${lead.id} from form ${form.name}`
            );
            await this.processPolledLead(lead, form);

            newLeadsFound++;
            this.stats.leadsFoundByPolling++;
            this.processedLeadIds.add(lead.id);
          } catch (leadError) {
            logger.error(
              `❌ Error processing polled lead ${lead.id}:`,
              leadError
            );
          }
        }
      }

      const pollingSummary = {
        formsChecked: formsData.leadForms.length,
        newLeadsFound,
        totalLeadsFoundByPolling: this.stats.leadsFoundByPolling,
        duplicatesPrevented: this.stats.duplicatesPrevented,
        nextPollIn: `${this.pollingInterval} minutes`,
      };

      if (newLeadsFound > 0) {
        logger.info(
          "✅ Periodic polling completed - New leads found!",
          pollingSummary
        );
      } else {
        logger.info(
          "✅ Periodic polling completed - No new leads",
          pollingSummary
        );
      }
    } catch (error) {
      logger.error("❌ Error during periodic polling:", error);
    }
  }

  /**
   * Check if lead already exists in our system
   */
  async checkIfLeadExists(facebookLead) {
    try {
      if (!leadService) {
        logger.warn("leadService not available for duplicate check");
        return null;
      }

      // Extract basic contact info to check for duplicates
      const contactInfo = this.extractBasicContactInfo(facebookLead);

      if (contactInfo.email) {
        const existingByEmail = await leadService.findLeadByEmail(
          contactInfo.email
        );
        if (existingByEmail) return existingByEmail;
      }

      if (contactInfo.phone) {
        const existingByPhone = await leadService.findLeadByPhone(
          contactInfo.phone
        );
        if (existingByPhone) return existingByPhone;
      }

      // Note: Facebook ID check removed as method doesn't exist yet
      // TODO: Implement findLeadByFacebookId in leadService if needed

      return null;
    } catch (error) {
      logger.error("Error checking if lead exists:", error);
      return null;
    }
  }

  /**
   * Extract basic contact info from Facebook lead
   */
  extractBasicContactInfo(facebookLead) {
    const contactInfo = { email: null, phone: null, name: null };

    if (facebookLead.field_data && Array.isArray(facebookLead.field_data)) {
      facebookLead.field_data.forEach((field) => {
        const fieldName = field.name.toLowerCase();
        const fieldValue = field.values?.[0] || "";

        if (fieldName.includes("email")) {
          contactInfo.email = fieldValue;
        } else if (
          fieldName.includes("phone") ||
          fieldName.includes("mobile")
        ) {
          contactInfo.phone = this.formatPhoneNumber(fieldValue);
        } else if (fieldName.includes("name")) {
          if (
            !contactInfo.name ||
            fieldName.includes("full") ||
            fieldName === "name"
          ) {
            contactInfo.name = fieldValue;
          }
        }
      });
    }

    return contactInfo;
  }

  /**
   * Format phone number to international format
   */
  formatPhoneNumber(phone) {
    if (!phone) return null;

    let cleaned = phone.replace(/\D/g, "");

    if (cleaned.startsWith("0")) {
      cleaned = "256" + cleaned.substring(1);
    }

    if (cleaned.length === 9) {
      cleaned = "256" + cleaned;
    }

    return cleaned;
  }

  /**
   * Process a lead found by polling (not webhook)
   */
  async processPolledLead(facebookLead, form) {
    try {
      logger.info(
        `🔄 Processing polled lead ${facebookLead.id} from form ${form.name}`
      );

      // Create the lead using the same logic as webhook processing
      // Import the function from facebook-leads.routes.js
      const {
        createLeadFromFacebookData,
      } = require("../routes/facebook-leads.routes");

      // Simulate metadata that would come from webhook
      const metadata = {
        leadgen_id: facebookLead.id,
        page_id: form.pageId,
        form_id: form.id,
        adgroup_id: facebookLead.adset_id || null,
        ad_id: facebookLead.ad_id || null,
        created_time: facebookLead.created_time,
        source: "POLLING", // Mark as found by polling
      };

      // Use the same lead creation function as webhooks
      const createdLead = await this.createLeadFromPolledData(
        facebookLead,
        metadata
      );

      // Invalidate cache
      await redisCache.invalidateFacebookFormCache(form.id);

      logger.info(`✅ Successfully processed polled lead: ${createdLead.id}`);
      return createdLead;
    } catch (error) {
      logger.error(
        `❌ Error processing polled lead ${facebookLead.id}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Create lead from polled data (similar to webhook processing)
   */
  async createLeadFromPolledData(facebookLead, metadata) {
    try {
      const contactInfo = this.extractBasicContactInfo(facebookLead);

      if (!contactInfo.email && !contactInfo.phone) {
        throw new Error("Lead must have either email or phone number");
      }

      // Create lead data
      const leadData = {
        name: contactInfo.name || "Facebook Lead",
        email: contactInfo.email,
        phone: contactInfo.phone,
        source: "FACEBOOK_LEADS_POLLING", // Distinguish from webhook leads
        status: "CONTACTED",
        facebookLeadData: {
          ...metadata,
          rawData: facebookLead,
          discoveryMethod: "POLLING", // Mark how this lead was discovered
        },
        notes: `Lead discovered by periodic polling - Form: ${metadata.form_id}`,
      };

      // Extract additional fields
      if (facebookLead.field_data) {
        leadData.additionalFields = {};
        facebookLead.field_data.forEach((field) => {
          const fieldName = field.name.toLowerCase().replace(/\s+/g, "_");
          leadData.additionalFields[fieldName] = field.values?.[0] || "";
        });
      }

      // Create the lead
      const newLead = await leadService.createLead(
        {
          name: contactInfo.name,
          email: contactInfo.email,
          phone: contactInfo.phone,
        },
        "FACEBOOK_LEADS",
        {
          status: "CONTACTED",
          facebookLeadData: leadData.facebookLeadData,
          additionalFields: leadData.additionalFields,
          notes: leadData.notes,
        }
      );

      // Send welcome messages
      await this.sendWelcomeMessages(newLead);

      return newLead;
    } catch (error) {
      logger.error("Error creating lead from polled data:", error);
      throw error;
    }
  }

  /**
   * Send welcome messages (reuse from webhook logic)
   */
  async sendWelcomeMessages(lead) {
    try {
      const FacebookLeadWelcomeService = require("./facebookLeadWelcomeService");
      const { whatsappMessageService } = require("./whatsappMessageService");

      const results = { email: null, whatsapp: null };

      // Send welcome email
      if (lead.email) {
        try {
          const emailResult = await FacebookLeadWelcomeService.sendWelcomeEmail(
            lead.email,
            lead.name || "Prospective Student"
          );
          results.email = emailResult;

          if (emailResult.success) {
            await leadService.addInteraction(lead.id, {
              type: "EMAIL",
              content: "Welcome email sent (discovered by polling)",
              channel: "EMAIL",
              automated: true,
              direction: "outgoing",
              metadata: {
                messageId: emailResult.messageId,
                campaignType: "facebook_lead_welcome",
                discoveryMethod: "POLLING",
              },
            });
          }
        } catch (emailError) {
          logger.error(`Email error for polled lead ${lead.id}:`, emailError);
        }
      }

      // Send WhatsApp message
      if (lead.phone) {
        try {
          const whatsappPayload =
            FacebookLeadWelcomeService.getWelcomeWhatsAppPayload(lead.phone);
          const whatsappResult =
            await whatsappMessageService.sendTemplateMessage(
              lead.phone,
              whatsappPayload,
              { leadId: lead.id }
            );
          results.whatsapp = whatsappResult;

          if (whatsappResult.success) {
            await leadService.addInteraction(lead.id, {
              type: "WHATSAPP",
              content: "WhatsApp welcome message sent (discovered by polling)",
              channel: "WHATSAPP",
              automated: true,
              direction: "outgoing",
              metadata: {
                messageId: whatsappResult.messageId,
                campaignType: "facebook_lead_welcome",
                discoveryMethod: "POLLING",
              },
            });
          }
        } catch (whatsappError) {
          logger.error(
            `WhatsApp error for polled lead ${lead.id}:`,
            whatsappError
          );
        }
      }

      return results;
    } catch (error) {
      logger.error("Error sending welcome messages for polled lead:", error);
      return { email: null, whatsapp: null };
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      ...this.stats,
      pollingInterval: this.pollingInterval,
      isPollingEnabled: this.isPollingEnabled,
      processedLeadsCount: this.processedLeadIds.size,
      timeSinceLastWebhook: this.stats.lastWebhookTime
        ? Math.floor((new Date() - this.stats.lastWebhookTime) / (1000 * 60))
        : null,
      timeSinceLastPolling: this.stats.lastPollingTime
        ? Math.floor((new Date() - this.stats.lastPollingTime) / (1000 * 60))
        : null,
    };
  }

  /**
   * Enable/disable polling
   */
  setPollingEnabled(enabled) {
    this.isPollingEnabled = enabled;
    logger.info(`📅 Periodic polling ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Manually trigger a polling run
   */
  async triggerManualPoll() {
    logger.info("🚀 Manual polling triggered");
    await this.performPeriodicPoll();
  }

  /**
   * Stop the service
   */
  stop() {
    if (this.pollingJob) {
      this.pollingJob.destroy();
      this.pollingJob = null;
    }
    logger.info("🛑 Facebook Hybrid Leads Service stopped");
  }
}

module.exports = FacebookHybridLeadsService;
