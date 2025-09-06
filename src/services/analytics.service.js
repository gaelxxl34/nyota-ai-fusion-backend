const admin = require("firebase-admin");
const logger = require("../utils/logger");
const { LeadModel } = require("../models/lead.model");
const { LEAD_STATUSES } = require("../config/lead.constants");

const db = admin.firestore();

class AnalyticsService {
  /**
   * Helper method to safely convert various date formats to Date object
   */
  safeToDate(dateField) {
    if (!dateField) {
      return new Date();
    }

    // Handle Firestore Timestamp
    if (typeof dateField.toDate === "function") {
      return dateField.toDate();
    }

    // Handle Date object
    if (dateField instanceof Date) {
      return dateField;
    }

    // Handle string or number timestamp
    if (typeof dateField === "string" || typeof dateField === "number") {
      return new Date(dateField);
    }

    // Fallback
    return new Date();
  }
  /**
   * Get funnel statistics for the new streamlined funnel
   * INTERESTED → APPLIED → IN_REVIEW → QUALIFIED → ADMITTED → ENROLLED
   */
  async getFunnelStats(timeRange, userRole = null) {
    try {
      logger.info(
        `AnalyticsService.getFunnelStats called with timeRange: ${timeRange}, userRole: ${userRole}`
      );

      const now = new Date();
      const startDate = this.getStartDate(now, timeRange);

      logger.info(
        `Date range: ${startDate.toISOString()} to ${now.toISOString()}`
      );

      // Get all leads
      const leadsSnapshot = await db.collection("leads").get();
      logger.info(`Found ${leadsSnapshot.size} leads`);

      // Define which statuses admission admin can see (new funnel)
      const admissionAdminStatuses = [
        LEAD_STATUSES.APPLIED,
        LEAD_STATUSES.IN_REVIEW,
        LEAD_STATUSES.QUALIFIED,
        LEAD_STATUSES.ADMITTED,
        LEAD_STATUSES.ENROLLED,
      ];

      // Initialize funnel counters
      const funnelCounts = {
        [LEAD_STATUSES.INTERESTED]: 0,
        [LEAD_STATUSES.APPLIED]: 0,
        [LEAD_STATUSES.MISSING_DOCUMENT]: 0,
        [LEAD_STATUSES.IN_REVIEW]: 0,
        [LEAD_STATUSES.QUALIFIED]: 0,
        [LEAD_STATUSES.ADMITTED]: 0,
        [LEAD_STATUSES.ENROLLED]: 0,
        [LEAD_STATUSES.DEFERRED]: 0,
        [LEAD_STATUSES.EXPIRED]: 0,
      };

      const timeRangeCounts = { ...funnelCounts };
      let totalLeads = 0;
      let recentLeads = 0;

      leadsSnapshot.forEach((doc) => {
        const lead = doc.data();
        const currentStatus = lead.status || LEAD_STATUSES.INTERESTED;

        // Filter for admission admin - only show specific statuses
        if (
          userRole === "admissionAdmin" &&
          !admissionAdminStatuses.includes(currentStatus)
        ) {
          return; // Skip this lead for admission admin
        }

        totalLeads++;

        // Count all time status
        if (funnelCounts.hasOwnProperty(currentStatus)) {
          funnelCounts[currentStatus]++;
        }

        // Count time range status
        const createdAt = this.safeToDate(lead.createdAt);
        if (createdAt >= startDate) {
          recentLeads++;
          if (timeRangeCounts.hasOwnProperty(currentStatus)) {
            timeRangeCounts[currentStatus]++;
          }
        }
      });

      // Calculate conversion rates
      const conversionRates = {
        interestedToApplied:
          funnelCounts[LEAD_STATUSES.INTERESTED] > 0
            ? (
                (funnelCounts[LEAD_STATUSES.APPLIED] /
                  funnelCounts[LEAD_STATUSES.INTERESTED]) *
                100
              ).toFixed(1)
            : 0,
        appliedToMissingDoc:
          funnelCounts[LEAD_STATUSES.APPLIED] > 0
            ? (
                (funnelCounts[LEAD_STATUSES.MISSING_DOCUMENT] /
                  funnelCounts[LEAD_STATUSES.APPLIED]) *
                100
              ).toFixed(1)
            : 0,
        missingDocToInReview:
          funnelCounts[LEAD_STATUSES.MISSING_DOCUMENT] > 0
            ? (
                (funnelCounts[LEAD_STATUSES.IN_REVIEW] /
                  funnelCounts[LEAD_STATUSES.MISSING_DOCUMENT]) *
                100
              ).toFixed(1)
            : 0,
        appliedToInReview:
          funnelCounts[LEAD_STATUSES.APPLIED] > 0
            ? (
                (funnelCounts[LEAD_STATUSES.IN_REVIEW] /
                  funnelCounts[LEAD_STATUSES.APPLIED]) *
                100
              ).toFixed(1)
            : 0,
        inReviewToQualified:
          funnelCounts[LEAD_STATUSES.IN_REVIEW] > 0
            ? (
                (funnelCounts[LEAD_STATUSES.QUALIFIED] /
                  funnelCounts[LEAD_STATUSES.IN_REVIEW]) *
                100
              ).toFixed(1)
            : 0,
        qualifiedToAdmitted:
          funnelCounts[LEAD_STATUSES.QUALIFIED] > 0
            ? (
                (funnelCounts[LEAD_STATUSES.ADMITTED] /
                  funnelCounts[LEAD_STATUSES.QUALIFIED]) *
                100
              ).toFixed(1)
            : 0,
        admittedToEnrolled:
          funnelCounts[LEAD_STATUSES.ADMITTED] > 0
            ? (
                (funnelCounts[LEAD_STATUSES.ENROLLED] /
                  funnelCounts[LEAD_STATUSES.ADMITTED]) *
                100
              ).toFixed(1)
            : 0,
        overallConversion:
          funnelCounts[LEAD_STATUSES.INTERESTED] > 0
            ? (
                (funnelCounts[LEAD_STATUSES.ENROLLED] /
                  funnelCounts[LEAD_STATUSES.INTERESTED]) *
                100
              ).toFixed(1)
            : 0,
      };

      const result = {
        summary: {
          totalLeads,
          recentLeads,
          timeRange,
          dateRange: {
            start: startDate.toISOString(),
            end: now.toISOString(),
          },
        },
        funnelCounts: {
          allTime: funnelCounts,
          timeRange: timeRangeCounts,
        },
        conversionRates,
        funnel: [
          {
            stage: "INTERESTED",
            count: funnelCounts[LEAD_STATUSES.INTERESTED],
            percentage: 100,
          },
          {
            stage: "APPLIED",
            count: funnelCounts[LEAD_STATUSES.APPLIED],
            percentage: conversionRates.interestedToApplied,
          },
          {
            stage: "MISSING_DOCUMENT",
            count: funnelCounts[LEAD_STATUSES.MISSING_DOCUMENT],
            percentage: conversionRates.appliedToMissingDoc,
          },
          {
            stage: "IN_REVIEW",
            count: funnelCounts[LEAD_STATUSES.IN_REVIEW],
            percentage: conversionRates.missingDocToInReview,
          },
          {
            stage: "QUALIFIED",
            count: funnelCounts[LEAD_STATUSES.QUALIFIED],
            percentage: conversionRates.inReviewToQualified,
          },
          {
            stage: "ADMITTED",
            count: funnelCounts[LEAD_STATUSES.ADMITTED],
            percentage: conversionRates.qualifiedToAdmitted,
          },
          {
            stage: "ENROLLED",
            count: funnelCounts[LEAD_STATUSES.ENROLLED],
            percentage: conversionRates.admittedToEnrolled,
          },
        ],
      };

      logger.info(`Funnel stats calculated successfully`);
      return result;
    } catch (error) {
      logger.error("Error calculating funnel stats:", error);
      throw error;
    }
  }

