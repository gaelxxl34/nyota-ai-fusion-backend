/**
 * Facebook Lead Forms Service
 * Service to interact with Facebook Graph API for lead forms management with Redis caching
 */

const axios = require("axios");
const redisCache = require("./redisCache.service");

class FacebookLeadFormsService {
  constructor() {
    this.accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
    this.baseUrl = "https://graph.facebook.com/v18.0";
    this.cache = redisCache;
  }

  /**
   * Get all accessible Facebook pages with caching
   */
  async getFacebookPages(useCache = true) {
    try {
      // Try to get from cache first
      if (useCache) {
        const cachedPages = await this.cache.getCachedFacebookPages();
        if (cachedPages) {
          return cachedPages;
        }
      }

      console.log("📄 Fetching Facebook pages from Meta API...");
      const response = await axios.get(`${this.baseUrl}/me/accounts`, {
        params: {
          access_token: this.accessToken,
          fields: "id,name,access_token,tasks",
        },
      });

      const pages = response.data.data || [];

      // Cache the result
      if (useCache) {
        await this.cache.cacheFacebookPages(pages);
      }

      return pages;
    } catch (error) {
      console.error(
        "❌ Error fetching Facebook pages:",
        error.response?.data || error.message
      );
      throw new Error("Failed to fetch Facebook pages");
    }
  }

  /**
   * Get lead forms for a specific page (no caching here since it's part of larger operations)
   */
  async getLeadForms(pageId, pageAccessToken) {
    try {
      console.log(`📋 Fetching lead forms for page ${pageId}...`);
      const response = await axios.get(
        `${this.baseUrl}/${pageId}/leadgen_forms`,
        {
          params: {
            access_token: pageAccessToken || this.accessToken,
            fields:
              "id,name,status,leads_count,created_time,page_id,questions,privacy_policy_url,follow_up_action_url,is_optimized_for_quality",
          },
        }
      );

      const forms = response.data.data || [];
      console.log(`📋 Found ${forms.length} lead forms for page ${pageId}`);
      return forms;
    } catch (error) {
      console.error(
        `❌ Error fetching lead forms for page ${pageId}:`,
        error.response?.data || error.message
      );
      return [];
    }
  }

  /**
   * Get leads from a specific form with pagination support and caching
   */
  async getLeadsFromForm(formId, pageAccessToken, limit = 25, useCache = true) {
    try {
      // Create cache key based on form ID and limit
      const cacheKey = `${formId}_${limit}`;

      // Try to get from cache first
      if (useCache) {
        const cachedLeads = await this.cache.getCachedFacebookFormLeads(
          cacheKey
        );
        if (cachedLeads) {
          return cachedLeads;
        }
      }

      console.log(
        `📥 Fetching leads from form ${formId} (limit: ${limit}) from Meta API...`
      );

      const allLeads = [];
      let nextUrl = null;
      let requestCount = 0;
      const maxRequests = Math.ceil(limit / 25); // Facebook API typically returns 25 per request

      do {
        const requestUrl = nextUrl || `${this.baseUrl}/${formId}/leads`;
        const requestParams = nextUrl
          ? {}
          : {
              access_token: pageAccessToken || this.accessToken,
              fields:
                "id,created_time,field_data,ad_id,adset_id,campaign_id,form_id,is_organic",
              limit: Math.min(25, limit - allLeads.length),
            };

        console.log(
          `📥 Fetching leads from form ${formId}, request ${
            requestCount + 1
          }/${maxRequests}, current total: ${allLeads.length}`
        );

        const response = nextUrl
          ? await axios.get(nextUrl)
          : await axios.get(requestUrl, { params: requestParams });

        const leads = response.data.data || [];
        allLeads.push(...leads);

        nextUrl = response.data.paging?.next || null;
        requestCount++;

        console.log(
          `📊 Form ${formId}: Got ${leads.length} leads, total now: ${allLeads.length}`
        );

        // Stop if we've reached our limit or max requests
        if (
          allLeads.length >= limit ||
          requestCount >= maxRequests ||
          !nextUrl
        ) {
          break;
        }
      } while (nextUrl && allLeads.length < limit);

      const finalLeads = allLeads.slice(0, limit);
      console.log(`✅ Form ${formId}: Final total ${finalLeads.length} leads`);

      // Cache the result
      if (useCache) {
        await this.cache.cacheFacebookFormLeads(cacheKey, finalLeads);
      }

      return finalLeads;
    } catch (error) {
      console.error(
        `❌ Error fetching leads from form ${formId}:`,
        error.response?.data || error.message
      );
      return [];
    }
  }

  /**
   * Get ad accounts with caching
   */
  async getAdAccounts(useCache = true) {
    try {
      // For now, we don't cache ad accounts separately as they're part of campaigns caching
      console.log("💼 Fetching ad accounts from Meta API...");
      const response = await axios.get(`${this.baseUrl}/me/adaccounts`, {
        params: {
          access_token: this.accessToken,
          fields: "id,name,account_status,currency,timezone_name",
        },
      });

      const accounts = response.data.data || [];
      console.log(`💼 Found ${accounts.length} ad accounts`);
      return accounts;
    } catch (error) {
      console.error(
        "❌ Error fetching ad accounts:",
        error.response?.data || error.message
      );
      return [];
    }
  }

