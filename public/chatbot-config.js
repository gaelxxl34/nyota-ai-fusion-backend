/**
 * IUEA Chatbot Production Configuration
 * This file provides optional advanced configuration for the chatbot
 */

// Optional: Global configuration object
// You can customize these settings before loading the chatbot script
window.IUEA_CHATBOT_CONFIG = {
  // API URL - Auto-detected if not specified
  // apiUrl: 'https://yourdomain.com',

  // Chatbot appearance
  buttonSize: "60px",
  buttonPosition: { bottom: "20px", right: "20px" },
  chatSize: { width: "400px", height: "600px" },

  // Z-index for layering
  zIndex: 999999,

  // Custom styling (optional)
  customCSS: `
    /* Custom chatbot button styles */
    .iuea-chat-button {
      /* Add your custom styles here */
    }
  `,

  // Language preference (optional)
  defaultLanguage: "auto", // 'auto', 'en', 'fr'

  // Analytics tracking (optional)
  enableAnalytics: true,

  // Custom welcome message (optional)
  // welcomeMessage: 'Custom welcome message here',
};

// Custom event handlers (optional)
document.addEventListener("iueaChatbotReady", function (event) {
  console.log("IUEA Chatbot is ready!");

  // You can add custom initialization here
  // event.detail.widget contains the chatbot API
});

// Optional: Custom triggers
function openIUEAChat() {
  if (window.IUEAChatbot) {
    window.IUEAChatbot.open();
  }
}

function closeIUEAChat() {
  if (window.IUEAChatbot) {
    window.IUEAChatbot.close();
  }
}
