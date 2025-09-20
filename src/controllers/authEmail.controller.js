/**
 * Authentication Email Controller
 * Handles custom branded authentication emails for applicant portal
 */

const emailService = require("../services/emailService");
const logger = require("../utils/logger");
const admin = require("firebase-admin");

class AuthEmailController {
  /**
   * Send custom branded email verification
   */
  sendEmailVerification = async (req, res) => {
    try {
      const { email, userName, redirectUrl, portalType = "student" } = req.body;

      // Validation
      if (!email) {
        return res.status(400).json({
          success: false,
          error: "Email is required",
        });
      }

      if (!userName) {
        return res.status(400).json({
          success: false,
          error: "User name is required",
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: "Invalid email format",
        });
      }

      // Send branded email verification
      const result = await this.sendBrandedEmailVerification({
        email,
        userName,
        redirectUrl: redirectUrl || `https://student.iuea.ac.ug/verify-email`,
        portalType,
      });

      if (result.success) {
        logger.info(`Custom email verification sent successfully to ${email}`, {
          email,
          userName,
          portalType,
          messageId: result.messageId,
          provider: result.provider,
        });

        return res.json({
          success: true,
          message: "Email verification sent successfully",
          messageId: result.messageId,
          provider: result.provider,
        });
      } else {
        logger.error(`Failed to send email verification to ${email}`, {
          email,
          userName,
          error: result.error,
          provider: result.provider,
        });

        return res.status(500).json({
          success: false,
          error: result.error || "Failed to send email verification",
          provider: result.provider,
        });
      }
    } catch (error) {
      logger.error("Email verification controller error:", error);
      console.error("Full error details:", error); // Add detailed logging
      return res.status(500).json({
        success: false,
        error: "Server error while sending email verification",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  };

  /**
   * Send custom branded password reset email
   */
  sendPasswordReset = async (req, res) => {
    try {
      const { email, userName, portalType = "student", frontendUrl } = req.body;

      // Validation
      if (!email) {
        return res.status(400).json({
          success: false,
          error: "Email is required",
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: "Invalid email format",
        });
      }

      // Generate Firebase password reset link using Admin SDK
      let resetUrl;
      try {
        const actionCodeSettings = {
          url:
            frontendUrl ||
            process.env.STUDENT_PORTAL_URL ||
            "https://student.iuea.ac.ug",
          handleCodeInApp: false, // This will use the default Firebase password reset flow
        };

        resetUrl = await admin
          .auth()
          .generatePasswordResetLink(email, actionCodeSettings);
        logger.info(`Firebase password reset link generated for ${email}`);
      } catch (firebaseError) {
        logger.error(
          `Failed to generate Firebase reset link for ${email}:`,
          firebaseError
        );

        // Handle specific Firebase errors
        if (firebaseError.code === "auth/user-not-found") {
          return res.status(404).json({
            success: false,
            error: "No account found with this email address",
          });
        } else if (firebaseError.code === "auth/invalid-email") {
          return res.status(400).json({
            success: false,
            error: "Invalid email address",
          });
        } else {
          return res.status(500).json({
            success: false,
            error: "Failed to generate password reset link",
            details:
              process.env.NODE_ENV === "development"
                ? firebaseError.message
                : undefined,
          });
        }
      }

      // Send branded password reset email with the Firebase-generated link
      const result = await this.sendBrandedPasswordReset({
        email,
        userName: userName || "Student",
        resetUrl, // Use the Firebase-generated URL directly
        frontendUrl: frontendUrl || process.env.STUDENT_PORTAL_URL,
        portalType,
      });

      if (result.success) {
        logger.info(`Custom password reset sent successfully to ${email}`, {
          email,
          userName,
          portalType,
          messageId: result.messageId,
          provider: result.provider,
        });

        return res.json({
          success: true,
          message: "Password reset email sent successfully",
          messageId: result.messageId,
          provider: result.provider,
        });
      } else {
        logger.error(`Failed to send password reset to ${email}`, {
          email,
          userName,
          error: result.error,
          provider: result.provider,
        });

        return res.status(500).json({
          success: false,
          error: result.error || "Failed to send password reset email",
          provider: result.provider,
        });
      }
    } catch (error) {
      logger.error("Password reset controller error:", error);
      console.error("Full error details:", error); // Add detailed logging
      return res.status(500).json({
        success: false,
        error: "Server error while sending password reset email",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  };

  /**
   * Send verification reminder
   */
  sendVerificationReminder = async (req, res) => {
    try {
      const { email, userName, portalType = "student" } = req.body;

      // Validation
      if (!email || !userName) {
        return res.status(400).json({
          success: false,
          error: "Email and user name are required",
        });
      }

      // Send verification reminder
      const result = await this.sendBrandedVerificationReminder({
        email,
        userName,
        portalType,
      });

      if (result.success) {
        logger.info(`Verification reminder sent successfully to ${email}`, {
          email,
          userName,
          portalType,
          messageId: result.messageId,
        });

        return res.json({
          success: true,
          message: "Verification reminder sent successfully",
          messageId: result.messageId,
        });
      } else {
        return res.status(500).json({
          success: false,
          error: result.error || "Failed to send verification reminder",
        });
      }
    } catch (error) {
      logger.error("Verification reminder controller error:", error);
      console.error("Full error details:", error); // Add detailed logging
      return res.status(500).json({
        success: false,
        error: "Server error while sending verification reminder",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  };

  /**
   * Internal method to send branded email verification
   * Now uses Firebase Admin to generate a real verification link with oobCode
   */
  sendBrandedEmailVerification = async ({
    email,
    userName,
    redirectUrl,
    portalType,
  }) => {
    // Build action code settings so the link returns to our verify page
    const continueUrl = (() => {
      if (redirectUrl) return redirectUrl;
      const base =
        process.env.STUDENT_PORTAL_URL || "https://applicant.iuea.ac.ug";
      return `${base.replace(/\/$/, "")}/verify-email`;
    })();

    let verificationUrl = `${continueUrl}`;
    try {
      const actionCodeSettings = {
        url: continueUrl, // Where to land after handling the code
        handleCodeInApp: true, // We'll handle the action via applyActionCode on the client
      };

      const firebaseLink = await admin
        .auth()
        .generateEmailVerificationLink(email, actionCodeSettings);
      logger.info(`Firebase verification link generated for ${email}`);

      // Convert Firebase link to a direct app link with oobCode for silent verification
      try {
        const parsed = new URL(firebaseLink);
        const oobCode = parsed.searchParams.get("oobCode");
        if (oobCode) {
          const direct = new URL(continueUrl);
          direct.searchParams.set("mode", "verifyEmail");
          direct.searchParams.set("oobCode", oobCode);
          verificationUrl = direct.toString();
        } else {
          verificationUrl = firebaseLink; // Fallback
        }
      } catch (parseErr) {
        logger.warn(
          "Failed to parse Firebase verification link; using original link",
          {
            error: parseErr?.message,
          }
        );
        verificationUrl = firebaseLink;
      }
    } catch (firebaseError) {
      logger.error(
        `Failed to generate Firebase verification link for ${email}:`,
        firebaseError
      );
      // Fallback: keep using the plain continue URL so the user can at least reach the verify page
      // Note: This won't verify the email, so frontend should prompt to resend
    }

    const emailOptions = {
      to: email,
      replyTo: "apply@iuea.ac.ug",
      subject: "🎓 Verify Your Email - IUEA Student Portal",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="color-scheme" content="light dark">
          <meta name="supported-color-schemes" content="light dark">
          <title>Email Verification - IUEA Applicant Portal</title>
          <style>
            :root { color-scheme: light dark; supported-color-schemes: light dark; }
            @media (prefers-color-scheme: dark) {
              .email-body { background-color: #121212 !important; color: #eaeaea !important; }
              .container, .content, .card { background-color: #1e1e1e !important; }
              .footer { background-color: #121212 !important; }
              p, li, h1, h2, h3, h4, h5, h6 { color: #e1e1e1 !important; }
              a { color: #ffb300 !important; }
              .button { background: linear-gradient(135deg, #a00000 0%, #c00000 100%) !important; color: #ffffff !important; }
              .info { background-color: #1e2a35 !important; border-left-color: #1976d2 !important; }
              .warning { background-color: #2a2415 !important; border-left-color: #ffc107 !important; color: #e2d9a6 !important; }
              .danger { background-color: #3a2023 !important; border-left-color: #dc3545 !important; color: #f3c2c6 !important; }
              .linkbox, .code { background-color: #111111 !important; border-color: #333333 !important; color: #ffb300 !important; }
            }
            /* Outlook.com / Windows 10 Mail dark mode */
            [data-ogsc] .email-body { background-color: #121212 !important; color: #eaeaea !important; }
            [data-ogsc] .container, [data-ogsc] .content, [data-ogsc] .card { background-color: #1e1e1e !important; }
            [data-ogsc] .footer { background-color: #121212 !important; }
            [data-ogsc] a { color: #ffb300 !important; }
            [data-ogsc] .info { background-color: #1e2a35 !important; border-left-color: #1976d2 !important; }
            [data-ogsc] .warning { background-color: #2a2415 !important; border-left-color: #ffc107 !important; color: #e2d9a6 !important; }
            [data-ogsc] .linkbox { background-color: #111111 !important; border-color: #333333 !important; color: #ffb300 !important; }
          </style>
        </head>
        <body class="email-body" style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div class="container" style="background-color: #f8f9fa; padding: 30px; border-radius: 10px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #7a0000; margin-bottom: 5px;">International University of East Africa</h1>
              <p style="color: #666; margin: 0; font-size: 14px;">Applicant Portal - Email Verification</p>
              <p style="color: #666; margin: 0; font-size: 14px;">Ggaba Street, Kansanga, Kampala, Uganda</p>
            </div>
            
            <div class="card" style="background-color: white; padding: 30px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #7a0000; margin-top: 0;">Welcome to IUEA, ${userName}! 🎓</h2>
              <p style="font-size: 16px; margin-bottom: 20px;">Thank you for creating your account with the IUEA Applicant Portal. To complete your registration and secure your account, please verify your email address.</p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" class="button" style="background-color: #7a0000; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; display: inline-block; text-transform: uppercase;">
                  ✅ Verify Email Address
                </a>
              </div>
              
              <p style="font-size: 14px; color: #666; text-align: center;">If the button doesn't work, copy and paste this link into your browser:</p>
              <p class="linkbox" style="font-size: 14px; color: #7a0000; word-break: break-all; text-align: center; background-color: #f8f9fa; padding: 10px; border-radius: 5px;">${verificationUrl}</p>
              
              <div class="info" style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2196f3;">
                <h3 style="color: #1976d2; margin-top: 0; font-size: 16px;">🚀 What's Next?</h3>
                <ul style="color: #666; line-height: 1.8; margin: 0; padding-left: 20px;">
                  <li>Complete your applicant profile</li>
                  <li>Submit your course applications</li>
                  <li>Track your application status</li>
                  <li>Access learning resources</li>
                </ul>
              </div>
            </div>
            
            <div class="warning" style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <p style="margin: 0; font-size: 14px; color: #856404;"><strong>⚠️ Security Notice:</strong> This verification link is valid for 24 hours. If you didn't create this account, please ignore this email.</p>
            </div>
            
            <div class="footer" style="text-align: center; margin: 30px 0; padding: 20px; background-color: #f8f9fa; border-radius: 8px;">
              <p style="margin: 0; font-size: 16px; font-weight: bold; color: #7a0000;">🌟 Welcome to the IUEA Family!</p>
              <p style="margin: 10px 0; color: #666;">Access your applicant portal at:</p>
              <a href="${
                process.env.STUDENT_PORTAL_URL || "https://student.iuea.ac.ug"
              }"
                 class="button"
                 style="display: inline-block; background: linear-gradient(135deg, #7a0000 0%, #a50000 100%);
                        color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px;
                        font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                Open Applicant Portal
              </a>
            </div>
            
            <p style="font-size: 16px;">Need help? Contact our admissions team at <a href="mailto:apply@iuea.ac.ug" style="color: #7a0000;">apply@iuea.ac.ug</a> or call us at +256 790 002 000.</p>
            
            <br>
            <p style="font-size: 16px;">Best regards,<br>
            <strong>IUEA Applicant Support Team</strong><br>
            <span style="font-size: 14px; color: #666;">International University of East Africa</span></p>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="font-size: 12px; color: #999; margin: 0;">
                Learning to succeed | www.iuea.ac.ug
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `International University of East Africa
Applicant Portal - Email Verification
Ggaba Street, Kansanga, Kampala, Uganda

Welcome to IUEA, ${userName}!

Thank you for creating your account with the IUEA Applicant Portal. To complete your registration and secure your account, please verify your email address.

Click this link to verify your email: ${verificationUrl}

What's Next:
- Complete your applicant profile
- Submit your course applications  
- Track your application status
- Access learning resources

Security Notice: This verification link is valid for 24 hours. If you didn't create this account, please ignore this email.

Welcome to the IUEA Family!
Access your applicant portal at: ${
        process.env.STUDENT_PORTAL_URL || "https://student.iuea.ac.ug"
      }

Need help? Contact our admissions team at apply@iuea.ac.ug or call us at +256 790 002 000.

Best regards,
IUEA Applicant Support Team
International University of East Africa

Learning to succeed | www.iuea.ac.ug`,
    };

    return await emailService.sendEmail(emailOptions);
  };

  /**
   * Internal method to send branded password reset
   */
  sendBrandedPasswordReset = async ({
    email,
    userName,
    resetUrl, // Now expects the complete Firebase-generated URL
    frontendUrl,
    portalType,
  }) => {
    const emailOptions = {
      to: email,
      subject: "🔑 Reset Your IUEA Applicant Portal Password - Action Required",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="color-scheme" content="light dark">
          <meta name="supported-color-schemes" content="light dark">
          <title>Password Reset - IUEA Applicant Portal</title>
          <style>
            :root { color-scheme: light dark; supported-color-schemes: light dark; }
            @media only screen and (max-width: 600px) {
              .container { width: 100% !important; padding: 10px !important; }
              .content { padding: 20px !important; }
              .button { padding: 12px 25px !important; font-size: 14px !important; }
            }
            @media (prefers-color-scheme: dark) {
              .email-body { background-color: #121212 !important; color: #eaeaea !important; }
              .container { background-color: #1e1e1e !important; }
              .content { background-color: #1e1e1e !important; }
              .header { background: linear-gradient(135deg, #5e0000 0%, #800000 100%) !important; }
              .button { background: linear-gradient(135deg, #a00000 0%, #c00000 100%) !important; color: #ffffff !important; }
              .altlink { background-color: #111111 !important; border-color: #333333 !important; color: #ffb300 !important; }
              .security { background-color: #2a2415 !important; border-left-color: #ffc107 !important; color: #e2d9a6 !important; }
              p, li, h1, h2, h3, h4, h5, h6 { color: #e1e1e1 !important; }
              a { color: #ffb300 !important; }
              .footer { background-color: #121212 !important; }
            }
            [data-ogsc] .email-body { background-color: #121212 !important; color: #eaeaea !important; }
            [data-ogsc] .container { background-color: #1e1e1e !important; }
            [data-ogsc] .content { background-color: #1e1e1e !important; }
            [data-ogsc] .footer { background-color: #121212 !important; }
            [data-ogsc] a { color: #ffb300 !important; }
            [data-ogsc] .altlink { background-color: #111111 !important; border-color: #333333 !important; color: #ffb300 !important; }
          </style>
        </head>
        <body class="email-body" style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fa;">
          <div class="container" style="max-width: 650px; margin: 0 auto; background-color: #ffffff;">
            
            <!-- Header with IUEA Branding -->
            <div class="header" style="background: linear-gradient(135deg, #7a0000 0%, #a50000 100%); padding: 40px 30px; text-align: center;">
              <div style="background-color: rgba(255,255,255,0.1); padding: 20px; border-radius: 15px; backdrop-filter: blur(10px);">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
                  🎓 INTERNATIONAL UNIVERSITY<br>OF EAST AFRICA
                </h1>
                <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">
                  APPLICANT PORTAL - SECURE PASSWORD RESET
                </p>
                <div style="width: 60px; height: 3px; background-color: #ffd700; margin: 15px auto; border-radius: 2px;"></div>
              </div>
            </div>
            
            <!-- Main Content -->
            <div class="content" style="padding: 40px 30px;">
              
              <!-- Welcome Section -->
              <div style="text-align: center; margin-bottom: 35px;">
                <div style="display: inline-block; background-color: #fff3cd; padding: 12px; border-radius: 50%; margin-bottom: 20px;">
                  <span style="font-size: 32px;">🔐</span>
                </div>
                <h2 style="color: #7a0000; margin: 0; font-size: 26px; font-weight: 600;">
                  Password Reset Request
                </h2>
                <p style="color: #666; margin: 10px 0 0 0; font-size: 16px;">
                  Secure access to your academic portal
                </p>
              </div>
              
              <!-- Personal Message -->
              <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); padding: 25px; border-radius: 12px; border-left: 5px solid #7a0000; margin-bottom: 30px;">
                <p style="margin: 0; font-size: 18px; color: #333; line-height: 1.6;">
                  Dear <strong style="color: #7a0000;">${userName}</strong>,
                </p>
                <p style="margin: 15px 0 0 0; font-size: 16px; color: #555; line-height: 1.6;">
                  We received a request to reset the password for your <strong>IUEA Applicant Portal</strong> account. 
                  To maintain the security of your academic records and personal information, please reset your password using the secure link below.
                </p>
              </div>
              
              <!-- CTA Button -->
              <div style="text-align: center; margin: 35px 0;">
           <a href="${resetUrl}" 
             class="button"
                   style="display: inline-block; background: linear-gradient(135deg, #7a0000 0%, #a50000 100%); 
                          color: #ffffff; padding: 16px 35px; text-decoration: none; border-radius: 8px; 
                          font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
                          box-shadow: 0 4px 15px rgba(122, 0, 0, 0.3); transition: all 0.3s ease;">
                  🔓 RESET MY PASSWORD
                </a>
                <p style="margin: 20px 0 0 0; font-size: 14px; color: #666;">
                  This link will expire in <strong style="color: #dc3545;">60 minutes</strong> for your security
                </p>
              </div>
              
              <!-- Alternative Link -->
              <div class="altlink" style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #666; text-align: center;">
                  If the button above doesn't work, copy and paste this link into your browser:
                </p>
                <p style="margin: 0; font-size: 13px; color: #7a0000; word-break: break-all; 
                          background-color: #ffffff; padding: 12px; border-radius: 6px; border: 2px dashed #dee2e6;
                          font-family: 'Courier New', monospace; text-align: center;">
                  ${resetUrl}
                </p>
              </div>
              
              
              
              <!-- Security Notice -->
              <div class="security" style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h4 style="color: #856404; margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">
                  🛡️ Security Information
                </h4>
                <ul style="margin: 0; padding-left: 20px; color: #856404; line-height: 1.6;">
                  <li>This password reset link expires in <strong>60 minutes</strong></li>
                  <li>Only use this link if you requested a password reset</li>
                  <li>After resetting, you'll need to log in with your new password</li>
                  <li>Your academic data remains secure throughout this process</li>
                </ul>
              </div>
              
              <!-- Didn't Request This -->
              <div style="background-color: #f8d7da; border-left: 4px solid #dc3545; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h4 style="color: #721c24; margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">
                  ❌ Didn't Request This Reset?
                </h4>
                <p style="margin: 0; color: #721c24; line-height: 1.6;">
                  If you did not request this password reset, please <strong>ignore this email</strong>. 
                  Your password will remain unchanged and your account stays secure. 
                  Consider reviewing your account security settings if you receive unexpected password reset requests.
                </p>
              </div>
              
            </div>
            
            <!-- Footer -->
            <div class="footer" style="background-color: #f8f9fa; padding: 30px; border-top: 3px solid #7a0000;">
              <div style="text-align: center; margin-bottom: 25px;">
                <h3 style="color: #7a0000; margin: 0 0 10px 0; font-size: 20px; font-weight: 600;">
                  🎓 IUEA Applicant Support
                </h3>
                <p style="color: #666; margin: 0; font-size: 14px;">
                  Your academic success is our priority
                </p>
              </div>
              
              <div style="text-align: center; margin-bottom: 25px;">
                <p style="margin: 0 0 10px 0; color: #333; font-size: 16px;">
                  <strong>Access Your Portal:</strong>
                </p>
                <a href="${frontendUrl}"
                   class="button"
                   style="display: inline-block; background: linear-gradient(135deg, #7a0000 0%, #a50000 100%);
                          color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px;
                          font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                  Open Applicant Portal
                </a>
              </div>
              
              <div style="text-align: center; border-top: 1px solid #dee2e6; padding-top: 20px;">
                <p style="margin: 0 0 5px 0; color: #666; font-size: 14px;">
                  <strong>Need Help?</strong>
                </p>
                <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">
                  📧 <a href="mailto:apply@iuea.ac.ug" style="color: #7a0000; text-decoration: none;">apply@iuea.ac.ug</a> 
                  | 📞 +256 790 002 000
                </p>
                <p style="margin: 0; color: #666; font-size: 14px;">
                  📍 Ggaba Street, Kansanga, Kampala, Uganda
                </p>
              </div>
              
              <div style="text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6;">
                <p style="margin: 0; color: #999; font-size: 12px;">
                  <strong style="color: #7a0000;">International University of East Africa</strong><br>
                  Learning to Succeed | www.iuea.ac.ug
                </p>
              </div>
            </div>
            
          </div>
        </body>
        </html>
      `,
      text: `
═══════════════════════════════════════════════════════════════
🎓 INTERNATIONAL UNIVERSITY OF EAST AFRICA
APPLICANT PORTAL - SECURE PASSWORD RESET
Ggaba Street, Kansanga, Kampala, Uganda
═══════════════════════════════════════════════════════════════

🔐 PASSWORD RESET REQUEST

Dear ${userName},

We received a request to reset the password for your IUEA Applicant Portal 
account. To maintain the security of your academic records and personal 
information, please reset your password using the secure link below.

RESET YOUR PASSWORD:
${resetUrl}

⏰ IMPORTANT: This link expires in 60 minutes for your security.

═══════════════════════════════════════════════════════════════
🛡️ SECURITY INFORMATION

✓ This password reset link expires in 60 minutes
✓ Only use this link if you requested a password reset  
✓ After resetting, log in with your new password
✓ Your academic data remains secure throughout this process

❌ DIDN'T REQUEST THIS RESET?
If you did not request this password reset, please ignore this email. 
Your password will remain unchanged and your account stays secure.

═══════════════════════════════════════════════════════════════
🎓 IUEA APPLICANT SUPPORT

Access Your Portal: ${frontendUrl || "https://student.iuea.ac.ug"}

Need Help?
                           <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">
                             � Email: <a href="mailto:apply@iuea.ac.ug" style="color: #7a0000; text-decoration: none;">apply@iuea.ac.ug</a> 
                             | 📱 Phone: +256 790 002 000
                           </p>
International University of East Africa
Learning to Succeed | www.iuea.ac.ug
═══════════════════════════════════════════════════════════════`,
    };

    return await emailService.sendEmail(emailOptions);
  };

  /**
   * Internal method to send verification reminder
   */
  sendBrandedVerificationReminder = async ({ email, userName, portalType }) => {
    // Default continue URL for the portal
    const continueUrl = (() => {
      const base =
        process.env.STUDENT_PORTAL_URL || "https://applicant.iuea.ac.ug";
      return `${base.replace(/\/$/, "")}/verify-email`;
    })();

    // Try to generate a real Firebase verification link
    let verificationUrl = continueUrl;
    try {
      const actionCodeSettings = {
        url: continueUrl,
        handleCodeInApp: true,
      };
      const firebaseLink = await admin
        .auth()
        .generateEmailVerificationLink(email, actionCodeSettings);
      logger.info(
        `Firebase verification link generated (reminder) for ${email}`
      );

      // Convert to direct app link with oobCode for silent verification
      try {
        const parsed = new URL(firebaseLink);
        const oobCode = parsed.searchParams.get("oobCode");
        if (oobCode) {
          const direct = new URL(continueUrl);
          direct.searchParams.set("mode", "verifyEmail");
          direct.searchParams.set("oobCode", oobCode);
          verificationUrl = direct.toString();
        } else {
          verificationUrl = firebaseLink;
        }
      } catch (parseErr) {
        logger.warn(
          "Failed to parse Firebase verification link (reminder); using original link",
          {
            error: parseErr?.message,
          }
        );
        verificationUrl = firebaseLink;
      }
    } catch (firebaseError) {
      logger.error(
        `Failed to generate Firebase verification link (reminder) for ${email}:`,
        firebaseError
      );
      // Fallback: keep continue URL; frontend will let user resend a proper link
    }

    const emailOptions = {
      to: email,
      replyTo: "apply@iuea.ac.ug",
      subject: "⏰ Email Verification Reminder - IUEA Applicant Portal",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Email Verification Reminder - IUEA Applicant Portal</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 30px; border-radius: 10px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #7a0000; margin-bottom: 5px;">International University of East Africa</h1>
              <p style="color: #666; margin: 0; font-size: 14px;">Applicant Portal - Email Verification Reminder</p>
            </div>
            
            <div style="background-color: white; padding: 30px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #ffc107; margin-top: 0;">⏰ Don't Miss Out, ${userName}!</h2>
              <p style="font-size: 16px;">We noticed your email address hasn't been verified yet. Please verify your email to unlock all features of your IUEA Applicant Portal account.</p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" style="background-color: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold; display: inline-block;">
                  ✅ Verify Now
                </a>
              </div>
              
              <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="color: #1976d2; margin-top: 0; font-size: 16px;">🔓 Unlock These Features:</h3>
                <ul style="color: #666; line-height: 1.8; margin: 0; padding-left: 20px;">
                  <li>Submit course applications</li>
                  <li>Access learning materials</li>
                  <li>Receive important updates</li>
                  <li>Connect with faculty</li>
                </ul>
              </div>
            </div>
            
            <p style="font-size: 16px; margin: 0 0 6px 0;">📧 Email: <a href="mailto:apply@iuea.ac.ug" style="color: #7a0000;">apply@iuea.ac.ug</a></p>
            <p style="font-size: 16px; margin: 0;">📱 Phone: +256 790 002 000</p>
            
            <br>
            <p style="font-size: 16px;">Best regards,<br>
            <strong>IUEA Applicant Support Team</strong></p>
          </div>
        </body>
        </html>
      `,
      text: `Email Verification Reminder - IUEA Applicant Portal

Don't Miss Out, ${userName}!

We noticed your email address hasn't been verified yet. Please verify your email to unlock all features of your IUEA Applicant Portal account.

Verify now: ${verificationUrl}

Unlock These Features:
- Submit course applications
- Access learning materials  
- Receive important updates
- Connect with faculty

📧 Email: apply@iuea.ac.ug
📱 Phone: +256 790 002 000

Best regards,
IUEA Applicant Support Team`,
    };

    return await emailService.sendEmail(emailOptions);
  };
}

module.exports = new AuthEmailController();