  /**
   * Get overview statistics for the dashboard
   */
  async getOverviewStats(timeRange, userRole = null) {
    try {
      logger.info(
        `AnalyticsService.getOverviewStats called with timeRange: ${timeRange}, userRole: ${userRole}`
      );

      const now = new Date();
      const startDate = this.getStartDate(now, timeRange);

      logger.info(
        `Date range: ${startDate.toISOString()} to ${now.toISOString()}`
      );

      // Get all leads (single organization app)
      const leadsSnapshot = await db.collection("leads").get();
      logger.info(`Found ${leadsSnapshot.size} leads`);

      // Define which statuses admission admin can see (new funnel)
      const admissionAdminStatuses = [
        "APPLIED",
        "IN_REVIEW",
        "QUALIFIED",
        "ADMITTED",
        "ENROLLED",
      ];

      // Count leads by status - updated for new funnel
      const allTimeStatusCounts = {
        INTERESTED: 0,
        APPLIED: 0,
        IN_REVIEW: 0,
        QUALIFIED: 0,
        ADMITTED: 0,
        ENROLLED: 0,
        DEFERRED: 0,
        EXPIRED: 0,
      };

      const statusCounts = {
        INTERESTED: 0,
        APPLIED: 0,
        IN_REVIEW: 0,
        QUALIFIED: 0,
        ADMITTED: 0,
        ENROLLED: 0,
        DEFERRED: 0,
        EXPIRED: 0,
      };

      const totalLeads = leadsSnapshot.size;
      let recentLeads = 0;
      let debugInfo = [];

      leadsSnapshot.forEach((doc) => {
        const lead = doc.data();

        // Get current status from status field directly (instead of timeline)
        // This ensures we use the manually updated statuses
        const currentStatus = lead.status || LEAD_STATUSES.INTERESTED;

        // Filter for admission admin - only show specific statuses
        if (
          userRole === "admissionAdmin" &&
          !admissionAdminStatuses.includes(currentStatus)
        ) {
          return; // Skip this lead for admission admin
        }

        // Count all-time status
        if (
          currentStatus &&
          allTimeStatusCounts.hasOwnProperty(currentStatus)
        ) {
          allTimeStatusCounts[currentStatus]++;
        }

        // Check if lead was created in the time range
        const timeline = lead.timeline || [];
        if (timeline.length > 0) {
          const createdDate = this.safeToDate(timeline[0].date);

          // Debug: log first few leads to see their dates
          if (debugInfo.length < 5) {
            debugInfo.push({
              leadId: doc.id,
              status: currentStatus,
              timelineDate: createdDate.toISOString(),
              isRecent: createdDate >= startDate,
            });
          }

          if (createdDate >= startDate) {
            recentLeads++;
            // Only count status if lead was created in the time range
            if (currentStatus && statusCounts.hasOwnProperty(currentStatus)) {
              statusCounts[currentStatus]++;
            }
          }
        }
      });

      // For admission admin, filter out non-relevant statuses from the response
      if (userRole === "admissionAdmin") {
        // For admission admin, completely rebuild status counts with only relevant statuses
        const filteredStatusCounts = {};
        const filteredAllTimeStatusCounts = {};

        // Only include admission-relevant statuses
        admissionAdminStatuses.forEach((status) => {
          filteredStatusCounts[status] = statusCounts[status] || 0;
          filteredAllTimeStatusCounts[status] =
            allTimeStatusCounts[status] || 0;
        });

        // Replace the original counts with filtered versions
        Object.keys(statusCounts).forEach((key) => delete statusCounts[key]);
        Object.keys(allTimeStatusCounts).forEach(
          (key) => delete allTimeStatusCounts[key]
        );

        Object.assign(statusCounts, filteredStatusCounts);
        Object.assign(allTimeStatusCounts, filteredAllTimeStatusCounts);
      }

      // Log debug info for daily view
      if (timeRange === "daily" && debugInfo.length > 0) {
        logger.info("Sample leads timeline dates:", debugInfo);
      }

      // Calculate previous period for comparison
      const previousStartDate = this.getPreviousStartDate(startDate, timeRange);
      let previousPeriodLeads = 0;

      leadsSnapshot.forEach((doc) => {
        const lead = doc.data();

        // Apply same role filtering for previous period
        const currentStatus = lead.status || LEAD_STATUSES.INTERESTED;
        if (
          userRole === "admissionAdmin" &&
          !admissionAdminStatuses.includes(currentStatus)
        ) {
          return;
        }

        // Use the date from the first timeline entry (when lead was created)
        const timeline = lead.timeline || [];
        if (timeline.length > 0) {
          const createdDate = this.safeToDate(timeline[0].date);
          if (createdDate >= previousStartDate && createdDate < startDate) {
            previousPeriodLeads++;
          }
        }
      });

      // Calculate percentage change
      const change =
        previousPeriodLeads > 0
          ? ((recentLeads - previousPeriodLeads) / previousPeriodLeads) * 100
          : 0;

      return {
        statusCounts,
        totalLeads,
        recentLeads,
        change: change.toFixed(1),
        timeRange,
        period: {
          start: startDate.toISOString(),
          end: now.toISOString(),
        },
      };
    } catch (error) {
      logger.error("Error getting overview stats:", error);
      throw error;
    }
  }

