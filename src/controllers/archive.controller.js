const ArchiveJobService = require("../services/archiveJob.service");

const archiveJobService = new ArchiveJobService();

const parseLimit = (value, defaultValue = 20) => {
  const numeric = parseInt(value, 10);
  if (Number.isNaN(numeric) || numeric <= 0) {
    return defaultValue;
  }
  return Math.min(numeric, 200);
};

module.exports = {
  async listCollections(req, res) {
    try {
      const collections = archiveJobService.getSupportedCollections();
      const stats = await Promise.all(
        collections.map((collection) =>
          archiveJobService.getCollectionStats(collection.id)
        )
      );

      const merged = collections.map((collection) => {
        const stat = stats.find((item) => item.id === collection.id) || {};
        return {
          ...collection,
          count: stat.count ?? null,
          countError: stat.error || null,
        };
      });

      res.json({
        success: true,
        collections: merged,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to load collections",
        error: error.message,
      });
    }
  },

  async getFilters(req, res) {
    try {
      const { collectionId } = req.params;

      if (!collectionId) {
        return res.status(400).json({
          success: false,
          message: "collectionId is required",
        });
      }

      const filters = await archiveJobService.getAvailableFilters(collectionId);
      res.json({
        success: true,
        filters,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to load filters",
        error: error.message,
      });
    }
  },

  async checkArchiveExists(req, res) {
    try {
      const { collectionId, year, intake } = req.query;

      if (!collectionId) {
        return res.status(400).json({
          success: false,
          message: "collectionId is required",
        });
      }

      const exists = await archiveJobService.checkArchiveExists(
        collectionId,
        year,
        intake
      );

      res.json({
        success: true,
        exists,
        collectionId,
        year: year || null,
        intake: intake || null,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to check archive existence",
        error: error.message,
      });
    }
  },

  async listJobs(req, res) {
    try {
      const limit = parseLimit(req.query.limit);
      const jobs = await archiveJobService.listJobs(limit);

      res.json({
        success: true,
        jobs,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to load archive jobs",
        error: error.message,
      });
    }
  },

  async getJob(req, res) {
    try {
      const { jobId } = req.params;
      const job = await archiveJobService.getJob(jobId);
      res.json({
        success: true,
        job,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getJobLogs(req, res) {
    try {
      const { jobId } = req.params;
      const limit = parseLimit(req.query.limit, 200);
      const logs = await archiveJobService.getJobLogs(jobId, { limit });

      res.json({
        success: true,
        logs,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to load job logs",
        error: error.message,
      });
    }
  },

  async createJob(req, res) {
    try {
      const { collectionId, year, intake, action } = req.body;

      if (!collectionId) {
        return res.status(400).json({
          success: false,
          message: "collectionId is required",
        });
      }

      if (!action) {
        return res.status(400).json({
          success: false,
          message: "An action is required",
        });
      }

      const requestedBy = {
        uid: req.user?.uid || null,
        email: req.user?.email || null,
        name: req.user?.name || null,
      };

      const result = await archiveJobService.executeArchive({
        collectionId,
        year,
        intake,
        action,
        requestedBy,
      });

      res.status(201).json({
        success: true,
        job: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async triggerJob(req, res) {
    return res.status(410).json({
      success: false,
      message:
        "This endpoint is deprecated. Archives now execute immediately when created.",
    });
  },

  async deleteArchive(req, res) {
    try {
      const { archiveId } = req.params;

      if (!archiveId) {
        return res.status(400).json({
          success: false,
          message: "archiveId is required",
        });
      }

      await archiveJobService.deleteArchive(archiveId);

      res.json({
        success: true,
        message: "Archive deleted successfully",
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || "Failed to delete archive",
      });
    }
  },

  async downloadArchive(req, res) {
    try {
      const { archiveId } = req.params;
      const { format = "csv" } = req.query;

      if (!archiveId) {
        return res.status(400).json({
          success: false,
          message: "archiveId is required",
        });
      }

      if (!["csv", "xlsx"].includes(format)) {
        return res.status(400).json({
          success: false,
          message: "Invalid format. Use 'csv' or 'xlsx'",
        });
      }

      const result = await archiveJobService.exportArchive(archiveId, format);

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${result.filename}"`
      );
      res.setHeader("Content-Type", result.contentType);
      res.send(result.data);
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || "Failed to download archive",
      });
    }
  },
};
