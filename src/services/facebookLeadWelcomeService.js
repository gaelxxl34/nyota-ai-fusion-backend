/**
 * Facebook Lead Welcome Messages Service
 * Provides consistent welcome email and WhatsApp messaging for Facebook leads and contacted bulk actions
 */

const emailService = require("./emailService");
const { whatsappMessageService } = require("./whatsappMessageService");
const logger = require("../utils/logger");

class FacebookLeadWelcomeService {
  /**
   * Send welcome email to a lead (standardized across all sources)
   */
  static async sendWelcomeEmail(userEmail, userName) {
    try {
      const firstName =
        (userName || "").split(" ")[0] || userName || "Prospective Student";

      const subject = "Welcome to IUEA! Your journey to success starts here 🎓";

      const emailContent = this.generateWelcomeEmailContent(firstName);

      const emailOptions = {
        to: userEmail,
        subject: subject,
        html: emailContent.html,
        text: emailContent.text,
        replyTo: "apply@iuea.ac.ug",
      };

      const result = await emailService.sendEmail(emailOptions);
      return result;
    } catch (error) {
      logger.error("Welcome email error:", error);
      return {
        success: false,
        error: error.message || "Failed to send welcome email",
        provider: "unknown",
        skipped: false,
      };
    }
  }

  /**
   * Generate welcome email content (standardized template)
   */
  static generateWelcomeEmailContent(leadName) {
    const text = `Dear ${leadName},

Welcome to the International University of East Africa (IUEA)! 🎓

Thank you for your interest in joining our university. We're thrilled that you've chosen IUEA for your higher education journey. As one of East Africa's leading universities, we're committed to providing quality education that prepares students for successful careers.

Your journey to success starts here, and we're excited to guide you every step of the way!

🎯 Why Choose IUEA?
✓ Internationally recognized programs
✓ Modern facilities and technology
✓ Experienced faculty and industry experts
✓ Strong alumni network and career support
✓ Flexible learning options

📋 Ready to Start Your Application?
Create your student portal account now to begin your application process. From your portal, you can:
- Complete your application online
- Upload required documents
- Track your application status
- Receive important updates

Visit your Student Portal: https://applicant.iuea.ac.ug/login

💬 Need Help?
Our admissions team is ready to guide you through the application process, answer questions about programs, fees, and scholarships.

Don't hesitate to reach out - we're here to help you achieve your academic goals!

Best regards,
IUEA Admissions Team
International University of East Africa

📞 Contact Information:
Phone: +256 706 026496
WhatsApp: +256 705 722 300
Email: apply@iuea.ac.ug
Website: www.iuea.ac.ug
Address: Kansanga, Kampala, Uganda`;

    // Generate IUEA-branded HTML version with responsive design
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to IUEA - Your Journey Starts Here</title>
          <style>
            @media only screen and (max-width: 600px) {
              .container {
                width: 100% !important;
                padding: 0 !important;
              }
              .header-section {
                padding: 20px 15px !important;
              }
              .header-logo {
                width: 180px !important;
                height: auto !important;
              }
              .main-content {
                padding: 30px 20px !important;
              }
              .visit-portal-button {
                width: 100% !important;
                padding: 18px 25px !important;
                font-size: 18px !important;
                text-align: center !important;
              }
              .feature-grid {
                grid-template-columns: 1fr !important;
                gap: 12px !important;
              }
              .feature-item {
                margin-bottom: 8px !important;
              }
              .contact-grid {
                grid-template-columns: 1fr !important;
                gap: 15px !important;
                text-align: center !important;
              }
              .footer-section {
                padding: 25px 15px !important;
              }
            }
            
            .visit-portal-button:hover {
              background: white !important;
              color: #8b0000 !important;
            }
          </style>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5; line-height: 1.6;">
          
          <!-- Main Container -->
          <div class="container" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);">
            
            <!-- Header with IUEA Logo and Gray Background -->
            <div class="header-section" style="background: #E5E5E5; padding: 30px 25px; text-align: center;">
              