  /**
   * Get lead progression data over time
   */
  async getLeadProgression(timeRange, userRole = null) {
    try {
      const now = new Date();
      const startDate = this.getStartDate(now, timeRange);

      // Get all leads (single organization app)
      const leadsSnapshot = await db.collection("leads").get();

      // Define which statuses admission admin can see
      const admissionAdminStatuses = [
        "APPLIED",
        "QUALIFIED",
        "ADMITTED",
        "ENROLLED",
      ];

      // Group data by time period
      const progressionData = [];
      const periods = this.getTimePeriods(startDate, now, timeRange);

      for (const period of periods) {
        const periodData = {
          date: period.label,
        };

        // For admission admin, only include relevant fields
        if (userRole === "admissionAdmin") {
          periodData.applied = 0;
          periodData.qualified = 0;
          periodData.admitted = 0;
          periodData.enrolled = 0;
        } else {
          // For other roles, include all fields
          periodData.contacted = 0;
          periodData.preQualified = 0;
          periodData.applied = 0;
          periodData.qualified = 0;
          periodData.admitted = 0;
          periodData.enrolled = 0;
        }

        // Count leads by status for this period
        leadsSnapshot.forEach((doc) => {
          const lead = doc.data();

          // Get current status from status field
          const currentStatus = lead.status || LEAD_STATUSES.INTERESTED;

          // Filter for admission admin - only show specific statuses
          if (
            userRole === "admissionAdmin" &&
            !admissionAdminStatuses.includes(currentStatus)
          ) {
            return; // Skip this lead for admission admin
          }

          const statusHistory = lead.statusHistory || [];

          // Check if lead reached each status during this period
          statusHistory.forEach((history) => {
            const changeDate = this.safeToDate(history.timestamp);
            if (changeDate >= period.start && changeDate <= period.end) {
              // For admission admin, only track admission-relevant statuses
              if (userRole === "admissionAdmin") {
                switch (history.status) {
                  case "APPLIED":
                    periodData.applied++;
                    break;
                  case "QUALIFIED":
                    periodData.qualified++;
                    break;
                  case "ADMITTED":
                    periodData.admitted++;
                    break;
                  case "ENROLLED":
                    periodData.enrolled++;
                    break;
                }
              } else {
                // For other roles, track all statuses
                switch (history.status) {
                  case "CONTACTED":
                    periodData.contacted++;
                    break;
                  case "PRE_QUALIFIED":
                    periodData.preQualified++;
                    break;
                  case "APPLIED":
                    periodData.applied++;
                    break;
                  case "QUALIFIED":
                    periodData.qualified++;
                    break;
                  case "ADMITTED":
                    periodData.admitted++;
                    break;
                  case "ENROLLED":
                    periodData.enrolled++;
                    break;
                }
              }
            }
          });
        });

        progressionData.push(periodData);
      }

      return progressionData;
    } catch (error) {
      logger.error("Error getting lead progression:", error);
      throw error;
    }
  }

  /**
   * Get agent performance metrics
   */
  async getAgentPerformance(timeRange, userRole) {
    try {
      const now = new Date();
      const startDate = this.getStartDate(now, timeRange);

      logger.info(
        `[Agent Performance] Time range: ${timeRange}, Start date: ${startDate.toISOString()}`
      );

      // Get all users (single organization app)
      const usersSnapshot = await db.collection("users").get();
      logger.info(
        `[Agent Performance] Found ${usersSnapshot.size} total users`
      );

      // Get all leads
      const leadsSnapshot = await db.collection("leads").get();
      logger.info(
        `[Agent Performance] Found ${leadsSnapshot.size} total leads`
      );

      const agentPerformance = [];

      // First, let's check if any leads have submittedBy data
      let leadsWithSubmittedBy = 0;
      let submittedByExamples = [];

      leadsSnapshot.forEach((leadDoc) => {
        const lead = leadDoc.data();
        if (lead.submittedBy) {
          leadsWithSubmittedBy++;
          if (submittedByExamples.length < 3) {
            submittedByExamples.push({
              leadId: leadDoc.id,
              submittedBy: lead.submittedBy,
              status: lead.status || LEAD_STATUSES.INTERESTED,
            });
          }
        }
      });

      logger.info(
        `[Agent Performance] Leads with submittedBy: ${leadsWithSubmittedBy} out of ${leadsSnapshot.size}`
      );
      if (submittedByExamples.length > 0) {
        logger.info(
          `[Agent Performance] Example submittedBy data:`,
          submittedByExamples
        );
      }

      // Process each agent
      for (const userDoc of usersSnapshot.docs) {
        const user = userDoc.data();
        const userId = userDoc.id;

        // Log user details
        logger.info(
          `[Agent Performance] Processing user: ${user.email}, role: ${user.role}, userId: ${userId}`
        );

        // Skip if user is not an agent (exclude admin and superAdmin from agent performance)
        if (!["marketingAgent", "admissionAgent"].includes(user.role)) {
          continue;
        }

        // Filter based on requesting user's role
        if (userRole === "marketingAgent" && user.role === "admissionAgent") {
          continue; // Marketing agents can't see admission agents' data
        }
        if (userRole === "admissionAgent" && user.role === "marketingAgent") {
          continue; // Admission agents can't see marketing agents' data
        }
        if (userRole === "admissionAdmin" && user.role === "marketingAgent") {
          continue; // Admission admins can't see marketing agents' data
        }
        // Admins and superAdmins can see all agent data but are not included in the report

        const metrics = {
          id: userId,
          name: user.displayName || user.email,
          email: user.email,
          role: user.role,
          leadsSubmitted: 0,
          contacted: 0,
          preQualified: 0,
          applied: 0,
          qualified: 0,
          enrolled: 0,
          conversionRate: 0,
        };

        // Count leads and their progression
        leadsSnapshot.forEach((leadDoc) => {
          const lead = leadDoc.data();

          // Get current status and apply admission admin filtering
          const currentStatus = lead.status || LEAD_STATUSES.INTERESTED;
          const admissionAdminStatuses = [
            "APPLIED",
            "QUALIFIED",
            "ADMITTED",
            "ENROLLED",
          ];

          // Filter for admission admin - only show specific statuses
          if (
            userRole === "admissionAdmin" &&
            !admissionAdminStatuses.includes(currentStatus)
          ) {
            return; // Skip this lead for admission admin
          }

          // Check if this lead was submitted by this user
          // submittedBy is stored at the top level of the lead
          // submittedBy contains email, not uid
          const submittedByEmail = lead.submittedBy?.email;

          if (submittedByEmail === user.email) {
            // Also check if lead was created within the time range
            // Use the date from the first timeline entry
            const timeline = lead.timeline || [];
            if (timeline.length > 0) {
              const createdDate = this.safeToDate(timeline[0].date);
              if (createdDate >= startDate) {
                metrics.leadsSubmitted++;
                logger.info(
                  `[Agent Performance] Found lead submitted by ${user.email}: ${leadDoc.id}, status: ${currentStatus}`
                );

                // Track status progression
                switch (currentStatus) {
                  case "CONTACTED":
                    metrics.contacted++;
                    break;
                  case "PRE_QUALIFIED":
                    metrics.contacted++;
                    metrics.preQualified++;
                    break;
                  case "APPLIED":
                    metrics.contacted++;
                    metrics.preQualified++;
                    metrics.applied++;
                    break;
                  case "QUALIFIED":
                    metrics.contacted++;
                    metrics.preQualified++;
                    metrics.applied++;
                    metrics.qualified++;
                    break;
                  case "ENROLLED":
                    metrics.contacted++;
                    metrics.preQualified++;
                    metrics.applied++;
                    metrics.qualified++;
                    metrics.enrolled++;
                    break;
                }
              }
            }
          }
        });

        // Calculate conversion rate
        if (metrics.leadsSubmitted > 0) {
          metrics.conversionRate = (
            (metrics.enrolled / metrics.leadsSubmitted) *
            100
          ).toFixed(1);
        }

        agentPerformance.push(metrics);
      }

      // Sort by number of leads submitted
      agentPerformance.sort((a, b) => b.leadsSubmitted - a.leadsSubmitted);

      return agentPerformance;
    } catch (error) {
      logger.error("Error getting agent performance:", error);
      throw error;
    }
  }