  /**
   * Get campaigns from ad account (part of comprehensive caching)
   */
  async getCampaigns(adAccountId, status = "ACTIVE") {
    try {
      console.log(`📢 Fetching campaigns for account ${adAccountId}...`);
      const response = await axios.get(
        `${this.baseUrl}/${adAccountId}/campaigns`,
        {
          params: {
            access_token: this.accessToken,
            fields: "id,name,status,objective,created_time,updated_time",
            limit: 100,
          },
        }
      );

      const campaigns = response.data.data || [];
      console.log(
        `📢 Found ${campaigns.length} campaigns for account ${adAccountId}`
      );
      return campaigns;
    } catch (error) {
      console.error(
        `❌ Error fetching campaigns from ${adAccountId}:`,
        error.response?.data || error.message
      );
      return [];
    }
  }

  /**
   * Get ads from a campaign
   */
  async getAdsFromCampaign(campaignId) {
    try {
      const response = await axios.get(`${this.baseUrl}/${campaignId}/ads`, {
        params: {
          access_token: this.accessToken,
          fields: "id,name,status,created_time,creative,adset_id",
        },
      });

      return response.data.data || [];
    } catch (error) {
      console.error(
        `❌ Error fetching ads from campaign ${campaignId}:`,
        error.response?.data || error.message
      );
      return [];
    }
  }

  /**
   * Get all leads from all forms with smart caching
   */
  async getAllLeadsFromAllForms(
    pageAccessToken,
    maxLeadsPerForm = 1000,
    useCache = true
  ) {
    try {
      // Try to get from cache first
      if (useCache) {
        const cachedLeads = await this.cache.getCachedFacebookAllLeads();
        if (cachedLeads) {
          return cachedLeads;
        }
      }

      console.log("🔍 Fetching all leads from all forms from Meta API...");

      const allLeads = [];
      const pages = await this.getFacebookPages(useCache);

      for (const page of pages) {
        const leadForms = await this.getLeadForms(page.id, page.access_token);

        for (const form of leadForms) {
          // Get ALL leads for this form (up to maxLeadsPerForm to prevent huge API calls)
          const leads = await this.getLeadsFromForm(
            form.id,
            page.access_token,
            maxLeadsPerForm,
            false // Don't use individual form cache for this bulk operation
          );

          // Add form and page context to each lead
          const enrichedLeads = leads.map((lead) => ({
            ...lead,
            formName: form.name,
            formId: form.id,
            pageName: page.name,
            pageId: page.id,
          }));

          allLeads.push(...enrichedLeads);
        }
      }

      // Sort all leads by creation time (newest first)
      allLeads.sort(
        (a, b) => new Date(b.created_time) - new Date(a.created_time)
      );

      // Cache the result
      if (useCache) {
        await this.cache.cacheFacebookAllLeads(allLeads);
      }

      console.log(`✅ Retrieved ${allLeads.length} total leads from all forms`);
      return allLeads;
    } catch (error) {
      console.error("❌ Error getting all leads from all forms:", error);
      throw new Error("Failed to fetch all Facebook leads");
    }
  }

