const express = require("express");
const router = express.Router();
const { admin } = require("../config/firebase.config");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const { authenticateUser } = require("../middleware/auth.middleware");
const emailService = require("../services/emailService");

// Debug middleware with better logging
router.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.body && req.url !== "/login") {
    // Don't log passwords
    const sanitizedBody = { ...req.body };
    if (sanitizedBody.password) sanitizedBody.password = "********";
    console.log("Request body:", JSON.stringify(sanitizedBody, null, 2));
  }
  next();
});

// Check if email exists in Firebase
router.post("/check-email", async (req, res) => {
  try {
    const { email } = req.body;
    console.log("Checking email existence:", email);

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    const auth = admin.auth();

    try {
      const userRecord = await auth.getUserByEmail(email);
      console.log("User found:", userRecord.uid);
      return res.json({
        success: true,
        exists: true,
        message: "User exists",
      });
    } catch (error) {
      console.log("User lookup error:", error.code, error.message);
      if (error.code === "auth/user-not-found") {
        return res.json({
          success: true,
          exists: false,
          message: "User does not exist",
        });
      }
      throw error;
    }
  } catch (error) {
    console.error("Check email error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to check email existence",
      details: error.message,
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    console.log("Login attempt received for:", req.body.email);
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
      });
    }

    // Get Firebase API key from environment variables
    const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey) {
      throw new Error("Firebase API key not configured");
    }

    try {
      // Use the Firebase Auth REST API to verify credentials directly
      const authUrl =
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";
      const authResponse = await axios.post(`${authUrl}?key=${apiKey}`, {
        email,
        password,
        returnSecureToken: true,
      });

      // If we get here, authentication was successful
      console.log("Firebase auth successful");

      // Get the Firebase user ID from the response
      const firebaseUid = authResponse.data.localId;

      // Get user data from Firestore
      const db = admin.firestore();
      let userData = null;
      let userRole = null;

      // Check if system admin
      const systemAdminDoc = await db
        .collection("systemAdmins")
        .doc(firebaseUid)
        .get();

      if (systemAdminDoc.exists) {
        userData = {
          id: firebaseUid,
          ...systemAdminDoc.data(),
          role: "systemAdmin",
        };
        userRole = "systemAdmin";
      } else {
        // Check regular users
        const userDoc = await db.collection("users").doc(firebaseUid).get();

        if (userDoc.exists) {
          userData = {
            id: firebaseUid,
            ...userDoc.data(),
          };
          userRole = userData.role || userData.jobRole;

          // If user has organizationId, get organization data
          if (userData.organizationId) {
            const orgDoc = await db
              .collection("organizations")
              .doc(userData.organizationId)
              .get();

            if (orgDoc.exists) {
              organizationData = {
                id: orgDoc.id,
                ...orgDoc.data(),
              };

              // Add organization data to user object
              userData.organization = organizationData;
            }
          }
        } else {
          // User exists in Firebase Auth but not in Firestore
          return res.status(404).json({
            success: false,
            error: "User account exists but profile data is missing",
          });
        }
      }

      if (!userData) {
        return res.status(404).json({
          success: false,
          error: "User profile not found",
        });
      }

      if (!userRole) {
        return res.status(403).json({
          success: false,
          error: "User has no assigned role",
        });
      }

      // Create JWT token
      const token = jwt.sign(
        {
          uid: firebaseUid,
          email: email,
          role: userRole,
          organizationId: userData.organizationId || null,
        },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      // Update the user's lastLogin timestamp in Firestore
      try {
        if (systemAdminDoc.exists) {
          await db.collection("systemAdmins").doc(firebaseUid).update({
            lastLogin: admin.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          await db.collection("users").doc(firebaseUid).update({
            lastLogin: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (updateError) {
        console.warn("Failed to update lastLogin time:", updateError);
        // Continue with login even if this fails
      }

      return res.json({
        success: true,
        token,
        user: userData,
      });
    } catch (authError) {
      // Handle authentication errors
      console.error(
        "Authentication error details:",
        authError.response?.data || authError
      );

      // Extract specific Firebase error message
      const errorData = authError.response?.data?.error;
      const errorMessage = errorData?.message;

      if (
        errorMessage === "INVALID_LOGIN_CREDENTIALS" ||
        errorMessage === "INVALID_PASSWORD" ||
        errorMessage === "EMAIL_NOT_FOUND"
      ) {
        return res.status(401).json({
          success: false,
          error: "Invalid email or password",
        });
      } else if (errorMessage === "USER_DISABLED") {
        return res.status(403).json({
          success: false,
          error: "This account has been disabled",
        });
      } else if (errorMessage) {
        return res.status(401).json({
          success: false,
          error: `Authentication failed: ${errorMessage}`,
        });
      }

      return res.status(401).json({
        success: false,
        error: "Authentication failed",
      });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      error: "Server error during authentication",
    });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    console.log("Forgot password request for email:", email);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // First verify the email exists in Firebase
    const auth = admin.auth();

    try {
      await auth.getUserByEmail(email);
      console.log(
        `User found for email: ${email}, proceeding with password reset`
      );
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        console.log(`User not found for email: ${email}`);
        return res.status(404).json({
          success: false,
          message: "No account exists with this email address",
        });
      }
      throw error;
    }

    // Generate password reset link using Firebase
    console.log("Generating password reset link...");
    const resetLink = await auth.generatePasswordResetLink(email, {
      url:
        process.env.PASSWORD_RESET_URL ||
        `${process.env.FRONTEND_URL || "http://localhost:3001"}/reset-password`,
    });

    console.log("Generated reset link");

    // Send email with the reset link
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    const mailOptions = {
      from:
        process.env.EMAIL_FROM ||
        `"Nyota AI Fusion" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Reset Your Password - Nyota AI Fusion",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50;">Reset Your Password</h2>
          <p>You requested to reset your password for your Nyota AI Fusion account.</p>
          <p>Click the button below to reset your password:</p>
          <a href="${resetLink}" 
            style="background-color: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 16px 0;">
            Reset Password
          </a>
          <p style="color: #7f8c8d;">
            If you didn't request this, please ignore this email or contact support if you have concerns.
          </p>
          <hr style="border: 1px solid #eee; margin: 20px 0;">
          <p style="color: #7f8c8d; font-size: 0.8em;">
            This link will expire in 1 hour for security reasons.
          </p>
        </div>
      `,
    };

    console.log("Sending password reset email to:", email);
    const info = await transporter.sendMail(mailOptions);
    console.log("Password reset email sent:", info.messageId);

    return res.json({
      success: true,
      message: "Password reset email sent. Check your inbox.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process password reset request",
    });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // In a real implementation, you would need to handle the token verification
    // For now, we'll return a simplified response
    res.json({
      success: true,
      message: "Password has been reset successfully",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message || "Failed to reset password",
    });
  }
});

router.post("/verify-token", authenticateUser, async (req, res) => {
  try {
    // If the authenticateUser middleware passed, the token is valid
    // and req.user contains the authenticated user data
    console.log("User verified:", req.user);

    // Get more user details from Firestore
    const db = admin.firestore();
    let userData = null;
    let organizationData = null;

    // Check if system admin
    const systemAdminDoc = await db
      .collection("systemAdmins")
      .doc(req.user.uid)
      .get();

    if (systemAdminDoc.exists) {
      userData = {
        id: req.user.uid,
        ...systemAdminDoc.data(),
        role: "systemAdmin",
      };
    } else {
      // Check regular users
      const userDoc = await db.collection("users").doc(req.user.uid).get();

      if (userDoc.exists) {
        userData = {
          id: req.user.uid,
          ...userDoc.data(),
        };

        // If user has organizationId, get organization data
        if (userData.organizationId) {
          const orgDoc = await db
            .collection("organizations")
            .doc(userData.organizationId)
            .get();

          if (orgDoc.exists) {
            organizationData = {
              id: orgDoc.id,
              ...orgDoc.data(),
            };

            // Add organization data to user object
            userData.organization = organizationData;
          }
        }
      }
    }

    // Create new JWT with updated data
    const token = jwt.sign(
      {
        uid: req.user.uid,
        email: req.user.email,
        role: req.user.role,
        organizationId: req.user.organizationId || null,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({
      isValid: true,
      token,
      user: userData,
    });
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(401).json({
      isValid: false,
      error: "Invalid token",
    });
  }
});

router.post("/logout", authenticateUser, (req, res) => {
  // Since we're using JWTs, there's no server-side session to invalidate
  // The client should remove the token from local storage
  res.json({
    success: true,
    message: "Logged out successfully",
  });
});

module.exports = router;