  /**
   * Get conversion rates between stages
   */
  async getConversionRates(timeRange, userRole = null) {
    try {
      const overview = await this.getOverviewStats(timeRange, userRole);
      const counts = overview.statusCounts;

      const rates = {};

      // For admission admin, only calculate admission-relevant conversion rates
      if (userRole === "admissionAdmin") {
        rates.appliedToQualified = 0;
        rates.qualifiedToAdmitted = 0;
        rates.admittedToEnrolled = 0;
        rates.overallAdmissionConversion = 0;

        if (counts.APPLIED > 0) {
          rates.appliedToQualified = (
            (counts.QUALIFIED / counts.APPLIED) *
            100
          ).toFixed(1);
        }

        if (counts.QUALIFIED > 0) {
          rates.qualifiedToAdmitted = (
            (counts.ADMITTED / counts.QUALIFIED) *
            100
          ).toFixed(1);
        }

        if (counts.ADMITTED > 0) {
          rates.admittedToEnrolled = (
            (counts.ENROLLED / counts.ADMITTED) *
            100
          ).toFixed(1);
        }

        // Overall admission conversion from applied to enrolled
        if (counts.APPLIED > 0) {
          rates.overallAdmissionConversion = (
            (counts.ENROLLED / counts.APPLIED) *
            100
          ).toFixed(1);
        }
      } else {
        // For other roles, calculate all conversion rates
        rates.contactedToPreQualified = 0;
        rates.preQualifiedToApplied = 0;
        rates.appliedToQualified = 0;
        rates.qualifiedToEnrolled = 0;
        rates.overallConversion = 0;

        // Calculate stage-to-stage conversion rates
        if (counts.CONTACTED > 0) {
          rates.contactedToPreQualified = (
            (counts.PRE_QUALIFIED / counts.CONTACTED) *
            100
          ).toFixed(1);
        }

        if (counts.PRE_QUALIFIED > 0) {
          rates.preQualifiedToApplied = (
            (counts.APPLIED / counts.PRE_QUALIFIED) *
            100
          ).toFixed(1);
        }

        if (counts.APPLIED > 0) {
          rates.appliedToQualified = (
            (counts.QUALIFIED / counts.APPLIED) *
            100
          ).toFixed(1);
        }

        if (counts.QUALIFIED > 0) {
          rates.qualifiedToEnrolled = (
            (counts.ENROLLED / counts.QUALIFIED) *
            100
          ).toFixed(1);
        }

        // Overall conversion from first contact to enrollment
        const totalInitial = counts.INQUIRY + counts.CONTACTED;
        if (totalInitial > 0) {
          rates.overallConversion = (
            (counts.ENROLLED / totalInitial) *
            100
          ).toFixed(1);
        }
      }

      return {
        rates,
        counts,
        timeRange,
      };
    } catch (error) {
      logger.error("Error calculating conversion rates:", error);
      throw error;
    }
  }