  /**
   * Get comprehensive Facebook lead forms data with smart caching
   */
  async getAllLeadFormsData(fetchAllLeads = false, useCache = true) {
    try {
      // Try to get from cache first
      if (useCache) {
        const cachedData = await this.cache.getCachedFacebookLeadFormsData();
        if (cachedData && (!fetchAllLeads || cachedData.allLeadsFetched)) {
          console.log("⚡ Using cached Facebook lead forms data");
          return cachedData;
        }
      }

      console.log(
        `🔍 Fetching comprehensive Facebook lead forms data from Meta API (fetchAllLeads: ${fetchAllLeads})...`
      );

      const results = {
        pages: [],
        leadForms: [],
        adAccounts: [],
        campaigns: [],
        totalLeads: 0,
        activeForms: 0,
        recentLeads: [],
        allLeadsFetched: fetchAllLeads,
        lastFetched: new Date().toISOString(),
      };

      // Get Pages and their lead forms
      const pages = await this.getFacebookPages(useCache);
      results.pages = pages;

      for (const page of pages) {
        const leadForms = await this.getLeadForms(page.id, page.access_token);

        for (const form of leadForms) {
          // Add page information to the form
          form.pageName = page.name;
          form.pageId = page.id;

          // Get recent leads for this form - more if fetchAllLeads is true
          const leadLimit = fetchAllLeads ? 1000 : 5;
          const recentLeads = await this.getLeadsFromForm(
            form.id,
            page.access_token,
            leadLimit,
            false // Don't use individual cache for bulk operation
          );
          form.recentLeads = recentLeads;

          // Add to recent leads collection
          results.recentLeads.push(
            ...recentLeads.map((lead) => ({
              ...lead,
              formName: form.name,
              formId: form.id,
              pageName: page.name,
            }))
          );

          results.leadForms.push(form);
        }
      }

      // Get Ad Accounts and Campaigns (try cached campaigns first)
      let campaigns = [];
      if (useCache) {
        campaigns = (await this.cache.getCachedFacebookCampaigns()) || [];
      }

      if (campaigns.length === 0) {
        const adAccounts = await this.getAdAccounts(useCache);
        results.adAccounts = adAccounts;

        // Get Campaigns from each ad account
        for (const account of adAccounts) {
          try {
            const accountCampaigns = await this.getCampaigns(account.id);
            const campaignsWithAccount = accountCampaigns.map((campaign) => ({
              ...campaign,
              accountName: account.name,
              accountId: account.id,
            }));
            campaigns.push(...campaignsWithAccount);
          } catch (error) {
            console.warn(
              `Could not fetch campaigns for account ${account.id}:`,
              error.message
            );
          }
        }

        // Cache campaigns
        if (useCache) {
          await this.cache.cacheFacebookCampaigns(campaigns);
        }
      }

      results.campaigns = campaigns;

      // Calculate summary statistics
      results.totalLeads = results.leadForms.reduce(
        (sum, form) => sum + (form.leads_count || 0),
        0
      );
      results.activeForms = results.leadForms.filter(
        (form) => form.status === "ACTIVE"
      ).length;

      // Sort recent leads by creation time
      results.recentLeads.sort(
        (a, b) => new Date(b.created_time) - new Date(a.created_time)
      );

      // If fetchAllLeads is false, limit to 20 most recent for performance
      if (!fetchAllLeads) {
        results.recentLeads = results.recentLeads.slice(0, 20);
      }

      // Cache the result
      if (useCache) {
        await this.cache.cacheFacebookLeadFormsData(results);
      }

      console.log(
        `✅ Retrieved comprehensive Facebook data: ${results.leadForms.length} forms, ${results.recentLeads.length} recent leads, ${results.campaigns.length} campaigns`
      );
      return results;
    } catch (error) {
      console.error("❌ Error getting comprehensive lead forms data:", error);
      throw new Error("Failed to fetch Facebook lead forms data");
    }
  }

  /**
   * Get form statistics with caching
   */
  async getFormStats(formId, pageAccessToken, useCache = true) {
    try {
      // Try to get from cache first
      if (useCache) {
        const cachedStats = await this.cache.getCachedFacebookFormStats(formId);
        if (cachedStats) {
          return cachedStats;
        }
      }

      console.log(`📊 Calculating stats for form ${formId} from Meta API...`);
      const leads = await this.getLeadsFromForm(
        formId,
        pageAccessToken,
        100,
        false
      );

      const stats = {
        totalLeads: leads.length,
        organicLeads: leads.filter((lead) => lead.is_organic).length,
        paidLeads: leads.filter((lead) => !lead.is_organic).length,
        dailyStats: {},
        campaignBreakdown: {},
        lastUpdated: new Date().toISOString(),
      };

      // Calculate daily statistics
      leads.forEach((lead) => {
        const date = new Date(lead.created_time).toISOString().split("T")[0];
        stats.dailyStats[date] = (stats.dailyStats[date] || 0) + 1;

        if (lead.campaign_id) {
          stats.campaignBreakdown[lead.campaign_id] =
            (stats.campaignBreakdown[lead.campaign_id] || 0) + 1;
        }
      });

      // Cache the result
      if (useCache) {
        await this.cache.cacheFacebookFormStats(formId, stats);
      }

      console.log(
        `✅ Calculated stats for form ${formId}: ${stats.totalLeads} total leads`
      );
      return stats;
    } catch (error) {
      console.error(
        `❌ Error getting form stats for ${formId}:`,
        error.response?.data || error.message
      );
      return {
        totalLeads: 0,
        organicLeads: 0,
        paidLeads: 0,
        dailyStats: {},
        campaignBreakdown: {},
        lastUpdated: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  /**
   * Force refresh cache for Facebook data
   */
  async refreshCache() {
    console.log("🔄 Refreshing Facebook data cache...");

    try {
      // Invalidate all Facebook cache
      await this.cache.invalidateFacebookCache();

      // Fetch fresh data
      const freshData = await this.getAllLeadFormsData(false, false);

      // Cache the fresh data
      await this.cache.cacheFacebookLeadFormsData(freshData);

      console.log("✅ Facebook data cache refreshed successfully");
      return freshData;
    } catch (error) {
      console.error("❌ Error refreshing Facebook cache:", error);
      throw error;
    }
  }

  /**
   * Get cache status
   */
  async getCacheStatus() {
    const cacheStatus = {
      pages: !!(await this.cache.getCachedFacebookPages()),
      comprehensiveData: !!(await this.cache.getCachedFacebookLeadFormsData()),
      allLeads: !!(await this.cache.getCachedFacebookAllLeads()),
      campaigns: !!(await this.cache.getCachedFacebookCampaigns()),
    };

    return cacheStatus;
  }
}

module.exports = FacebookLeadFormsService;