              <!-- IUEA Logo -->
              <img src="https://applicant.iuea.ac.ug/_next/image?url=https%3A%2F%2Fiuea.ac.ug%2Fsitepad-data%2Fuploads%2F2020%2F11%2FWebsite-Logo.png&w=384&q=75" 
                   alt="IUEA Logo" 
                   class="header-logo"
                   style="width: 220px; height: auto; margin: 0 auto; display: block;"
                   onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
              
              <!-- Fallback for logo -->
              <div style="display: none; color: #333; font-size: 24px; font-weight: bold; text-align: center;">
                INTERNATIONAL UNIVERSITY<br>OF EAST AFRICA
              </div>
            </div>
            
            <!-- Welcome Header Section -->
            <div style="background: #8b0000; padding: 35px 25px; text-align: center; color: white;">
              <h1 style="color: white; margin: 0; font-size: 32px; font-weight: 700; letter-spacing: -0.5px;">
                Welcome to IUEA! 🎓
              </h1>
              <p style="color: white; margin: 12px 0 0 0; font-size: 18px; font-weight: 300; opacity: 0.9;">
                Your journey to success starts here
              </p>
              
              <!-- Decorative accent -->
              <div style="width: 80px; height: 3px; background: white; margin: 25px auto 0; border-radius: 2px;"></div>
            </div>
            
            <!-- Main Content -->
            <div class="main-content" style="padding: 45px 35px;">
              
              <!-- Personal Greeting -->
              <div style="margin-bottom: 35px;">
                <h2 style="color: #8b0000; font-size: 24px; margin-bottom: 18px; font-weight: 600; letter-spacing: -0.3px;">
                  Dear ${leadName},
                </h2>
                <p style="color: #333; font-size: 16px; line-height: 1.7; margin-bottom: 20px;">
                  Thank you for your interest in joining the <strong style="color: #8b0000;">International University of East Africa (IUEA)</strong>! 
                  We're thrilled that you've chosen us for your higher education journey.
                </p>
                <p style="color: #333; font-size: 16px; line-height: 1.7;">
                  As one of East Africa's leading universities, we're committed to providing quality education that prepares students for successful careers. 
                  <strong style="color: #8b0000;">Your journey to success starts here!</strong>
                </p>
              </div>
              
              <!-- Prominent Visit Portal CTA Section -->
              <div style="background: #8b0000; padding: 35px; border-radius: 16px; text-align: center; margin-bottom: 35px; box-shadow: 0 8px 24px rgba(139, 0, 0, 0.25);">
                
                <div>
                  <h3 style="color: white; font-size: 22px; margin: 0 0 18px 0; font-weight: 600; letter-spacing: -0.3px;">
                    🚀 Ready to Start Your Application?
                  </h3>
                  <p style="color: white; margin-bottom: 30px; font-size: 16px; line-height: 1.6; opacity: 0.9;">
                    Access your personalized applicant portal to begin your application process and track your progress every step of the way.
                  </p>
                  
                  <!-- Main Visit Portal Button -->
                  <a href="https://applicant.iuea.ac.ug/login" 
                     class="visit-portal-button"
                     style="display: inline-block; background: white; color: #8b0000; text-decoration: none; padding: 20px 40px; border-radius: 12px; font-weight: bold; font-size: 20px; box-shadow: 0 6px 20px rgba(0,0,0,0.25); transition: all 0.3s ease; border: 3px solid white; text-transform: uppercase; letter-spacing: 0.5px;">
                    🎯 VISIT APPLICANT PORTAL
                  </a>
                  
                  <p style="color: white; margin: 20px 0 0 0; font-size: 14px; opacity: 0.9;">
                    Secure access to your personalized application dashboard
                  </p>
                </div>
              </div>
              
              <!-- Why Choose IUEA Section -->
              <div style="margin-bottom: 35px;">
                <h3 style="color: #8b0000; font-size: 22px; margin-bottom: 25px; font-weight: 600; text-align: center; letter-spacing: -0.3px;">
                  🌟 Why Choose IUEA?
                </h3>
                