  /**
   * Export analytics data in specified format
   */
  async exportAnalyticsData(timeRange, format, userRole) {
    try {
      // Gather all analytics data
      const [overview, progression, performance, rates] = await Promise.all([
        this.getOverviewStats(timeRange, userRole),
        this.getLeadProgression(timeRange, userRole),
        this.getAgentPerformance(timeRange, userRole),
        this.getConversionRates(timeRange, userRole),
      ]);

      if (format === "csv") {
        // Generate CSV format with better structure
        let csv = "NYOTA AI FUSION - ANALYTICS REPORT\n";
        csv += "=".repeat(50) + "\n";
        csv += `Report Generated: ${new Date().toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}\n`;
        csv += `Time Range: ${
          timeRange.charAt(0).toUpperCase() + timeRange.slice(1)
        }\n`;
        csv += `Period: ${new Date(
          overview.period.start
        ).toLocaleDateString()} - ${new Date(
          overview.period.end
        ).toLocaleDateString()}\n`;
        csv += "=".repeat(50) + "\n\n";

        // Summary Statistics
        csv += "SUMMARY STATISTICS\n";
        csv += "-".repeat(30) + "\n";
        csv += `Total Leads,${overview.totalLeads}\n`;
        csv += `Leads in Period,${overview.recentLeads}\n`;
        csv += `Change from Previous Period,${overview.change}%\n`;
        csv += "\n";

        // Status Overview
        csv += "LEAD STATUS BREAKDOWN\n";
        csv += "-".repeat(30) + "\n";
        csv += "Status,Count,Percentage\n";
        const totalForPercentage = overview.totalLeads || 1;
        Object.entries(overview.statusCounts).forEach(([status, count]) => {
          const percentage = ((count / totalForPercentage) * 100).toFixed(1);
          csv += `${status.replace(/_/g, " ")},${count},${percentage}%\n`;
        });
        csv += `TOTAL,${overview.totalLeads},100.0%\n`;
        csv += "\n";

        // Conversion Funnel
        csv += "CONVERSION FUNNEL\n";
        csv += "-".repeat(30) + "\n";
        csv += "Stage Transition,Conversion Rate\n";

        if (userRole === "admissionAdmin") {
          // Admission admin only sees admission-relevant conversions
          csv += `Applied → Qualified,${rates.rates.appliedToQualified}%\n`;
          csv += `Qualified → Admitted,${rates.rates.qualifiedToAdmitted}%\n`;
          csv += `Admitted → Enrolled,${rates.rates.admittedToEnrolled}%\n`;
          csv += `Overall Admission (Applied → Enrolled),${rates.rates.overallAdmissionConversion}%\n`;
        } else {
          // Other roles see full conversion funnel
          csv += `Contacted → Pre-Qualified,${rates.rates.contactedToPreQualified}%\n`;
          csv += `Pre-Qualified → Applied,${rates.rates.preQualifiedToApplied}%\n`;
          csv += `Applied → Qualified,${rates.rates.appliedToQualified}%\n`;
          csv += `Qualified → Enrolled,${rates.rates.qualifiedToEnrolled}%\n`;
          csv += `Overall (Inquiry → Enrolled),${rates.rates.overallConversion}%\n`;
        }
        csv += "\n";

        // Lead Progression Over Time
        if (progression.length > 0) {
          csv += "LEAD PROGRESSION OVER TIME\n";
          csv += "-".repeat(30) + "\n";

          if (userRole === "admissionAdmin") {
            // Admission admin only sees admission-relevant columns
            csv += "Period,Applied,Qualified,Admitted,Enrolled\n";
            progression.forEach((period) => {
              csv += `${period.date},${period.applied || 0},${
                period.qualified || 0
              },${period.admitted || 0},${period.enrolled || 0}\n`;
            });
          } else {
            // Other roles see all columns
            csv +=
              "Period,Contacted,Pre-Qualified,Applied,Qualified,Admitted,Enrolled\n";
            progression.forEach((period) => {
              csv += `${period.date},${period.contacted || 0},${
                period.preQualified || 0
              },${period.applied || 0},${period.qualified || 0},${
                period.admitted || 0
              },${period.enrolled || 0}\n`;
            });
          }
          csv += "\n";
        }

        // Agent Performance
        csv += "AGENT PERFORMANCE REPORT\n";
        csv += "-".repeat(30) + "\n";
        csv +=
          "Name,Email,Role,Leads Submitted,Contacted,Pre-Qualified,Applied,Qualified,Enrolled,Conversion Rate\n";

        if (performance.length > 0) {
          performance.forEach((agent) => {
            let roleDisplay = agent.role;
            if (agent.role === "marketingAgent")
              roleDisplay = "Marketing Agent";
            else if (agent.role === "admissionsAgent")
              roleDisplay = "Admissions Agent";
            else if (agent.role === "admin") roleDisplay = "Admin";
            else if (agent.role === "admissionAdmin")
              roleDisplay = "Admission Admin";
            else if (agent.role === "superAdmin") roleDisplay = "Super Admin";

            csv += `${agent.name},${agent.email},${roleDisplay},`;
            csv += `${agent.leadsSubmitted},${agent.contacted},${agent.preQualified},${agent.applied},`;
            csv += `${agent.qualified},${agent.enrolled},${agent.conversionRate}%\n`;
          });

          // Add totals row
          const totals = performance.reduce(
            (acc, agent) => ({
              leadsSubmitted: acc.leadsSubmitted + agent.leadsSubmitted,
              contacted: acc.contacted + agent.contacted,
              preQualified: acc.preQualified + agent.preQualified,
              applied: acc.applied + agent.applied,
              qualified: acc.qualified + agent.qualified,
              enrolled: acc.enrolled + agent.enrolled,
            }),
            {
              leadsSubmitted: 0,
              contacted: 0,
              preQualified: 0,
              applied: 0,
              qualified: 0,
              enrolled: 0,
            }
          );

          const avgConversion =
            totals.leadsSubmitted > 0
              ? ((totals.enrolled / totals.leadsSubmitted) * 100).toFixed(1)
              : "0.0";

          csv += "-".repeat(80) + "\n";
          csv += `TOTAL,,,${totals.leadsSubmitted},${totals.contacted},${totals.preQualified},`;
          csv += `${totals.applied},${totals.qualified},${totals.enrolled},${avgConversion}%\n`;
        } else {
          csv += "No agent data available for this period\n";
        }
        csv += "\n";

        // Footer
        csv += "=".repeat(50) + "\n";
        csv += "End of Report\n";

        return csv;
      } else {
        // Return JSON format
        return {
          overview,
          progression,
          performance,
          conversionRates: rates,
          exportDate: new Date().toISOString(),
        };
      }
    } catch (error) {
      logger.error("Error exporting analytics data:", error);
      throw error;
    }
  }

  /**
   * Get comprehensive admission dashboard data
   * Combines KPIs, real-time pipeline, and program analytics
   */
  async getAdmissionDashboardData(timeRange, userRole) {
    try {
      logger.info(
        `Getting admission dashboard data for timeRange: ${timeRange}, userRole: ${userRole}`
      );

      const now = new Date();
      const startDate = this.getStartDate(now, timeRange);

      // Get all applications and leads
      const [applicationsSnapshot, leadsSnapshot] = await Promise.all([
        db.collection("applications").get(),
        db.collection("leads").get(),
      ]);

      logger.info(
        `Found ${applicationsSnapshot.size} applications and ${leadsSnapshot.size} leads`
      );

      // 1. Key Performance Indicators
      const kpis = await this.getAdmissionKPIs(
        applicationsSnapshot,
        leadsSnapshot,
        startDate,
        now,
        timeRange
      );

      // 2. Real-time Application Pipeline
      const pipeline = await this.getApplicationPipeline(
        applicationsSnapshot,
        leadsSnapshot,
        startDate
      );

      // 3. Program-Specific Analytics
      const programAnalytics = await this.getProgramAnalytics(
        applicationsSnapshot,
        leadsSnapshot
      );

      return {
        kpis,
        pipeline,
        programAnalytics,
        timeRange,
        period: {
          start: startDate.toISOString(),
          end: now.toISOString(),
        },
        lastUpdated: now.toISOString(),
      };
    } catch (error) {
      logger.error("Error getting admission dashboard data:", error);
      throw error;
    }
  }

