const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");
const db = admin.firestore();
const XLSX = require("xlsx");
const { authenticateUser } = require("../middleware/auth.middleware");
const { checkRole } = require("../middleware/permissions.middleware");
const conversationStatsService = require("../services/conversationStats.service");

// Get system statistics for admin dashboard
router.get(
  "/stats",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      // Get total leads count
      const leadsSnapshot = await db.collection("leads").get();
      const totalLeads = leadsSnapshot.size;

      // Get active leads count
      const activeLeadsSnapshot = await db
        .collection("leads")
        .where("status", "in", ["new", "contacted", "qualified"])
        .get();
      const activeLeads = activeLeadsSnapshot.size;

      // Get applications count
      const applicationsSnapshot = await db.collection("applications").get();
      const totalApplications = applicationsSnapshot.size;

      // Get team members count (excluding super admins)
      const usersSnapshot = await db.collection("users").get();
      const teamMembers = usersSnapshot.docs.filter((doc) => {
        const userData = doc.data();
        return userData.role !== "superAdmin";
      }).length;

      res.json({
        success: true,
        stats: {
          totalLeads,
          activeLeads,
          totalApplications,
          teamMembers,
          conversionRate:
            totalLeads > 0
              ? ((totalApplications / totalLeads) * 100).toFixed(1)
              : 0,
        },
      });
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch statistics",
        error: error.message,
      });
    }
  }
);

// Get recent activities
router.get(
  "/activities",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 10;

      // Get recent leads
      const recentLeadsSnapshot = await db
        .collection("leads")
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();

      const activities = recentLeadsSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          type: "lead",
          message: `New lead: ${data.name}`,
          timestamp: data.createdAt,
          details: {
            name: data.name,
            email: data.email,
            status: data.status,
          },
        };
      });

      res.json({
        success: true,
        activities,
      });
    } catch (error) {
      console.error("Error fetching activities:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch activities",
        error: error.message,
      });
    }
  }
);

// Get performance metrics
router.get(
  "/performance",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin"]),
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      let query = db.collection("leads");

      if (startDate && endDate) {
        query = query
          .where("createdAt", ">=", new Date(startDate))
          .where("createdAt", "<=", new Date(endDate));
      }

      const leadsSnapshot = await query.get();

      // Calculate metrics by status
      const statusCounts = {};
      leadsSnapshot.docs.forEach((doc) => {
        const status = doc.data().status || "unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });

      res.json({
        success: true,
        metrics: {
          total: leadsSnapshot.size,
          byStatus: statusCounts,
          period: {
            startDate: startDate || "all-time",
            endDate: endDate || "all-time",
          },
        },
      });
    } catch (error) {
      console.error("Error fetching performance metrics:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch performance metrics",
        error: error.message,
      });
    }
  }
);