                <div class="feature-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 25px;">
                  <div class="feature-item" style="background: #F8F8F8; padding: 20px; border-radius: 12px; border-left: 5px solid #8b0000; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1);">
                    <div style="color: #8b0000; font-weight: 600; margin-bottom: 8px; font-size: 15px;">✓ Internationally Recognized</div>
                    <div style="color: #666; font-size: 14px; line-height: 1.5;">Quality programs with global standards</div>
                  </div>
                  
                  <div class="feature-item" style="background: #F8F8F8; padding: 20px; border-radius: 12px; border-left: 5px solid #8b0000; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1);">
                    <div style="color: #8b0000; font-weight: 600; margin-bottom: 8px; font-size: 15px;">✓ Modern Facilities</div>
                    <div style="color: #666; font-size: 14px; line-height: 1.5;">State-of-the-art technology and labs</div>
                  </div>
                  
                  <div class="feature-item" style="background: #F8F8F8; padding: 20px; border-radius: 12px; border-left: 5px solid #8b0000; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1);">
                    <div style="color: #8b0000; font-weight: 600; margin-bottom: 8px; font-size: 15px;">✓ Expert Faculty</div>
                    <div style="color: #666; font-size: 14px; line-height: 1.5;">Experienced professors and industry leaders</div>
                  </div>
                  
                  <div class="feature-item" style="background: #F8F8F8; padding: 20px; border-radius: 12px; border-left: 5px solid #8b0000; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1);">
                    <div style="color: #8b0000; font-weight: 600; margin-bottom: 8px; font-size: 15px;">✓ Career Support</div>
                    <div style="color: #666; font-size: 14px; line-height: 1.5;">Strong alumni network and job placement</div>
                  </div>
                </div>
              </div>
              
              <!-- Portal Features Section -->
              <div style="background: #F8F9FA; padding: 30px; border-radius: 14px; margin-bottom: 35px; border: 2px solid #E9ECEF; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                <h4 style="color: #8b0000; margin-top: 0; margin-bottom: 20px; font-size: 20px; font-weight: 600; text-align: center;">
                  📋 Your Applicant Portal Features:
                </h4>
                <ul style="color: #333; padding-left: 0; margin: 0; line-height: 2; list-style: none;">
                  <li style="padding: 8px 0; padding-left: 25px; position: relative;">
                    <span style="position: absolute; left: 0; color: #8b0000; font-weight: bold;">✓</span>
                    Complete your application online with ease
                  </li>
                  <li style="padding: 8px 0; padding-left: 25px; position: relative;">
                    <span style="position: absolute; left: 0; color: #8b0000; font-weight: bold;">✓</span>
                    Upload required documents securely
                  </li>
                  <li style="padding: 8px 0; padding-left: 25px; position: relative;">
                    <span style="position: absolute; left: 0; color: #8b0000; font-weight: bold;">✓</span>
                    Track your application status in real-time
                  </li>
                  <li style="padding: 8px 0; padding-left: 25px; position: relative;">
                    <span style="position: absolute; left: 0; color: #8b0000; font-weight: bold;">✓</span>
                    Receive important updates and notifications
                  </li>
                  <li style="padding: 8px 0; padding-left: 25px; position: relative;">
                    <span style="position: absolute; left: 0; color: #8b0000; font-weight: bold;">✓</span>
                    Chat with our admissions team
                  </li>
                </ul>
              </div>
              
              <!-- Support Section -->
              <div style="text-align: center; margin-bottom: 35px; padding: 25px; background: #F8F8F8; border-radius: 14px; border: 1px solid rgba(139, 0, 0, 0.1);">
                <h4 style="color: #8b0000; font-size: 20px; margin-bottom: 18px; font-weight: 600;">
                  💬 Need Help? We're Here for You!
                </h4>
                <p style="color: #333; font-size: 16px; line-height: 1.7; margin-bottom: 15px;">
                  Our dedicated admissions team is ready to guide you through the application process, answer questions about programs, fees, and scholarships.
                </p>
                <p style="color: #8b0000; font-weight: 600; font-size: 17px; margin: 0;">
                  Don't hesitate to reach out - we're here to help you achieve your academic goals!
                </p>
              </div>
            </div>
            