  /**
   * Get admission-specific KPIs
   */
  async getAdmissionKPIs(
    applicationsSnapshot,
    leadsSnapshot,
    startDate,
    endDate,
    timeRange
  ) {
    try {
      const admissionStatuses = [
        "APPLIED",
        "MISSING_DOCUMENT",
        "IN_REVIEW",
        "QUALIFIED",
        "ADMITTED",
        "ENROLLED",
        "DEFERRED",
        "EXPIRED",
      ];

      // Initialize counters
      const statusCounts = {
        total: 0,
        applied: 0,
        missingDocument: 0,
        inReview: 0,
        qualified: 0,
        admitted: 0,
        enrolled: 0,
        deferred: 0,
        expired: 0,
      };

      const timeRangeCounts = { ...statusCounts };
      const previousPeriodCounts = { ...statusCounts };

      // Calculate previous period
      const previousStartDate = this.getPreviousStartDate(startDate, timeRange);

      // Process leads for admission pipeline
      leadsSnapshot.forEach((doc) => {
        const lead = doc.data();
        const currentStatus = lead.status || LEAD_STATUSES.INTERESTED;

        // Only count admission-relevant statuses
        if (!admissionStatuses.includes(currentStatus)) {
          return;
        }

        statusCounts.total++;

        // Map statuses to our KPI structure
        switch (currentStatus) {
          case "APPLIED":
            statusCounts.applied++;
            break;
          case "MISSING_DOCUMENT":
            statusCounts.missingDocument++;
            break;
          case "IN_REVIEW":
            statusCounts.inReview++;
            break;
          case "QUALIFIED":
            statusCounts.qualified++;
            break;
          case "ADMITTED":
            statusCounts.admitted++;
            break;
          case "ENROLLED":
            statusCounts.enrolled++;
            break;
          case "DEFERRED":
            statusCounts.deferred++;
            break;
          case "EXPIRED":
            statusCounts.expired++;
            break;
        }

        // Check if lead was created in current time range
        let createdAt;
        if (lead.createdAt) {
          createdAt = this.safeToDate(lead.createdAt);
        } else {
          // No createdAt field, use current date
          createdAt = new Date();
        }

        if (createdAt >= startDate && createdAt <= endDate) {
          timeRangeCounts.total++;
          switch (currentStatus) {
            case "APPLIED":
              timeRangeCounts.applied++;
              break;
            case "MISSING_DOCUMENT":
              timeRangeCounts.missingDocument++;
              break;
            case "IN_REVIEW":
              timeRangeCounts.inReview++;
              break;
            case "QUALIFIED":
              timeRangeCounts.qualified++;
              break;
            case "ADMITTED":
              timeRangeCounts.admitted++;
              break;
            case "ENROLLED":
              timeRangeCounts.enrolled++;
              break;
            case "DEFERRED":
              timeRangeCounts.deferred++;
              break;
            case "EXPIRED":
              timeRangeCounts.expired++;
              break;
          }
        }

        // Check if lead was created in previous period
        if (createdAt >= previousStartDate && createdAt < startDate) {
          previousPeriodCounts.total++;
          switch (currentStatus) {
            case "APPLIED":
              previousPeriodCounts.applied++;
              break;
            case "MISSING_DOCUMENT":
              previousPeriodCounts.missingDocument++;
              break;
            case "IN_REVIEW":
              previousPeriodCounts.inReview++;
              break;
            case "QUALIFIED":
              previousPeriodCounts.qualified++;
              break;
            case "ADMITTED":
              previousPeriodCounts.admitted++;
              break;
            case "ENROLLED":
              previousPeriodCounts.enrolled++;
              break;
            case "DEFERRED":
              previousPeriodCounts.deferred++;
              break;
            case "EXPIRED":
              previousPeriodCounts.expired++;
              break;
          }
        }
      });

      // Calculate conversion rates
      const conversionRate =
        statusCounts.applied > 0
          ? ((statusCounts.enrolled / statusCounts.applied) * 100).toFixed(1)
          : 0;

      // Calculate trends
      const trends = {
        applications: this.calculateTrend(
          timeRangeCounts.applied,
          previousPeriodCounts.applied
        ),
        admissions: this.calculateTrend(
          timeRangeCounts.admitted,
          previousPeriodCounts.admitted
        ),
        enrollments: this.calculateTrend(
          timeRangeCounts.enrolled,
          previousPeriodCounts.enrolled
        ),
      };

      // Calculate average processing time (mock for now - would need timeline analysis)
      const avgProcessingTime = "3-5 days"; // TODO: Calculate from actual data

      return {
        totalApplications: statusCounts.applied,
        pendingReview: statusCounts.inReview,
        missingDocument: statusCounts.missingDocument,
        qualified: statusCounts.qualified,
        admitted: statusCounts.admitted,
        enrolled: statusCounts.enrolled,
        deferred: statusCounts.deferred,
        expired: statusCounts.expired,
        conversionRate: parseFloat(conversionRate),
        avgProcessingTime,
        trends,
        periodCounts: timeRangeCounts,
        previousPeriodCounts,
        statusDistribution: {
          applied: statusCounts.applied,
          missingDocument: statusCounts.missingDocument,
          inReview: statusCounts.inReview,
          qualified: statusCounts.qualified,
          admitted: statusCounts.admitted,
          enrolled: statusCounts.enrolled,
          deferred: statusCounts.deferred,
          expired: statusCounts.expired,
        },
      };
    } catch (error) {
      logger.error("Error calculating admission KPIs:", error);
      throw error;
    }
  }

