const express = require("express");
const router = express.Router();
const archiveController = require("../controllers/archive.controller");
const {
  authenticateUser,
  checkRole,
} = require("../middleware/auth.middleware");

router.use(authenticateUser);
router.use(checkRole(["superAdmin"]));

router.get("/collections", archiveController.listCollections);
router.get("/filters/:collectionId", archiveController.getFilters);
router.get("/check-exists", archiveController.checkArchiveExists);
router.get("/jobs", archiveController.listJobs);
router.get("/jobs/:jobId", archiveController.getJob);
router.get("/jobs/:jobId/logs", archiveController.getJobLogs);
router.get("/:archiveId/download", archiveController.downloadArchive);
router.post("/jobs", archiveController.createJob);
router.post("/jobs/:jobId/run", archiveController.triggerJob);
router.delete("/:archiveId", archiveController.deleteArchive);

module.exports = router;
