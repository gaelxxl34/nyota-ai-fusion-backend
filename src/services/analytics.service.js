const admin = require("firebase-admin");
const logger = require("../utils/logger");
const { LeadModel } = require("../models/lead.model");

const db = admin.firestore();

class AnalyticsService {
  /**
   * Get overview statistics for the dashboard
   */
  async getOverviewStats(timeRange) {
    try {
      logger.info(
        `AnalyticsService.getOverviewStats called with timeRange: ${timeRange}`
      );

      const now = new Date();
      const startDate = this.getStartDate(now, timeRange);

      logger.info(
        `Date range: ${startDate.toISOString()} to ${now.toISOString()}`
      );

      // Get all leads (single organization app)
      const leadsSnapshot = await db.collection("leads").get();
      logger.info(`Found ${leadsSnapshot.size} leads`);

      // Count leads by status - separate counts for all time and time range
      const allTimeStatusCounts = {
        INQUIRY: 0,
        CONTACTED: 0,
        PRE_QUALIFIED: 0,
        APPLIED: 0,
        QUALIFIED: 0,
        ADMITTED: 0,
        ENROLLED: 0,
        REJECTED: 0,
        NURTURE: 0,
      };

      const statusCounts = {
        INQUIRY: 0,
        CONTACTED: 0,
        PRE_QUALIFIED: 0,
        APPLIED: 0,
        QUALIFIED: 0,
        ADMITTED: 0,
        ENROLLED: 0,
        REJECTED: 0,
        NURTURE: 0,
      };

      const totalLeads = leadsSnapshot.size;
      let recentLeads = 0;
      let debugInfo = [];

      leadsSnapshot.forEach((doc) => {
        const lead = doc.data();

        // Get current status from timeline
        const currentStatus = LeadModel.getCurrentStatus(lead);

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
          const createdDate =
            timeline[0].date?.toDate() || new Date(timeline[0].date);

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

      // Log debug info for daily view
      if (timeRange === "daily" && debugInfo.length > 0) {
        logger.info("Sample leads timeline dates:", debugInfo);
      }

      // Calculate previous period for comparison
      const previousStartDate = this.getPreviousStartDate(startDate, timeRange);
      let previousPeriodLeads = 0;

      leadsSnapshot.forEach((doc) => {
        const lead = doc.data();
        // Use the date from the first timeline entry (when lead was created)
        const timeline = lead.timeline || [];
        if (timeline.length > 0) {
          const createdDate =
            timeline[0].date?.toDate() || new Date(timeline[0].date);
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
  async getLeadProgression(timeRange) {
    try {
      const now = new Date();
      const startDate = this.getStartDate(now, timeRange);

      // Get all leads (single organization app)
      const leadsSnapshot = await db.collection("leads").get();

      // Group data by time period
      const progressionData = [];
      const periods = this.getTimePeriods(startDate, now, timeRange);

      for (const period of periods) {
        const periodData = {
          date: period.label,
          contacted: 0,
          preQualified: 0,
          applied: 0,
          qualified: 0,
          enrolled: 0,
        };

        // Count leads by status for this period
        leadsSnapshot.forEach((doc) => {
          const lead = doc.data();
          const statusHistory = lead.statusHistory || [];

          // Check if lead reached each status during this period
          statusHistory.forEach((history) => {
            const changeDate =
              history.timestamp?.toDate() || new Date(history.timestamp);
            if (changeDate >= period.start && changeDate <= period.end) {
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
                case "ENROLLED":
                  periodData.enrolled++;
                  break;
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
              status: LeadModel.getCurrentStatus(lead),
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

        // Skip if user is not an agent or admin
        if (
          ![
            "marketingAgent",
            "admissionsAgent",
            "admin",
            "superAdmin",
          ].includes(user.role)
        ) {
          continue;
        }

        // Filter based on requesting user's role
        if (userRole === "marketingAgent" && user.role === "admissionsAgent") {
          continue; // Marketing agents can't see admissions agents' data
        }
        if (userRole === "admissionsAgent" && user.role === "marketingAgent") {
          continue; // Admissions agents can't see marketing agents' data
        }
        // Admins and superAdmins can see all data

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
          // Check if this lead was submitted by this user
          // submittedBy is stored at the top level of the lead
          // submittedBy contains email, not uid
          const submittedByEmail = lead.submittedBy?.email;

          if (submittedByEmail === user.email) {
            // Also check if lead was created within the time range
            // Use the date from the first timeline entry
            const timeline = lead.timeline || [];
            if (timeline.length > 0) {
              const createdDate =
                timeline[0].date?.toDate() || new Date(timeline[0].date);
              if (createdDate >= startDate) {
                metrics.leadsSubmitted++;
                const currentStatus = LeadModel.getCurrentStatus(lead);
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
  async getConversionRates(timeRange) {
    try {
      const overview = await this.getOverviewStats(timeRange);
      const counts = overview.statusCounts;

      const rates = {
        contactedToPreQualified: 0,
        preQualifiedToApplied: 0,
        appliedToQualified: 0,
        qualifiedToEnrolled: 0,
        overallConversion: 0,
      };

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
        this.getOverviewStats(timeRange),
        this.getLeadProgression(timeRange),
        this.getAgentPerformance(timeRange, userRole),
        this.getConversionRates(timeRange),
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
        csv += `Contacted → Pre-Qualified,${rates.rates.contactedToPreQualified}%\n`;
        csv += `Pre-Qualified → Applied,${rates.rates.preQualifiedToApplied}%\n`;
        csv += `Applied → Qualified,${rates.rates.appliedToQualified}%\n`;
        csv += `Qualified → Enrolled,${rates.rates.qualifiedToEnrolled}%\n`;
        csv += `Overall (Inquiry → Enrolled),${rates.rates.overallConversion}%\n`;
        csv += "\n";

        // Lead Progression Over Time
        if (progression.length > 0) {
          csv += "LEAD PROGRESSION OVER TIME\n";
          csv += "-".repeat(30) + "\n";
          csv += "Period,Contacted,Pre-Qualified,Applied,Qualified,Enrolled\n";
          progression.forEach((period) => {
            csv += `${period.date},${period.contacted},${period.preQualified},${period.applied},${period.qualified},${period.enrolled}\n`;
          });
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
    }

    return periods;
  }
}

module.exports = new AnalyticsService();