  /**
   * Get real-time application pipeline data
   */
  async getApplicationPipeline(applicationsSnapshot, leadsSnapshot, startDate) {
    try {
      const pipeline = {
        urgent: [],
        recentApplications: [],
        missingDocuments: [],
        approachingDeadlines: [],
        readyForReview: [],
      };

      const now = new Date();
      const last48Hours = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Process applications
      applicationsSnapshot.forEach((doc) => {
        const application = doc.data();
        const appId = doc.id;

        // Recent applications (last 48 hours)
        const createdAt = this.safeToDate(application.createdAt);
        if (createdAt >= last48Hours) {
          pipeline.recentApplications.push({
            id: appId,
            name: application.name,
            program: application.preferredProgram,
            submittedAt: createdAt.toISOString(),
            status: application.status || "APPLIED",
          });
        }

        // Missing documents
        const missingDocs = [];
        if (!application.passportPhoto) missingDocs.push("Passport Photo");
        if (
          !application.academicDocuments ||
          application.academicDocuments.length === 0
        ) {
          missingDocs.push("Academic Documents");
        }
        if (!application.identificationDocument)
          missingDocs.push("ID Document");

        if (missingDocs.length > 0) {
          pipeline.missingDocuments.push({
            id: appId,
            name: application.name,
            program: application.preferredProgram,
            missingDocs,
            daysSinceApplication: Math.floor(
              (now - createdAt) / (1000 * 60 * 60 * 24)
            ),
          });
        }

        // Ready for review (all documents present, status is APPLIED)
        if (
          application.status === "APPLIED" &&
          application.passportPhoto &&
          application.academicDocuments &&
          application.academicDocuments.length > 0 &&
          application.identificationDocument &&
          missingDocs.length === 0
        ) {
          pipeline.readyForReview.push({
            id: appId,
            name: application.name,
            program: application.preferredProgram,
            submittedAt: createdAt.toISOString(),
            daysSinceReady: Math.floor(
              (now - createdAt) / (1000 * 60 * 60 * 24)
            ),
          });
        }

        // Urgent items (applications stuck in review for > 7 days)
        if (
          application.status === "IN_REVIEW" &&
          Math.floor((now - createdAt) / (1000 * 60 * 60 * 24)) > 7
        ) {
          pipeline.urgent.push({
            id: appId,
            name: application.name,
            program: application.preferredProgram,
            reason: "In review for over 7 days",
            daysSinceReview: Math.floor(
              (now - createdAt) / (1000 * 60 * 60 * 24)
            ),
          });
        }
      });

      // Sort by priority/recency
      pipeline.recentApplications.sort(
        (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
      );
      pipeline.missingDocuments.sort(
        (a, b) => b.daysSinceApplication - a.daysSinceApplication
      );
      pipeline.readyForReview.sort(
        (a, b) => b.daysSinceReady - a.daysSinceReady
      );
      pipeline.urgent.sort((a, b) => b.daysSinceReview - a.daysSinceReview);

      // Limit results to most relevant
      pipeline.recentApplications = pipeline.recentApplications.slice(0, 10);
      pipeline.missingDocuments = pipeline.missingDocuments.slice(0, 10);
      pipeline.readyForReview = pipeline.readyForReview.slice(0, 10);
      pipeline.urgent = pipeline.urgent.slice(0, 10);

      return pipeline;
    } catch (error) {
      logger.error("Error getting application pipeline:", error);
      throw error;
    }
  }

  /**
   * Get program-specific analytics based on leads (not applications)
   */
  async getProgramAnalytics(applicationsSnapshot, leadsSnapshot) {
    try {
      const programStats = {};
      const programNames = {
        bachelor_information_technology: "Bachelor of Information Technology",
        bachelor_business_administration: "Bachelor of Business Administration",
        bachelor_commerce: "Bachelor of Commerce",
        master_information_technology: "Master of Information Technology",
        master_business_administration: "Master of Business Administration",
        diploma_information_technology: "Diploma in Information Technology",
        diploma_business_administration: "Diploma in Business Administration",
        certificate_programs: "Certificate Programs",
      };

      // Initialize program stats for known programs
      Object.keys(programNames).forEach((programCode) => {
        programStats[programCode] = {
          name: programNames[programCode],
          code: programCode,
          applications: 0,
          admitted: 0,
          enrolled: 0,
          conversionRate: 0,
          avgProcessingTime: 0,
          studyModes: {
            online: 0,
            onCampus: 0,
          },
          demographics: {
            male: 0,
            female: 0,
            other: 0,
          },
          intakeDistribution: {
            january: 0,
            may: 0,
            august: 0,
          },
        };
      });

      // Process leads for program analytics (using status field)
      leadsSnapshot.forEach((doc) => {
        const lead = doc.data();
        const leadStatus = lead.status || LEAD_STATUSES.INTERESTED;

        // Get program - handle both string and object formats
        let program = lead.program;
        if (typeof program === "object" && program !== null) {
          // If program is an object, try to get a meaningful string
          program = program.name || program.title || program.code || "unknown";
        }

        // Normalize program names to match our programNames mapping
        const normalizedProgram = this.normalizeProgramName(program);

        if (normalizedProgram && programStats[normalizedProgram]) {
          // Count all leads as "applications" for this program
          programStats[normalizedProgram].applications++;

          // Count by lead status (not application status)
          if (leadStatus === LEAD_STATUSES.ADMITTED) {
            programStats[normalizedProgram].admitted++;
          }
          if (leadStatus === LEAD_STATUSES.ENROLLED) {
            programStats[normalizedProgram].enrolled++;
          }

          // Try to get additional info from corresponding application
          try {
            // This could be enhanced to match lead with application
            // For now, we'll use basic counting
          } catch (error) {
            // Continue without application data
          }
        } else if (program && program !== "unknown") {
          // Create entry for unknown programs
          const programKey = program.toLowerCase().replace(/\s+/g, "_");
          if (!programStats[programKey]) {
            programStats[programKey] = {
              name: program,
              code: programKey,
              applications: 0,
              admitted: 0,
              enrolled: 0,
              conversionRate: 0,
              avgProcessingTime: 0,
              studyModes: { online: 0, onCampus: 0 },
              demographics: { male: 0, female: 0, other: 0 },
              intakeDistribution: { january: 0, may: 0, august: 0 },
            };
          }

          programStats[programKey].applications++;
          if (leadStatus === LEAD_STATUSES.ADMITTED) {
            programStats[programKey].admitted++;
          }
          if (leadStatus === LEAD_STATUSES.ENROLLED) {
            programStats[programKey].enrolled++;
          }
        }
      });

      // Calculate conversion rates and format data
      const programAnalytics = Object.values(programStats)
        .filter((program) => program.applications > 0) // Only include programs with actual data
        .map((program) => ({
          ...program,
          conversionRate:
            program.applications > 0
              ? ((program.admitted / program.applications) * 100).toFixed(1)
              : 0,
        }))
        .sort((a, b) => b.applications - a.applications); // Sort by application count

      return programAnalytics;
    } catch (error) {
      logger.error("Error calculating program analytics:", error);
      return [];
    }
  }

  /**
   * Normalize program names to match our standard format
   */
  normalizeProgramName(program) {
    if (!program || typeof program !== "string") return null;

    const normalizations = {
      "bachelor of information technology": "bachelor_information_technology",
      "bachelor of business administration": "bachelor_business_administration",
      "bachelor of commerce": "bachelor_commerce",
      "master of information technology": "master_information_technology",
      "master of business administration": "master_business_administration",
      "diploma in information technology": "diploma_information_technology",
      "diploma in business administration": "diploma_business_administration",
    };

    const normalized = program.toLowerCase().trim();
    return normalizations[normalized] || null;
  }

  /**
          avgProcessingTime: "3-5 days", // TODO: Calculate from actual timeline data
        }))
        .filter((program) => program.applications > 0) // Only include programs with applications
        .sort((a, b) => b.applications - a.applications); // Sort by popularity

      return {
        programs: programAnalytics,
        totalPrograms: programAnalytics.length,
        mostPopular: programAnalytics[0] || null,
        summary: {
          totalApplications: programAnalytics.reduce(
            (sum, p) => sum + p.applications,
            0
          ),
          totalAdmitted: programAnalytics.reduce(
            (sum, p) => sum + p.admitted,
            0
          ),
          totalEnrolled: programAnalytics.reduce(
            (sum, p) => sum + p.enrolled,
            0
          ),
          overallConversion:
            programAnalytics.length > 0
              ? (
                  programAnalytics.reduce(
                    (sum, p) => sum + parseFloat(p.conversionRate),
                    0
                  ) / programAnalytics.length
                ).toFixed(1)
              : 0,
        },
      };
    } catch (error) {
      logger.error("Error getting program analytics:", error);
      throw error;
    }
  }

  /**
   * Helper method to calculate trend percentage
   */
  calculateTrend(current, previous) {
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }
    return (((current - previous) / previous) * 100).toFixed(1);
  }