            <!-- Footer with IUEA Branding -->
            <div class="footer-section" style="background: #333333; color: white; padding: 35px 25px; text-align: center;">
              <div style="margin-bottom: 25px;">
                <h4 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; letter-spacing: -0.3px;">
                  IUEA Admissions Team
                </h4>
                <p style="margin: 0; color: #E5E5E5; font-size: 15px; font-weight: 300;">
                  International University of East Africa
                </p>
              </div>
              
              <!-- Contact Information -->
              <div style="background: rgba(255, 255, 255, 0.1); padding: 25px; border-radius: 14px; margin-bottom: 25px;">
                <h5 style="color: white; margin-top: 0; margin-bottom: 20px; font-size: 18px; font-weight: 600;">
                  📞 Contact Information
                </h5>
                <div class="contact-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; text-align: left; max-width: 450px; margin: 0 auto;">
                  <div style="background: rgba(255, 255, 255, 0.1); padding: 15px; border-radius: 8px;">
                    <strong style="color: white;">Phone:</strong><br>
                    <a href="tel:+256706026496" style="color: #E5E5E5; text-decoration: none; font-size: 15px;">+256 705 722 300</a>
                  </div>
                  <div style="background: rgba(255, 255, 255, 0.1); padding: 15px; border-radius: 8px;">
                    <strong style="color: white;">WhatsApp:</strong><br>
                    <a href="https://wa.me/256705722300" style="color: #E5E5E5; text-decoration: none; font-size: 15px;">+256 790 002 000</a>
                  </div>
                  <div style="background: rgba(255, 255, 255, 0.1); padding: 15px; border-radius: 8px;">
                    <strong style="color: white;">Email:</strong><br>
                    <a href="mailto:apply@iuea.ac.ug" style="color: #E5E5E5; text-decoration: none; font-size: 15px;">apply@iuea.ac.ug</a>
                  </div>
                  <div style="background: rgba(255, 255, 255, 0.1); padding: 15px; border-radius: 8px;">
                    <strong style="color: white;">Website:</strong><br>
                    <a href="https://www.iuea.ac.ug" style="color: #E5E5E5; text-decoration: none; font-size: 15px;">www.iuea.ac.ug</a>
                  </div>
                </div>
                <div style="text-align: center; margin-top: 20px; color: #E5E5E5; font-size: 15px; background: rgba(255, 255, 255, 0.1); padding: 12px; border-radius: 8px;">
                  <strong style="color: white;">Address:</strong> Kansanga, Kampala, Uganda
                </div>
              </div>
              
              <!-- Social Media -->
              <div style="color: #E5E5E5; font-size: 15px; margin-bottom: 20px;">
                Follow us on social media for updates and campus life insights!
              </div>
              
              <!-- Decorative footer line -->
              <div style="width: 120px; height: 3px; background: #8b0000; margin: 0 auto; border-radius: 2px;"></div>
            </div>
          </div>
          
        </body>
      </html>
    `;

    return { text, html };
  }

  /**
   * Get standardized WhatsApp template name for welcome messages
   * @param {string} context - Either 'facebook_lead' or 'contacted_lead' to determine the template
   */
  static getWelcomeWhatsAppTemplate(context = "facebook_lead") {
    // For contacted leads, use nurturing template; for Facebook leads, use welcome template
    return context === "contacted_lead"
      ? "nurturing_lead_portal_signup"
      : "nurturing_lead_portal_signup";
  }

  /**
   * Get standardized WhatsApp template payload for welcome messages
   * @param {string} phoneNumber - The phone number to send to
   * @param {string} context - Either 'facebook_lead' or 'contacted_lead' to determine the template
   */
  static getWelcomeWhatsAppPayload(phoneNumber, context = "facebook_lead") {
    const templateName = this.getWelcomeWhatsAppTemplate(context);

    return {
      messaging_product: "whatsapp",
      to: phoneNumber,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: "en_US",
        },
      },
    };
  }
}

module.exports = FacebookLeadWelcomeService;