// Import data from CSV/Excel files
router.post(
  "/import-data",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin", "admissionAgent"]),
  async (req, res) => {
    try {
      console.log(`📋 Import request received from user: ${req.user?.email}`);
      console.log(
        `📁 Request files:`,
        req.files ? Object.keys(req.files) : "No files received"
      );

      if (!req.files || !req.files.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      const uploadedFile = req.files.file;
      console.log(`📁 Processing import file: ${uploadedFile.name}`);
      console.log(`📊 File size: ${uploadedFile.size} bytes`);
      console.log(`📄 File mimetype: ${uploadedFile.mimetype}`);

      // Validate file type
      const allowedTypes = [
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ];

      const isValidType =
        allowedTypes.includes(uploadedFile.mimetype) ||
        uploadedFile.name.endsWith(".csv") ||
        uploadedFile.name.endsWith(".xlsx") ||
        uploadedFile.name.endsWith(".xls");

      if (!isValidType) {
        return res.status(400).json({
          success: false,
          message: "Invalid file type. Only CSV and Excel files are allowed.",
        });
      }

      // Validate file size (10MB limit)
      if (uploadedFile.size > 10 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          message: "File too large. Maximum size is 10MB.",
        });
      }

      let data = [];

      // Parse file based on type
      if (
        uploadedFile.mimetype === "text/csv" ||
        uploadedFile.name.endsWith(".csv")
      ) {
        // Parse CSV
        let csvContent;

        // Check if file is stored in temp file or in memory
        if (uploadedFile.tempFilePath) {
          // File is stored in temporary file
          const fs = require("fs");
          csvContent = fs.readFileSync(uploadedFile.tempFilePath, "utf8");
          console.log(
            `📝 Reading from temp file: ${uploadedFile.tempFilePath}`
          );
        } else if (uploadedFile.data) {
          // File is stored in memory
          csvContent = uploadedFile.data.toString("utf8");
          console.log(`📝 Reading from memory buffer`);
        } else {
          throw new Error("Unable to access file content");
        }

        // Remove BOM if present
        if (csvContent.charCodeAt(0) === 0xfeff) {
          csvContent = csvContent.slice(1);
        }

        console.log(
          `📝 CSV Content preview: ${csvContent.substring(0, 200)}...`
        );
        console.log(`📝 CSV Content length: ${csvContent.length}`);

        // Split by different line endings and filter out completely empty lines
        const lines = csvContent
          .split(/\r\n|\n|\r/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        console.log(`📊 Found ${lines.length} lines in CSV`);
        console.log(`📊 First few lines: ${JSON.stringify(lines.slice(0, 3))}`);

        if (lines.length === 0) {
          console.log(
            `❌ No lines found after parsing. Raw content: ${JSON.stringify(
              csvContent.substring(0, 100)
            )}`
          );
          return res.status(400).json({
            success: false,
            message: "No valid data lines found in CSV file",
          });
        }

        data = lines.map((line, lineIndex) => {
          const result = [];
          let current = "";
          let inQuotes = false;

          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === "," && !inQuotes) {
              result.push(current.trim().replace(/^"|"$/g, ""));
              current = "";
            } else {
              current += char;
            }
          }
          result.push(current.trim().replace(/^"|"$/g, ""));

          if (lineIndex === 0) {
            console.log(`📋 Parsed header row: ${result.join(", ")}`);
          }

          return result;
        });
      } else {
        // Parse Excel
        let excelData;

        if (uploadedFile.tempFilePath) {
          // File is stored in temporary file
          const fs = require("fs");
          excelData = fs.readFileSync(uploadedFile.tempFilePath);
          console.log(
            `📝 Reading Excel from temp file: ${uploadedFile.tempFilePath}`
          );
        } else if (uploadedFile.data) {
          // File is stored in memory
          excelData = uploadedFile.data;
          console.log(`📝 Reading Excel from memory buffer`);
        } else {
          throw new Error("Unable to access file content");
        }

        const workbook = XLSX.read(excelData, { type: "buffer" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        data = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: "",
          raw: false,
        });
      }

      if (data.length === 0) {
        console.log(
          `❌ No data found in parsed file. Data length: ${data.length}`
        );
        return res.status(400).json({
          success: false,
          message: "No data found in file",
        });
      }

      console.log(`📊 Parsed ${data.length} rows from file`);
      console.log(`📋 First row: ${JSON.stringify(data[0])}`);
      if (data.length > 1) {
        console.log(`📋 Second row: ${JSON.stringify(data[1])}`);
      }

      // Get headers (first row)
      const headers = data[0];
      const rows = data.slice(1);

      console.log(`📋 Headers: ${headers.join(", ")}`);

      // Map headers to expected field names (case-insensitive matching)
      const fieldMapping = {};
      headers.forEach((header, index) => {
        const normalizedHeader = header.toLowerCase().trim();

        // Map various possible header names to our expected fields
        if (
          normalizedHeader.includes("createdat") ||
          normalizedHeader.includes("created at")
        ) {
          fieldMapping.createdAt = index;
        } else if (normalizedHeader.includes("source")) {
          fieldMapping.source = index;
        } else if (
          normalizedHeader.includes("firstname") ||
          normalizedHeader.includes("first name")
        ) {
          fieldMapping.firstName = index;
        } else if (
          normalizedHeader.includes("lastname") ||
          normalizedHeader.includes("last name")
        ) {
          fieldMapping.lastName = index;
        } else if (
          normalizedHeader.includes("sponsor") &&
          normalizedHeader.includes("email")
        ) {
          fieldMapping.sponsorEmail = index;
        } else if (
          normalizedHeader.includes("sponsor") &&
          normalizedHeader.includes("phone")
        ) {
          fieldMapping.sponsorPhone = index;
        } else if (normalizedHeader === "email") {
          fieldMapping.email = index;
        } else if (
          normalizedHeader.includes("phone") &&
          normalizedHeader.includes("no")
        ) {
          fieldMapping.phoneNo = index;
        } else if (normalizedHeader.includes("nationality")) {
          fieldMapping.nationality = index;
        } else if (
          normalizedHeader.includes("reg") &&
          normalizedHeader.includes("no")
        ) {
          fieldMapping.regNo = index;
        } else if (normalizedHeader.includes("course")) {
          fieldMapping.course = index;
        } else if (normalizedHeader.includes("faculty")) {
          fieldMapping.faculty = index;
        } else if (
          normalizedHeader.includes("mode") &&
          normalizedHeader.includes("study")
        ) {
          fieldMapping.modeOfStudy = index;
        } else if (
          normalizedHeader.includes("date") &&
          normalizedHeader.includes("birth")
        ) {
          fieldMapping.dateOfBirth = index;
        } else if (
          normalizedHeader.includes("company") &&
          !normalizedHeader.includes("city") &&
          !normalizedHeader.includes("province")
        ) {
          fieldMapping.company = index;
        } else if (
          normalizedHeader.includes("company") &&
          (normalizedHeader.includes("city") ||
            normalizedHeader.includes("province"))
        ) {
          fieldMapping.companyLocation = index;
        } else if (
          normalizedHeader.includes("id") &&
          normalizedHeader.includes("type")
        ) {
          fieldMapping.idType = index;
        } else if (
          normalizedHeader.includes("uace") &&
          normalizedHeader.includes("level") &&
          !normalizedHeader.includes("results")
        ) {
          fieldMapping.uaceLevel = index;
        } else if (
          normalizedHeader.includes("uace") &&
          normalizedHeader.includes("results")
        ) {
          fieldMapping.uaceLevelResults = index;
        } else if (
          normalizedHeader.includes("other") &&
          normalizedHeader.includes("documents")
        ) {
          fieldMapping.otherDocuments = index;
        } else if (normalizedHeader.includes("equating")) {
          fieldMapping.equating = index;
        }
      });

      console.log(`📋 Field mapping:`, fieldMapping);

      // Process each row and create applications and leads
      const results = {
        total: rows.length,
        successful: 0,
        failed: 0,
        duplicates: 0,
        errors: [],
      };

      // Get services
      const ApplicationService = require("../services/applicationService");
      const LeadService = require("../services/leadService");
      const WhatsappMessageService = require("../services/whatsappMessageService");
      const StorageService = require("../services/storageService");

      const leadService = new LeadService(db);
      const whatsappService = new WhatsappMessageService(db);
      const storageService = new StorageService();
      const applicationService = new ApplicationService(
        db,
        leadService,
        whatsappService,
        storageService
      );

      console.log(`📊 Processing ${rows.length} rows...`);

      // Cache for duplicate checking to improve performance
      const duplicateCache = new Set();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 2; // +2 because of 0-based index and header row

        // Progress reporting for large imports
        if (i % 50 === 0) {
          console.log(
            `📈 Progress: ${i}/${rows.length} rows processed (${Math.round(
              (i / rows.length) * 100
            )}%)`
          );
          console.log(
            `📊 Current stats: ${results.successful} successful, ${results.failed} failed, ${results.duplicates} duplicates`
          );
        }

        // Add timeout check to prevent hanging
        const startTime = Date.now();
        const TIMEOUT_MS = 10000; // 10 second timeout per row

        try {
          // Extract data from row based on field mapping
          const firstName =
            fieldMapping.firstName !== undefined
              ? row[fieldMapping.firstName]?.trim()
              : "";
          const lastName =
            fieldMapping.lastName !== undefined
              ? row[fieldMapping.lastName]?.trim()
              : "";
          const email =
            fieldMapping.email !== undefined
              ? row[fieldMapping.email]?.trim().toLowerCase()
              : "";
          const phoneNo =
            fieldMapping.phoneNo !== undefined
              ? row[fieldMapping.phoneNo]?.trim()
              : "";
          const course =
            fieldMapping.course !== undefined
              ? row[fieldMapping.course]?.trim()
              : "";
          const source =
            fieldMapping.source !== undefined
              ? row[fieldMapping.source]?.trim()
              : "";
          const sponsorEmail =
            fieldMapping.sponsorEmail !== undefined
              ? row[fieldMapping.sponsorEmail]?.trim()
              : "";
          const sponsorPhone =
            fieldMapping.sponsorPhone !== undefined
              ? row[fieldMapping.sponsorPhone]?.trim()
              : "";
          const nationality =
            fieldMapping.nationality !== undefined
              ? row[fieldMapping.nationality]?.trim()
              : "";
          let modeOfStudy =
            fieldMapping.modeOfStudy !== undefined
              ? row[fieldMapping.modeOfStudy]?.trim()
              : "";

          // Normalize mode of study - convert "On-campus" to "On Campus"
          if (modeOfStudy && modeOfStudy.toLowerCase() === "on-campus") {
            modeOfStudy = "On Campus";
          }

          const dateOfBirth =
            fieldMapping.dateOfBirth !== undefined
              ? row[fieldMapping.dateOfBirth]?.trim()
              : "";
          const company =
            fieldMapping.company !== undefined
              ? row[fieldMapping.company]?.trim()
              : "";
          const regNo =
            fieldMapping.regNo !== undefined
              ? row[fieldMapping.regNo]?.trim()
              : "";
          const faculty =
            fieldMapping.faculty !== undefined
              ? row[fieldMapping.faculty]?.trim()
              : "";
          const originalCreatedAt =
            fieldMapping.createdAt !== undefined
              ? row[fieldMapping.createdAt]?.trim()
              : "";

          // Extract additional biographical fields
          const companyLocation =
            fieldMapping.companyLocation !== undefined
              ? row[fieldMapping.companyLocation]?.trim()
              : "";
          const idType =
            fieldMapping.idType !== undefined
              ? row[fieldMapping.idType]?.trim()
              : "";
          const uaceLevel =
            fieldMapping.uaceLevel !== undefined
              ? row[fieldMapping.uaceLevel]?.trim()
              : "";
          const uaceLevelResults =
            fieldMapping.uaceLevelResults !== undefined
              ? row[fieldMapping.uaceLevelResults]?.trim()
              : "";
          const otherDocuments =
            fieldMapping.otherDocuments !== undefined
              ? row[fieldMapping.otherDocuments]?.trim()
              : "";
          const equating =
            fieldMapping.equating !== undefined
              ? row[fieldMapping.equating]?.trim()
              : "";

          // Validate required fields
          if (!firstName || !lastName) {
            results.errors.push(
              `Row ${rowNumber}: First name and last name are required`
            );
            results.failed++;
            continue;
          }

          // Handle email validation - allow N/A emails for bulk imports
          let validEmail = null;
          if (email && email.toLowerCase() !== "n/a" && email.trim() !== "") {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (emailRegex.test(email)) {
              validEmail = email;
            } else {
              results.errors.push(
                `Row ${rowNumber}: Invalid email format: ${email}`
              );
              results.failed++;
              continue;
            }
          }

          if (!validEmail && !phoneNo) {
            results.errors.push(
              `Row ${rowNumber}: Either valid email or phone number is required`
            );
            results.failed++;
            continue;
          }

          // Combine first and last name
          const fullName = `${firstName} ${lastName}`.trim();

          // Check for duplicates by email or phone (with caching for performance)
          let isDuplicate = false;

          // Check cache first to avoid redundant database queries
          const cacheKey = `${email || "no-email"}_${phoneNo || "no-phone"}`;
          if (duplicateCache.has(cacheKey)) {
            console.log(`⚠️ Duplicate found in cache for: ${email || phoneNo}`);
            results.duplicates++;
            isDuplicate = true;
          } else {
            // Check database for duplicates
            if (email) {
              const existingApplicationsByEmail =
                await applicationService.getApplicationsByEmail(email);
              if (existingApplicationsByEmail.length > 0) {
                console.log(`⚠️ Duplicate found for email: ${email}`);
                results.duplicates++;
                isDuplicate = true;
                duplicateCache.add(cacheKey);
              }
            }

            if (!isDuplicate && phoneNo) {
              const existingApplicationsByPhone =
                await applicationService.getApplicationsByPhone(phoneNo);
              if (existingApplicationsByPhone.length > 0) {
                console.log(`⚠️ Duplicate found for phone: ${phoneNo}`);
                results.duplicates++;
                isDuplicate = true;
                duplicateCache.add(cacheKey);
              }
            }
          }

          if (isDuplicate) {
            continue;
          }

          // Add to cache after successful processing
          duplicateCache.add(cacheKey);

          // Parse created date if available
          let parsedCreatedAt = new Date();
          if (originalCreatedAt) {
            try {
              // Handle different date formats
              if (originalCreatedAt.includes("/")) {
                // Handle DD/MM/YYYY format
                const [day, month, year] = originalCreatedAt.split("/");
                parsedCreatedAt = new Date(
                  `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
                );
              } else {
                parsedCreatedAt = new Date(originalCreatedAt);
              }

              if (isNaN(parsedCreatedAt.getTime())) {
                console.warn(
                  `Invalid date format for row ${rowNumber}: ${originalCreatedAt}, using current date`
                );
                parsedCreatedAt = new Date();
              }
            } catch (error) {
              console.warn(
                `Error parsing date for row ${rowNumber}: ${originalCreatedAt}, using current date`
              );
              parsedCreatedAt = new Date();
            }
          }

          // Map course to preferred program (you may need to adjust this mapping)
          let preferredProgram = course;
          if (course) {
            // Try to map common course names to our program codes
            const courseMapping = {
              "information technology": "bachelor_information_technology",
              "business administration": "bachelor_business_administration",
              "computer science": "bachelor_computer_science",
              "software engineering": "bachelor_software_engineering",
              commerce: "bachelor_commerce",
              accounting: "bachelor_accounting",
              marketing: "bachelor_marketing",
            };

            const lowerCourse = course.toLowerCase();
            for (const [key, value] of Object.entries(courseMapping)) {
              if (lowerCourse.includes(key)) {
                preferredProgram = value;
                break;
              }
            }
          }

          // Map source from CSV to valid lead source constants
          let mappedSource = null;
          if (source) {
            const lowerSource = source.toLowerCase().trim();

            const sourceMapping = {
              website: "WEBSITE",
              web: "WEBSITE",
              online: "WEBSITE",
              "meta ads": "META_ADS",
              facebook: "META_ADS",
              "facebook ads": "META_ADS",
              instagram: "META_ADS",
              "instagram ads": "META_ADS",
              meta: "META_ADS",
              "google ads": "GOOGLE_ADS",
              google: "GOOGLE_ADS",
              adwords: "GOOGLE_ADS",
              whatsapp: "WHATSAPP",
              linkedin: "LINKEDIN",
              referral: "REFERRAL",
              reference: "REFERRAL",
              referred: "REFERRAL",
              "walk-in": "WALK_IN",
              "walk in": "WALK_IN",
              walkin: "WALK_IN",
              phone: "PHONE",
              "phone call": "PHONE",
              call: "PHONE",
              telephone: "PHONE",
              email: "EMAIL",
              "education fair": "EDUCATION_FAIR",
              fair: "EDUCATION_FAIR",
              partner: "PARTNER",
              "application form": "APPLICATION_FORM",
              form: "APPLICATION_FORM",
              manual: "MANUAL",
              "social media": "SOCIAL_MEDIA",
              social: "SOCIAL_MEDIA",
              event: "EVENT",
              "student portal": "STUDENT_PORTAL",
              "applicant portal": "APPLICANT_PORTAL",
              other: "OTHER",
            };

            mappedSource = sourceMapping[lowerSource] || "OTHER";
          }

          // Create application data
          const applicationData = {
            name: fullName,
            email:
              validEmail ||
              `no-email-${Date.now()}-${Math.random()
                .toString(36)
                .substr(2, 9)}@import.placeholder`, // Generate placeholder email for N/A cases
            phoneNumber: phoneNo || null,
            countryOfBirth: nationality || null,
            gender: null, // Set to null for all imports
            preferredProgram: preferredProgram || null, // Default
            modeOfStudy: modeOfStudy || "On Campus", // Default
            preferredIntake: "August", // Set intake to August for all uploads
            postalAddress: null,
            sponsorEmail: sponsorEmail || null,
            sponsorTelephone: sponsorPhone || null,
            source: mappedSource || "APPLICATION_FORM", // Use mapped source from CSV, default to APPLICATION_FORM

            // Additional biographical data from CSV
            registrationNumber: regNo || null,
            faculty: faculty || null,
            dateOfBirth: dateOfBirth || null,
            company: company || null,
            companyLocation: companyLocation || null,
            idType: idType || null,
            uaceLevel: uaceLevel || null,
            uaceLevelResults: uaceLevelResults || null,
            otherDocuments: otherDocuments || null,
            equating: equating || null,

            submittedBy: {
              email: req.user.email || "system@admin.com",
              name:
                req.user.displayName ||
                req.user.name ||
                req.user.email ||
                "System Admin",
              role: req.user.role || "admissionAdmin",
            },
            skipWhatsappMessage: true, // Skip WhatsApp for bulk imports
            status: "ADMITTED", // Set status to ADMITTED for imports
            createdAt: parsedCreatedAt, // Use original creation date from CSV
            submittedAt: parsedCreatedAt, // Use original date for submission as well
          };

          // Create application and lead
          const result = await applicationService.submitApplication(
            applicationData
          );

          // Override the status to ADMITTED for both application and lead after creation
          if (result.application && result.application.id) {
            // Create a clean updatedBy object to avoid undefined values in Firestore
            const updatedByUser = {
              email: req.user.email || "system@admin.com",
              name:
                req.user.displayName ||
                req.user.name ||
                req.user.email ||
                "System Admin",
              role: req.user.role || "admissionAdmin",
            };

            await applicationService.updateApplicationStatus(
              result.application.id,
              "ADMITTED",
              "Bulk import - status set to ADMITTED",
              updatedByUser
            );
          }

          // Update created timestamps to match original data
          if (originalCreatedAt && result.application) {
            await db
              .collection("applications")
              .doc(result.application.id)
              .update({
                createdAt: parsedCreatedAt,
                submittedAt: parsedCreatedAt,
              });

            if (result.lead && result.lead.id) {
              await db.collection("leads").doc(result.lead.id).update({
                createdAt: parsedCreatedAt,
              });
            }
          }

          console.log(`✅ Successfully imported row ${rowNumber}: ${fullName}`);
          results.successful++;

          // Check processing time per row
          const processingTime = Date.now() - startTime;
          if (processingTime > 5000) {
            // Log slow rows
            console.warn(
              `⏰ Slow processing detected for row ${rowNumber}: ${processingTime}ms`
            );
          }
        } catch (error) {
          console.error(`❌ Error importing row ${rowNumber}:`, error);

          // Enhanced error reporting
          const errorMessage = error.message || "Unknown error";
          results.errors.push(`Row ${rowNumber}: ${errorMessage}`);
          results.failed++;

          // Continue processing even if some rows fail
          continue;
        }
      }

      console.log(`📊 Import completed:`, results);

      res.json({
        success: true,
        message: `Import completed. ${results.successful} successful, ${results.failed} failed, ${results.duplicates} duplicates`,
        stats: results,
        errors: results.errors.slice(0, 10), // Limit errors in response
      });
    } catch (error) {
      console.error("❌ Error during import:", error);

      res.status(500).json({
        success: false,
        message: "Failed to import data",
        error: error.message,
      });
    }
  }
);

// Import data for tag updates - different endpoint for updating applications with tags
router.post(
  "/import-tag-updates",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin", "admissionAgent"]),
  async (req, res) => {
    try {
      console.log(
        `📋 Tag import request received from user: ${req.user?.email}`
      );
      console.log(
        `📁 Request files:`,
        req.files ? Object.keys(req.files) : "No files received"
      );

      if (!req.files || !req.files.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      const uploadedFile = req.files.file;
      console.log(`📁 Processing tag import file: ${uploadedFile.name}`);

      // Validate file type
      const allowedTypes = [
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ];

      const isValidType =
        allowedTypes.includes(uploadedFile.mimetype) ||
        uploadedFile.name.endsWith(".csv") ||
        uploadedFile.name.endsWith(".xlsx") ||
        uploadedFile.name.endsWith(".xls");

      if (!isValidType) {
        return res.status(400).json({
          success: false,
          message: "Invalid file type. Only CSV and Excel files are allowed.",
        });
      }

      let data = [];

      // Parse file based on type (same parsing logic as import-data)
      if (
        uploadedFile.mimetype === "text/csv" ||
        uploadedFile.name.endsWith(".csv")
      ) {
        let csvContent;
        if (uploadedFile.tempFilePath) {
          const fs = require("fs");
          csvContent = fs.readFileSync(uploadedFile.tempFilePath, "utf8");
        } else if (uploadedFile.data) {
          csvContent = uploadedFile.data.toString("utf8");
        } else {
          throw new Error("Unable to access file content");
        }

        // Remove BOM if present
        if (csvContent.charCodeAt(0) === 0xfeff) {
          csvContent = csvContent.slice(1);
        }

        const lines = csvContent
          .split(/\r\n|\n|\r/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        if (lines.length === 0) {
          return res.status(400).json({
            success: false,
            message: "No valid data lines found in CSV file",
          });
        }

        data = lines.map((line) => {
          const result = [];
          let current = "";
          let inQuotes = false;

          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === "," && !inQuotes) {
              result.push(current.trim().replace(/^"|"$/g, ""));
              current = "";
            } else {
              current += char;
            }
          }
          result.push(current.trim().replace(/^"|"$/g, ""));
          return result;
        });
      } else {
        // Parse Excel
        let excelData;
        if (uploadedFile.tempFilePath) {
          const fs = require("fs");
          excelData = fs.readFileSync(uploadedFile.tempFilePath);
        } else if (uploadedFile.data) {
          excelData = uploadedFile.data;
        } else {
          throw new Error("Unable to access file content");
        }

        const workbook = XLSX.read(excelData, { type: "buffer" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        data = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: "",
          raw: false,
        });
      }

      if (data.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No data found in file",
        });
      }

      console.log(`📊 Parsed ${data.length} rows from tag file`);

      // Get headers (first row)
      const headers = data[0];
      const rows = data.slice(1);

      console.log(`📋 Headers: ${headers.join(", ")}`);

      // Map headers for reg no and tags
      const fieldMapping = {};
      headers.forEach((header, index) => {
        const normalizedHeader = header.toLowerCase().trim();

        if (
          normalizedHeader.includes("reg") &&
          (normalizedHeader.includes("no") ||
            normalizedHeader.includes("number"))
        ) {
          fieldMapping.regNo = index;
        } else if (normalizedHeader.includes("tag")) {
          fieldMapping.tags = index;
        }
      });

      console.log(`📋 Field mapping for tags:`, fieldMapping);

      // Validate required columns
      if (fieldMapping.regNo === undefined || fieldMapping.tags === undefined) {
        return res.status(400).json({
          success: false,
          message:
            "Required columns not found. File must contain 'Reg No' and 'Tags' columns.",
        });
      }

      // Process each row for tag updates
      const results = {
        total: rows.length,
        updated: 0,
        enrolled: 0,
        notFound: 0,
        failed: 0,
        errors: [],
      };

      console.log(`📊 Processing ${rows.length} rows for tag updates...`);

      // Get services
      const ApplicationService = require("../services/applicationService");
      const LeadService = require("../services/leadService");
      const WhatsappMessageService = require("../services/whatsappMessageService");
      const StorageService = require("../services/storageService");

      const leadService = new LeadService(db);
      const whatsappService = new WhatsappMessageService(db);
      const storageService = new StorageService();
      const applicationService = new ApplicationService(
        db,
        leadService,
        whatsappService,
        storageService
      );

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 2; // +2 because of 0-based index and header row

        try {
          const regNo =
            fieldMapping.regNo !== undefined
              ? row[fieldMapping.regNo]?.trim()
              : "";
          const tags =
            fieldMapping.tags !== undefined
              ? row[fieldMapping.tags]?.trim()
              : "";

          if (!regNo) {
            results.errors.push(
              `Row ${rowNumber}: Registration number is required`
            );
            results.failed++;
            continue;
          }

          if (!tags) {
            results.errors.push(`Row ${rowNumber}: Tags field is required`);
            results.failed++;
            continue;
          }

          // Find application by registration number
          const applicationsSnapshot = await db
            .collection("applications")
            .where("registrationNumber", "==", regNo)
            .get();

          if (applicationsSnapshot.empty) {
            console.log(`⚠️ No application found for reg no: ${regNo}`);
            results.errors.push(
              `Row ${rowNumber}: No application found for registration number ${regNo}`
            );
            results.notFound++;
            continue;
          }

          // Update each matching application (there should typically be only one)
          for (const applicationDoc of applicationsSnapshot.docs) {
            const applicationId = applicationDoc.id;
            const currentData = applicationDoc.data();

            console.log(
              `🔍 Found application ${applicationId} for reg no: ${regNo}`
            );
            console.log(`🔍 Current application data:`, {
              status: currentData.status,
              leadId: currentData.leadId,
              registrationNumber: currentData.registrationNumber,
              tags: currentData.tags,
            });

            // Prepare update data
            const updateData = {
              tags: tags,
              updatedAt: new Date(),
              lastUpdatedBy: {
                email: req.user.email || "system@admin.com",
                name:
                  req.user.displayName ||
                  req.user.name ||
                  req.user.email ||
                  "System Admin",
                role: req.user.role || "admissionAdmin",
              },
            };

            // Check if tags value is "green" and current status is "ADMITTED"
            let statusChanged = false;
            if (
              tags.toLowerCase() === "green" &&
              currentData.status === "ADMITTED"
            ) {
              console.log(
                `🔄 Processing green tag for application ${applicationId}`
              );
              console.log(
                `🔄 Current status: ${currentData.status}, Lead ID: ${currentData.leadId}`
              );

              // Use ApplicationService to update status which handles both application and lead
              await applicationService.updateApplicationStatus(
                applicationId,
                "ENROLLED",
                `Status updated to ENROLLED due to green tag from import`,
                updateData.lastUpdatedBy
              );

              // Also update tags separately since updateApplicationStatus doesn't handle tags
              await db.collection("applications").doc(applicationId).update({
                tags: tags,
                updatedAt: new Date(),
                lastUpdatedBy: updateData.lastUpdatedBy,
              });

              console.log(
                `✅ Updating status from ADMITTED to ENROLLED for reg no: ${regNo}`
              );
              results.enrolled++;
              statusChanged = true;
            } else {
              // Just update tags and add timeline entry
              const timelineEntry = {
                date: new Date(),
                action: "TAGS_UPDATED",
                status: currentData.status,
                notes: `Tags updated to: ${tags}`,
                updatedBy: updateData.lastUpdatedBy,
              };

              const currentTimeline = currentData.timeline || [];
              updateData.timeline = [...currentTimeline, timelineEntry];

              // Update the application document with tags
              await db
                .collection("applications")
                .doc(applicationId)
                .update(updateData);

              console.log(
                `✅ Successfully updated application ${applicationId} with tags: ${tags}`
              );
              results.updated++;
            }
          }
        } catch (error) {
          console.error(`❌ Error processing row ${rowNumber}:`, error);
          results.errors.push(`Row ${rowNumber}: ${error.message}`);
          results.failed++;
        }
      }

      console.log(`📊 Tag import completed:`, results);

      res.json({
        success: true,
        message: `Tag import completed. ${results.updated} updated, ${results.enrolled} enrolled, ${results.notFound} not found, ${results.failed} failed`,
        stats: results,
        errors: results.errors.slice(0, 10), // Limit errors in response
      });
    } catch (error) {
      console.error("❌ Error during tag import:", error);
      res.status(500).json({
        success: false,
        message: "Failed to import tag data",
        error: error.message,
      });
    }
  }
);

// Import emails for campaign sending - endpoint for sending bulk campaign emails
router.post(
  "/import-send-emails",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin", "admissionAgent"]),
  async (req, res) => {
    try {
      console.log(
        `📧 Campaign email import request received from user: ${req.user?.email}`
      );
      console.log(
        `📁 Request files:`,
        req.files ? Object.keys(req.files) : "No files received"
      );

      if (!req.files || !req.files.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      const uploadedFile = req.files.file;
      console.log(`📁 Processing campaign email file: ${uploadedFile.name}`);

      // Get campaign parameters from request body
      const {
        subject = "Welcome to IUEA – Your August 2025 Orientation Week",
        customContent = null,
      } = req.body;

      console.log(`📧 Campaign subject: ${subject}`);

      // Validate file type
      const allowedTypes = [
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ];

      const isValidType =
        allowedTypes.includes(uploadedFile.mimetype) ||
        uploadedFile.name.endsWith(".csv") ||
        uploadedFile.name.endsWith(".xlsx") ||
        uploadedFile.name.endsWith(".xls");

      if (!isValidType) {
        return res.status(400).json({
          success: false,
          message: "Invalid file type. Only CSV and Excel files are allowed.",
        });
      }

      let data = [];

      // Parse file based on type (same parsing logic as other imports)
      if (
        uploadedFile.mimetype === "text/csv" ||
        uploadedFile.name.endsWith(".csv")
      ) {
        let csvContent;
        if (uploadedFile.tempFilePath) {
          const fs = require("fs");
          csvContent = fs.readFileSync(uploadedFile.tempFilePath, "utf8");
        } else if (uploadedFile.data) {
          csvContent = uploadedFile.data.toString("utf8");
        } else {
          throw new Error("Unable to access file content");
        }

        // Remove BOM if present
        if (csvContent.charCodeAt(0) === 0xfeff) {
          csvContent = csvContent.slice(1);
        }

        const lines = csvContent
          .split(/\r\n|\n|\r/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        if (lines.length === 0) {
          return res.status(400).json({
            success: false,
            message: "No valid data lines found in CSV file",
          });
        }

        data = lines.map((line) => {
          const result = [];
          let current = "";
          let inQuotes = false;

          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === "," && !inQuotes) {
              result.push(current.trim().replace(/^"|"$/g, ""));
              current = "";
            } else {
              current += char;
            }
          }
          result.push(current.trim().replace(/^"|"$/g, ""));
          return result;
        });
      } else {
        // Parse Excel
        let excelData;
        if (uploadedFile.tempFilePath) {
          const fs = require("fs");
          excelData = fs.readFileSync(uploadedFile.tempFilePath);
        } else if (uploadedFile.data) {
          excelData = uploadedFile.data;
        } else {
          throw new Error("Unable to access file content");
        }

        const XLSX = require("xlsx");
        const workbook = XLSX.read(excelData, { type: "buffer" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        data = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: "",
          raw: false,
        });
      }

      if (data.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No data found in file",
        });
      }

      console.log(`📊 Parsed ${data.length} rows from campaign email file`);

      // Get headers (first row)
      const headers = data[0];
      const rows = data.slice(1);

      console.log(`📋 Headers: ${headers.join(", ")}`);

      // Map headers for email and name fields
      const fieldMapping = {};
      headers.forEach((header, index) => {
        const normalizedHeader = header.toLowerCase().trim();

        if (
          normalizedHeader === "email" ||
          normalizedHeader.includes("email")
        ) {
          fieldMapping.email = index;
        } else if (
          normalizedHeader === "firstname" ||
          normalizedHeader.includes("firstname") ||
          normalizedHeader.includes("first name") ||
          normalizedHeader.includes("name")
        ) {
          fieldMapping.name = index;
        } else if (
          normalizedHeader === "lastname" ||
          normalizedHeader.includes("lastname") ||
          normalizedHeader.includes("last name")
        ) {
          fieldMapping.lastName = index;
        }
      });

      console.log(`📋 Field mapping for campaign emails:`, fieldMapping);

      // Validate required columns
      if (fieldMapping.email === undefined) {
        return res.status(400).json({
          success: false,
          message:
            "Required columns not found. File must contain 'Email' column.",
        });
      }

      // Process each row for email sending
      const results = {
        total: rows.length,
        successful: 0,
        failed: 0,
        errors: [],
      };

      console.log(
        `📧 Processing ${rows.length} rows for campaign email sending...`
      );

      // Prepare recipients
      const recipients = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 2; // +2 because of 0-based index and header row

        try {
          const email =
            fieldMapping.email !== undefined
              ? row[fieldMapping.email]?.trim()
              : "";
          const firstName =
            fieldMapping.name !== undefined
              ? row[fieldMapping.name]?.trim()
              : "";
          const lastName =
            fieldMapping.lastName !== undefined
              ? row[fieldMapping.lastName]?.trim()
              : "";

          if (!email) {
            results.errors.push(`Row ${rowNumber}: Email is required`);
            results.failed++;
            continue;
          }

          // Validate email format
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email)) {
            results.errors.push(
              `Row ${rowNumber}: Invalid email format: ${email}`
            );
            results.failed++;
            continue;
          }

          // Build full name
          let fullName = "";
          if (firstName && lastName) {
            fullName = `${firstName} ${lastName}`;
          } else if (firstName) {
            fullName = firstName;
          } else {
            fullName = "IUEA Student";
          }

          recipients.push({
            email: email.toLowerCase(),
            name: fullName,
            firstName: firstName,
          });

          console.log(`✅ Added recipient: ${email} (${fullName})`);
        } catch (error) {
          console.error(`❌ Error processing row ${rowNumber}:`, error);
          results.errors.push(`Row ${rowNumber}: ${error.message}`);
          results.failed++;
        }
      }

      if (recipients.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid recipients found in file",
          errors: results.errors,
        });
      }

      console.log(`📧 Found ${recipients.length} valid recipients`);

      // Initialize campaign email service
      const CampaignEmailService = require("../services/campaignEmailService");
      const campaignEmailService = new CampaignEmailService();

      // Parse custom content if provided, otherwise use default content
      let campaignContent = {
        greeting: "Dear Student",
        mainMessage:
          "We are pleased to connect with you regarding your academic journey at IUEA.",
        additionalInfo:
          "If you have any questions or need assistance, please don't hesitate to contact our admissions office at info@iuea.ac.ug or call us at +256 414 373 747.",
        callToAction:
          "We look forward to supporting your academic journey at IUEA and helping you achieve your educational goals.",
        universityName: "International University of East Africa",
        academicYear: "2024/2025",
      };

      if (customContent) {
        try {
          const parsedContent = JSON.parse(customContent);
          // Merge with defaults, allowing custom content to override
          campaignContent = { ...campaignContent, ...parsedContent };
          console.log(`📧 Using custom campaign content merged with defaults`);
        } catch (parseError) {
          console.warn(
            `⚠️ Failed to parse custom content, using defaults:`,
            parseError.message
          );
          // campaignContent already has defaults, so we continue
        }
      } else {
        console.log(
          `📧 Using default campaign content (no custom content provided)`
        );
      }

      // Send bulk campaign emails
      console.log(`📧 Starting bulk campaign email send...`);
      const emailResults = await campaignEmailService.sendBulkCampaignEmails({
        recipients: recipients,
        subject: subject,
        content: campaignContent,
        batchSize: 20, // Increased batch size for better performance with large datasets
      });

      // Update results
      results.successful = emailResults.successful;
      results.failed += emailResults.failed;
      results.errors = [...results.errors, ...emailResults.errors];
      results.total = recipients.length; // Update total to reflect valid recipients only

      console.log(`📊 Campaign email sending completed:`, results);

      // Generate CSV report data for download
      const csvData = recipients.map((recipient, index) => {
        const isSuccessful = index < results.successful;
        const errorMessage = !isSuccessful
          ? results.errors[index - results.successful] || "Unknown error"
          : "";

        return {
          email: recipient.email,
          name: recipient.name || "N/A",
          status: isSuccessful ? "Sent" : "Failed",
          error: errorMessage,
          timestamp: new Date().toISOString(),
          subject: subject,
        };
      });

      res.json({
        success: true,
        message: `Campaign email sending completed. ${results.successful} emails sent successfully, ${results.failed} failed`,
        stats: results,
        errors: results.errors.slice(0, 20), // Show more errors for email campaigns
        csvData: csvData, // Include CSV data for frontend to generate report
      });
    } catch (error) {
      console.error("❌ Error during campaign email import:", error);
      res.status(500).json({
        success: false,
        message: "Failed to send campaign emails",
        error: error.message,
      });
    }
  }
);

// Generate CSV report for email campaign results
router.post(
  "/generate-email-report",
  authenticateUser,
  checkRole(["superAdmin", "admin", "admissionAdmin", "admissionAgent"]),
  async (req, res) => {
    try {
      console.log(
        `📊 Email report generation request from user: ${req.user?.email}`
      );

      const { reportData } = req.body;

      if (!reportData || !Array.isArray(reportData)) {
        return res.status(400).json({
          success: false,
          message: "Invalid report data provided",
        });
      }

      // Generate CSV content
      const csvHeaders = [
        "Email",
        "Name",
        "Status",
        "Error Message",
        "Timestamp",
        "Subject",
      ];
      const csvRows = reportData.map((row) => [
        row.email || "",
        row.name || "",
        row.status || "",
        row.error || "",
        row.timestamp || "",
        row.subject || "",
      ]);

      // Convert to CSV format
      const csvContent = [
        csvHeaders.join(","),
        ...csvRows.map((row) =>
          row.map((field) => `"${String(field).replace(/"/g, '""')}"`).join(",")
        ),
      ].join("\n");

      // Set headers for file download
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `email-campaign-report-${timestamp}.csv`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Pragma", "no-cache");

      console.log(
        `📊 Generated CSV report: ${filename} with ${reportData.length} records`
      );

      res.send(csvContent);
    } catch (error) {
      console.error("❌ Error generating email report:", error);
      res.status(500).json({
        success: false,
        message: "Failed to generate email report",
        error: error.message,
      });
    }
  }
);

module.exports = router;