  /**
   * Helper method to get start date based on time range
   */
  getStartDate(now, timeRange) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0); // Start of the day

    switch (timeRange) {
      case "daily":
        // For daily view, show today's data only
        // date is already set to start of today
        break;
      case "weekly":
        // For weekly view, show this week's data (Sunday to Saturday)
        const dayOfWeek = date.getDay();
        date.setDate(date.getDate() - dayOfWeek); // Go to Sunday
        break;
      case "monthly":
        // For monthly view, show this month's data
        date.setDate(1); // First day of current month
        break;
      case "previous_month":
        // For previous month view, show last month's data
        date.setDate(1); // First day of current month
        date.setMonth(date.getMonth() - 1); // Go to previous month
        break;
      case "all_time":
        // For all time view, start from a very early date
        date.setFullYear(2020, 0, 1); // January 1, 2020
        break;
      default:
        // Default to today
        break;
    }
    return date;
  }

  /**
   * Helper method to get previous period start date
   */
  getPreviousStartDate(currentStartDate, timeRange) {
    const date = new Date(currentStartDate);

    switch (timeRange) {
      case "daily":
        // For daily comparison, compare with yesterday
        date.setDate(date.getDate() - 1);
        break;
      case "weekly":
        // For weekly comparison, compare with last week
        date.setDate(date.getDate() - 7);
        break;
      case "monthly":
        // For monthly comparison, compare with last month
        date.setMonth(date.getMonth() - 1);
        break;
      case "previous_month":
        // For previous month comparison, compare with two months ago
        date.setMonth(date.getMonth() - 1);
        break;
      case "all_time":
        // For all time, there's no meaningful "previous" period
        // Return a very early date
        date.setFullYear(2019, 0, 1); // January 1, 2019
        break;
    }
    return date;
  }

  /**
   * Helper method to generate time periods for grouping
   */
  getTimePeriods(startDate, endDate, timeRange) {
    const periods = [];
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);

    switch (timeRange) {
      case "daily":
        // For daily view, show hourly breakdown for today
        for (let hour = 0; hour < 24; hour++) {
          const periodStart = new Date(current);
          periodStart.setHours(hour, 0, 0, 0);

          const periodEnd = new Date(current);
          periodEnd.setHours(hour + 1, 0, 0, 0);

          if (periodStart <= endDate) {
            periods.push({
              start: periodStart,
              end: periodEnd,
              label: periodStart.toLocaleTimeString("en-US", {
                hour: "numeric",
                hour12: true,
              }),
            });
          }
        }
        break;

      case "weekly":
        // For weekly view, show daily breakdown for this week
        while (current <= endDate) {
          const periodStart = new Date(current);
          periodStart.setHours(0, 0, 0, 0);

          const periodEnd = new Date(current);
          periodEnd.setHours(23, 59, 59, 999);

          periods.push({
            start: periodStart,
            end: periodEnd,
            label: current.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            }),
          });

          current.setDate(current.getDate() + 1);
        }
        break;

      case "monthly":
        // For monthly view, show weekly breakdown for this month
        while (current <= endDate) {
          const periodStart = new Date(current);
          periodStart.setHours(0, 0, 0, 0);

          const periodEnd = new Date(current);
          periodEnd.setDate(periodEnd.getDate() + 6);
          periodEnd.setHours(23, 59, 59, 999);

          // Adjust if period end goes beyond endDate
          if (periodEnd > endDate) {
            periodEnd.setTime(endDate.getTime());
          }

          periods.push({
            start: periodStart,
            end: periodEnd,
            label: `Week of ${current.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}`,
          });

          current.setDate(current.getDate() + 7);
        }
        break;

      case "previous_month":
        // For previous month view, show weekly breakdown for last month
        while (current <= endDate) {
          const periodStart = new Date(current);
          periodStart.setHours(0, 0, 0, 0);

          const periodEnd = new Date(current);
          periodEnd.setDate(periodEnd.getDate() + 6);
          periodEnd.setHours(23, 59, 59, 999);

          // Adjust if period end goes beyond endDate
          if (periodEnd > endDate) {
            periodEnd.setTime(endDate.getTime());
          }

          periods.push({
            start: periodStart,
            end: periodEnd,
            label: `Week of ${current.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}`,
          });

          current.setDate(current.getDate() + 7);
        }
        break;

      case "all_time":
        // For all time view, show monthly breakdown
        while (current <= endDate) {
          const periodStart = new Date(current);
          periodStart.setDate(1);
          periodStart.setHours(0, 0, 0, 0);

          const periodEnd = new Date(current);
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          periodEnd.setDate(0);
          periodEnd.setHours(23, 59, 59, 999);

          // Adjust if period end goes beyond endDate
          if (periodEnd > endDate) {
            periodEnd.setTime(endDate.getTime());
          }

          periods.push({
            start: periodStart,
            end: periodEnd,
            label: current.toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            }),
          });

          current.setMonth(current.getMonth() + 1);
          current.setDate(1);
        }
        break;
    }

    return periods;
  }
}

module.exports = new AnalyticsService();
