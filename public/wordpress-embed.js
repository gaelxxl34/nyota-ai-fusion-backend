/**
 * IUEA Chatbot - WordPress Specific Embed Script
 * This version includes WordPress compatibility fixes and troubleshooting
 */

(function () {
  "use strict";

  // WordPress compatibility checks
  function checkWordPressCompatibility() {
    const issues = [];

    // Check if jQuery is causing conflicts
    if (window.jQuery && window.jQuery.noConflict) {
      console.log("✅ jQuery detected - using compatibility mode");
    }

    // Check for common WordPress script blockers
    if (window.wp) {
      console.log("✅ WordPress environment detected");
    }

    // Check for admin bar that might interfere
    if (document.getElementById("wpadminbar")) {
      console.log("⚠️ WordPress admin bar detected - adjusting positioning");
      issues.push("admin-bar");
    }

    // Check for common security plugins that block scripts
    const securityPluginIndicators = [
      "wordfence",
      "sucuri",
      "ithemes-security",
      "all-in-one-wp-security",
    ];

    securityPluginIndicators.forEach((indicator) => {
      if (
        document.body.className.includes(indicator) ||
        document.querySelector(`[class*="${indicator}"]`)
      ) {
        console.log(`⚠️ Security plugin detected: ${indicator}`);
        issues.push("security-plugin");
      }
    });

    return issues;
  }

  // Enhanced configuration for WordPress
  const CONFIG = {
    API_URL: getApiUrl(),
    WIDGET_URL: getWidgetUrl(),
    BUTTON_SIZE: "4.5vw", // Responsive button size (4.5% of viewport width)
    BUTTON_MIN_SIZE: "50px", // Minimum size for very large screens
    BUTTON_MAX_SIZE: "70px", // Maximum size for very small screens
    BUTTON_POSITION: { bottom: "2vh", right: "2vw" }, // Percentage-based positioning
    CHAT_SIZE: { width: "85vw", height: "90vh" }, // Percentage-based chat size
    CHAT_MAX_WIDTH: "420px", // Maximum width for larger screens
    CHAT_MAX_HEIGHT: "650px", // Maximum height for larger screens
    Z_INDEX: 999999,
    WORDPRESS_MODE: true,
  };

  // Auto-detect API URL with WordPress fallbacks
  function getApiUrl() {
    // Check for WordPress-specific config
    if (window.IUEA_CHATBOT_CONFIG && window.IUEA_CHATBOT_CONFIG.apiUrl) {
      return window.IUEA_CHATBOT_CONFIG.apiUrl;
    }

    // Try to get from script tag data attribute
    const script = document.querySelector(
      'script[src*="wordpress-embed.js"], script[src*="chatbot-embed.js"]'
    );
    if (script && script.dataset.apiUrl) {
      return script.dataset.apiUrl;
    }

    // Extract from script source URL
    if (script && script.src) {
      const url = new URL(script.src);
      return `${url.protocol}//${url.host}`;
    }

    // WordPress-specific fallback
    if (window.ajaxurl) {
      const ajaxUrl = new URL(window.ajaxurl);
      return `${ajaxUrl.protocol}//api.nyotafusionai.com`;
    }

    // Production fallback
    return "https://api.nyotafusionai.com";
  }

  function getWidgetUrl() {
    const baseUrl = getApiUrl();
    return `${baseUrl}/chatbot/chatbot-widget.html`;
  }

  // Check if already loaded (prevents conflicts with caching plugins)
  if (window.IUEAChatbotLoaded) {
    console.log("IUEA Chatbot already loaded - skipping duplicate load");
    return;
  }
  window.IUEAChatbotLoaded = true;

  // Add debugging for WordPress
  function debugLog(message, data = null) {
    if (
      window.location.search.includes("chatbot_debug=1") ||
      localStorage.getItem("chatbot_debug")
    ) {
      console.log(`[IUEA Chatbot Debug] ${message}`, data || "");
    }
  }

  debugLog("Starting IUEA Chatbot initialization");
  debugLog("Configuration", CONFIG);

  class IUEAChatbotWordPress {
    constructor() {
      this.isOpen = false;
      this.chatButton = null;
      this.chatWidget = null;
      this.unreadCount = 0;
      this.wordpressIssues = [];

      debugLog("Chatbot instance created");
      this.init();
    }

    init() {
      // Run WordPress compatibility checks
      this.wordpressIssues = checkWordPressCompatibility();
      debugLog("WordPress issues detected", this.wordpressIssues);

      this.createStyles();
      this.createChatButton();
      this.setupEventListeners();

      debugLog("Chatbot initialization complete");
    }

    createStyles() {
      // Adjust positioning for WordPress admin bar
      const adminBarHeight = this.wordpressIssues.includes("admin-bar")
        ? "32px"
        : "0px";
      const mobileAdminBarHeight = this.wordpressIssues.includes("admin-bar")
        ? "46px"
        : "0px";

      const styles = `
                .iuea-chat-button {
                    position: fixed !important;
                    bottom: calc(${
                      CONFIG.BUTTON_POSITION.bottom
                    } + ${adminBarHeight}) !important;
                    right: ${CONFIG.BUTTON_POSITION.right} !important;
                    width: clamp(${CONFIG.BUTTON_MIN_SIZE}, ${
        CONFIG.BUTTON_SIZE
      }, ${CONFIG.BUTTON_MAX_SIZE}) !important;
                    height: clamp(${CONFIG.BUTTON_MIN_SIZE}, ${
        CONFIG.BUTTON_SIZE
      }, ${CONFIG.BUTTON_MAX_SIZE}) !important;
                    background: linear-gradient(135deg, #dc2626, #991b1b) !important;
                    border-radius: 50% !important;
                    cursor: pointer !important;
                    z-index: ${CONFIG.Z_INDEX} !important;
                    box-shadow: 0 0.5vw 2vw rgba(220, 38, 38, 0.4) !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    transition: all 0.3s ease !important;
                    border: none !important;
                    outline: none !important;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
                    overflow: hidden !important;
                }

                .iuea-chat-button:hover {
                    transform: scale(1.1) !important;
                    box-shadow: 0 0.7vw 2.5vw rgba(220, 38, 38, 0.6) !important;
                }

                .iuea-chat-button .chat-icon {
                    position: relative !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    width: 100% !important;
                    height: 100% !important;
                    transition: all 0.3s ease !important;
                }

                .iuea-chat-button .chat-svg,
                .iuea-chat-button .close-svg {
                    width: 65% !important;
                    height: 65% !important;
                    fill: white !important;
                    stroke: white !important;
                    transition: all 0.3s ease !important;
                    position: absolute !important;
                    top: 50% !important;
                    left: 50% !important;
                    transform: translate(-50%, -50%) !important;
                }

                .iuea-chat-button .close-svg {
                    opacity: 0 !important;
                    transform: translate(-50%, -50%) rotate(90deg) !important;
                }

                .iuea-chat-button.open .chat-svg {
                    opacity: 0 !important;
                    transform: translate(-50%, -50%) rotate(-90deg) !important;
                }

                .iuea-chat-button.open .close-svg {
                    opacity: 1 !important;
                    transform: translate(-50%, -50%) rotate(0deg) !important;
                }

                .iuea-chat-button .chat-text {
                    position: absolute !important;
                    bottom: -25px !important;
                    left: 50% !important;
                    transform: translateX(-50%) !important;
                    color: white !important;
                    font-size: 10px !important;
                    font-weight: 600 !important;
                    background: rgba(220, 38, 38, 0.9) !important;
                    padding: 2px 6px !important;
                    border-radius: 4px !important;
                    white-space: nowrap !important;
                    opacity: 0 !important;
                    transition: all 0.3s ease !important;
                    pointer-events: none !important;
                }

                .iuea-chat-button:hover .chat-text {
                    opacity: 1 !important;
                    bottom: -30px !important;
                }

                .iuea-chat-widget {
                    position: fixed !important;
                    bottom: calc(${CONFIG.BUTTON_POSITION.bottom} + clamp(${
        CONFIG.BUTTON_MIN_SIZE
      }, ${CONFIG.BUTTON_SIZE}, ${
        CONFIG.BUTTON_MAX_SIZE
      }) + 1vh + ${adminBarHeight}) !important;
                    right: ${CONFIG.BUTTON_POSITION.right} !important;
                    width: min(${CONFIG.CHAT_SIZE.width}, ${
        CONFIG.CHAT_MAX_WIDTH
      }) !important;
                    height: min(${CONFIG.CHAT_SIZE.height}, ${
        CONFIG.CHAT_MAX_HEIGHT
      }) !important;
                    z-index: ${CONFIG.Z_INDEX - 1} !important;
                    border-radius: 12px !important;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2) !important;
                    transform: translateY(20px) scale(0.95) !important;
                    opacity: 0 !important;
                    visibility: hidden !important;
                    transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55) !important;
                    overflow: hidden !important;
                    border: none !important;
                    background: white !important;
                }

                .iuea-chat-widget.open {
                    transform: translateY(0) scale(1) !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                }

                .iuea-chat-notification {
                    position: absolute !important;
                    top: -5px !important;
                    right: -5px !important;
                    background: #ef4444 !important;
                    color: white !important;
                    border-radius: 50% !important;
                    width: 20px !important;
                    height: 20px !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    font-size: 12px !important;
                    font-weight: bold !important;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
                    z-index: 1 !important;
                }

                .iuea-chat-pulse {
                    position: absolute !important;
                    top: 50% !important;
                    left: 50% !important;
                    transform: translate(-50%, -50%) !important;
                    width: 100% !important;
                    height: 100% !important;
                    border-radius: 50% !important;
                    background: rgba(220, 38, 38, 0.4) !important;
                    animation: iuea-pulse 2s infinite !important;
                }

                @keyframes iuea-pulse {
                    0% {
                        transform: translate(-50%, -50%) scale(1) !important;
                        opacity: 1 !important;
                    }
                    100% {
                        transform: translate(-50%, -50%) scale(1.3) !important;
                        opacity: 0 !important;
                    }
                }

                /* WordPress mobile responsive with admin bar */
                @media (max-width: 768px) {
                    .iuea-chat-button {
                        bottom: calc(2vh + ${mobileAdminBarHeight}) !important;
                        right: 3vw !important;
                        width: clamp(50px, 12vw, 65px) !important;
                        height: clamp(50px, 12vw, 65px) !important;
                    }

                    .iuea-chat-button .chat-svg,
                    .iuea-chat-button .close-svg {
                        width: 60% !important;
                        height: 60% !important;
                    }

                    .iuea-chat-button .chat-text {
                        font-size: 2.5vw !important;
                        bottom: -3vh !important;
                        padding: 0.5vw 1.5vw !important;
                    }

                    .iuea-chat-button:hover .chat-text {
                        bottom: -3.5vh !important;
                    }
                    
                    .iuea-chat-widget {
                        position: fixed !important;
                        top: ${mobileAdminBarHeight} !important;
                        left: 0 !important;
                        right: 0 !important;
                        bottom: 0 !important;
                        width: 100vw !important;
                        height: calc(100vh - ${mobileAdminBarHeight}) !important;
                        border-radius: 0 !important;
                        transform: translateY(100%) !important;
                        max-width: none !important;
                        max-height: none !important;
                    }

                    .iuea-chat-widget.open {
                        transform: translateY(0) !important;
                    }

                    .iuea-chat-widget.open ~ .iuea-chat-button,
                    body.iuea-chat-open .iuea-chat-button {
                        opacity: 0 !important;
                        visibility: hidden !important;
                        pointer-events: none !important;
                        transform: scale(0.8) !important;
                        transition: all 0.3s ease !important;
                    }
                }

                /* Tablet responsive */
                @media (max-width: 1024px) and (min-width: 769px) {
                    .iuea-chat-widget {
                        width: 380px !important;
                        height: 550px !important;
                        right: 15px !important;
                        bottom: calc(${
                          CONFIG.BUTTON_POSITION.bottom
                        } + 70px + ${adminBarHeight}) !important;
                    }

                    .iuea-chat-button {
                        right: 15px !important;
                    }
                }

                /* Small mobile responsive */
                @media (max-width: 480px) {
                    .iuea-chat-button {
                        width: 52px !important;
                        height: 52px !important;
                        right: 12px !important;
                        bottom: calc(15px + ${mobileAdminBarHeight}) !important;
                    }

                    .iuea-chat-button .chat-svg,
                    .iuea-chat-button .close-svg {
                        width: 22px !important;
                        height: 22px !important;
                    }

                    .iuea-chat-widget {
                        top: ${mobileAdminBarHeight} !important;
                        height: calc(100vh - ${mobileAdminBarHeight}) !important;
                    }
                }

                /* Very small screens */
                @media (max-width: 360px) {
                    .iuea-chat-button {
                        width: 48px !important;
                        height: 48px !important;
                        right: 10px !important;
                        bottom: calc(12px + ${mobileAdminBarHeight}) !important;
                    }

                    .iuea-chat-button .chat-svg,
                    .iuea-chat-button .close-svg {
                        width: 20px !important;
                        height: 20px !important;
                    }

                    .iuea-chat-button .chat-text {
                        display: none !important;
                    }
                }

                /* WordPress theme compatibility */
                .iuea-chat-button * {
                    box-sizing: border-box !important;
                }
                
                .iuea-chat-widget * {
                    box-sizing: border-box !important;
                }
            `;

      // Remove existing styles to prevent conflicts
      const existingStyle = document.getElementById("iuea-chatbot-styles");
      if (existingStyle) {
        existingStyle.remove();
      }

      const styleSheet = document.createElement("style");
      styleSheet.id = "iuea-chatbot-styles";
      styleSheet.textContent = styles;
      document.head.appendChild(styleSheet);

      debugLog("Styles created with WordPress compatibility");
    }

    createChatButton() {
      // Remove existing button if any
      const existingButton = document.querySelector(".iuea-chat-button");
      if (existingButton) {
        existingButton.remove();
      }

      this.chatButton = document.createElement("button");
      this.chatButton.className = "iuea-chat-button";
      this.chatButton.setAttribute("aria-label", "Open IUEA Chat Assistant");
      this.chatButton.setAttribute("type", "button");
      this.chatButton.innerHTML = `
                <div class="iuea-chat-pulse"></div>
                <div class="chat-icon">
                    <svg viewBox="0 0 24 24" class="chat-svg">
                        <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" fill="currentColor"/>
                    </svg>
                    <svg viewBox="0 0 24 24" class="close-svg">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
                    </svg>
                    <div class="chat-text">Chat with Miryam</div>
                </div>
            `;

      document.body.appendChild(this.chatButton);
      debugLog("Chat button created");
    }

    createChatWidget() {
      if (this.chatWidget) return;

      // Remove existing widget if any
      const existingWidget = document.querySelector(".iuea-chat-widget");
      if (existingWidget) {
        existingWidget.remove();
      }

      this.chatWidget = document.createElement("iframe");
      this.chatWidget.className = "iuea-chat-widget";
      this.chatWidget.src = `${CONFIG.WIDGET_URL}?apiUrl=${encodeURIComponent(
        CONFIG.API_URL + "/api/chatbot"
      )}&wp=1`;
      this.chatWidget.frameBorder = "0";
      this.chatWidget.title = "IUEA Chat Assistant";
      this.chatWidget.setAttribute("allow", "microphone; camera; popups");

      // Remove sandbox restrictions to allow popups - this is necessary for external links
      // The iframe content is controlled by us, so this is safe
      // this.chatWidget.setAttribute(
      //   "sandbox",
      //   "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
      // );

      document.body.appendChild(this.chatWidget);
      debugLog("Chat widget created");

      // Listen for messages from iframe
      window.addEventListener("message", (event) => {
        // More permissive origin checking for WordPress
        const allowedOrigins = [
          new URL(CONFIG.WIDGET_URL).origin,
          "http://localhost:3000",
          "https://api.nyotafusionai.com",
          window.location.origin,
        ];

        if (!allowedOrigins.includes(event.origin)) {
          debugLog("Message from disallowed origin", event.origin);
          return;
        }

        this.handleIframeMessage(event.data);
      });
    }

    handleIframeMessage(data) {
      debugLog("Received iframe message", data);

      switch (data.type) {
        case "newMessage":
          if (!this.isOpen) {
            this.showNotification();
          }
          break;
        case "chatInitialized":
          debugLog("IUEA Chat initialized");
          break;
        case "chatError":
          console.error("IUEA Chat error:", data.error);
          break;
        case "closeChat":
          this.closeChat();
          break;
        case "openUrl":
          // Handle external URL opening from iframe
          this.openExternalUrl(data.url);
          break;
      }
    }

    openExternalUrl(url) {
      try {
        debugLog("Opening external URL", url);

        // Create a temporary link element for more reliable opening
        const tempLink = document.createElement("a");
        tempLink.href = url;
        tempLink.target = "_blank";
        tempLink.rel = "noopener noreferrer";
        tempLink.style.position = "absolute";
        tempLink.style.left = "-9999px";
        tempLink.style.visibility = "hidden";

        // Add to DOM
        document.body.appendChild(tempLink);

        // Trigger click immediately with enhanced error handling
        let clickSuccess = false;

        try {
          const clickEvent = new MouseEvent("click", {
            view: window,
            bubbles: true,
            cancelable: true,
            button: 0,
          });

          const result = tempLink.dispatchEvent(clickEvent);
          if (result) {
            clickSuccess = true;
            debugLog("External URL opened via dispatchEvent");
          }
        } catch (dispatchError) {
          console.log("dispatchEvent failed:", dispatchError);
        }

        // Try direct click if dispatch didn't work
        if (!clickSuccess) {
          try {
            tempLink.click();
            clickSuccess = true;
            debugLog("External URL opened via click()");
          } catch (clickError) {
            console.log("Direct click failed:", clickError);
          }
        }

        // Clean up after a short delay
        setTimeout(() => {
          if (document.body.contains(tempLink)) {
            document.body.removeChild(tempLink);
          }
        }, 100);

        if (clickSuccess) {
          debugLog("External URL opened successfully");
          return; // Exit early if successful
        } else {
          throw new Error("All click methods failed");
        }
      } catch (error) {
        console.error("Error opening external URL via link:", error);

        // Fallback 1: Try window.open with user interaction context
        try {
          const newWindow = window.open(
            url,
            "_blank",
            "noopener,noreferrer,width=800,height=600"
          );
          if (newWindow && !newWindow.closed) {
            debugLog("External URL opened via window.open");
            return;
          } else {
            throw new Error("window.open returned null or was closed");
          }
        } catch (windowOpenError) {
          console.error("window.open failed:", windowOpenError);
        }

        // Fallback 2: Try location assignment in new window
        try {
          const newWindow = window.open(
            "about:blank",
            "_blank",
            "noopener,noreferrer,width=800,height=600"
          );
          if (newWindow && !newWindow.closed) {
            newWindow.location.href = url;
            debugLog("External URL opened via location assignment");
            return;
          } else {
            throw new Error("Failed to open blank window");
          }
        } catch (locationError) {
          console.error("Location assignment failed:", locationError);
        }

        // Fallback 3: Show URL to user with better UX
        console.log(
          "All automatic opening methods failed, showing user notification"
        );

        // Create a notification element
        const notification = document.createElement("div");
        notification.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: #8b0000;
          color: white;
          padding: 16px 20px;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          z-index: ${CONFIG.Z_INDEX + 100};
          max-width: 400px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 14px;
          line-height: 1.4;
        `;

        notification.innerHTML = `
          <div style="margin-bottom: 10px;">
            <strong>Link Blocked</strong><br>
            Your browser blocked the popup. Click below to copy the link:
          </div>
          <div style="background: rgba(255,255,255,0.1); padding: 8px; border-radius: 4px; margin: 8px 0; word-break: break-all; font-size: 12px;">
            ${url}
          </div>
          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button onclick="copyToClipboard('${url}', this)" style="
              background: white;
              color: #8b0000;
              border: none;
              padding: 6px 12px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              font-weight: 500;
            ">Copy Link</button>
            <button onclick="this.parentElement.parentElement.remove()" style="
              background: rgba(255,255,255,0.2);
              color: white;
              border: none;
              padding: 6px 12px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
            ">Close</button>
          </div>
        `;

        document.body.appendChild(notification);

        // Auto-remove after 10 seconds
        setTimeout(() => {
          if (document.body.contains(notification)) {
            notification.remove();
          }
        }, 10000);

        // Add global copy function if it doesn't exist
        if (!window.copyToClipboard) {
          window.copyToClipboard = function (text, button) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard
                .writeText(text)
                .then(() => {
                  button.textContent = "Copied!";
                  button.style.background = "#22c55e";
                  button.style.color = "white";
                  setTimeout(() => {
                    if (
                      button.parentElement &&
                      button.parentElement.parentElement
                    ) {
                      button.parentElement.parentElement.remove();
                    }
                  }, 1500);
                })
                .catch(() => {
                  fallbackCopyToClipboard(text, button);
                });
            } else {
              fallbackCopyToClipboard(text, button);
            }
          };

          window.fallbackCopyToClipboard = function (text, button) {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "absolute";
            textArea.style.left = "-9999px";
            document.body.appendChild(textArea);
            textArea.select();

            try {
              document.execCommand("copy");
              button.textContent = "Copied!";
              button.style.background = "#22c55e";
              button.style.color = "white";
              setTimeout(() => {
                if (
                  button.parentElement &&
                  button.parentElement.parentElement
                ) {
                  button.parentElement.parentElement.remove();
                }
              }, 1500);
            } catch (err) {
              alert("Please manually copy this link: " + text);
            } finally {
              document.body.removeChild(textArea);
            }
          };
        }
      }
    }

    setupEventListeners() {
      // Use event delegation for WordPress compatibility
      document.addEventListener("click", (e) => {
        if (e.target.closest(".iuea-chat-button")) {
          e.preventDefault();
          e.stopPropagation();
          this.toggleChat();
          debugLog("Chat button clicked");
        }
      });

      // Close on escape key
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.isOpen) {
          this.closeChat();
        }
      });

      // Handle clicks outside chat widget (desktop only)
      document.addEventListener("click", (e) => {
        if (
          this.isOpen &&
          this.chatWidget &&
          !this.chatWidget.contains(e.target) &&
          !e.target.closest(".iuea-chat-button") &&
          window.innerWidth > 768
        ) {
          this.closeChat();
        }
      });

      // Handle window resize
      window.addEventListener("resize", () => {
        if (this.chatWidget) {
          this.positionWidget();
        }

        if (this.isOpen) {
          if (window.innerWidth <= 768) {
            document.body.classList.add("iuea-chat-open");
          } else {
            document.body.classList.remove("iuea-chat-open");
          }
        }
      });

      debugLog("Event listeners setup complete");
    }

    toggleChat() {
      if (this.isOpen) {
        this.closeChat();
      } else {
        this.openChat();
      }
    }

    openChat() {
      if (!this.chatWidget) {
        this.createChatWidget();
      }

      this.isOpen = true;
      this.chatButton.classList.add("open");
      this.chatWidget.classList.add("open");
      this.hideNotification();

      if (window.innerWidth <= 768) {
        document.body.classList.add("iuea-chat-open");
      }

      setTimeout(() => {
        if (this.chatWidget) {
          this.chatWidget.focus();
        }
      }, 300);

      debugLog("Chat opened");
    }

    closeChat() {
      this.isOpen = false;
      this.chatButton.classList.remove("open");
      if (this.chatWidget) {
        this.chatWidget.classList.remove("open");
      }

      document.body.classList.remove("iuea-chat-open");
      debugLog("Chat closed");
    }

    showNotification() {
      this.unreadCount++;

      let notification = this.chatButton.querySelector(
        ".iuea-chat-notification"
      );
      if (!notification) {
        notification = document.createElement("div");
        notification.className = "iuea-chat-notification";
        this.chatButton.appendChild(notification);
      }

      notification.textContent =
        this.unreadCount > 9 ? "9+" : this.unreadCount.toString();
    }

    hideNotification() {
      this.unreadCount = 0;
      const notification = this.chatButton.querySelector(
        ".iuea-chat-notification"
      );
      if (notification) {
        notification.remove();
      }
    }

    positionWidget() {
      if (!this.chatWidget) return;

      const adminBarHeight = this.wordpressIssues.includes("admin-bar")
        ? "32px"
        : "0px";
      const mobileAdminBarHeight = this.wordpressIssues.includes("admin-bar")
        ? "46px"
        : "0px";

      if (window.innerWidth <= 768) {
        this.chatWidget.style.cssText = `
                    position: fixed !important;
                    top: ${mobileAdminBarHeight} !important;
                    left: 0 !important;
                    right: 0 !important;
                    bottom: 0 !important;
                    width: 100vw !important;
                    height: calc(100vh - ${mobileAdminBarHeight}) !important;
                    border-radius: 0 !important;
                `;
      } else {
        this.chatWidget.style.cssText = `
                    position: fixed !important;
                    bottom: calc(${CONFIG.BUTTON_POSITION.bottom} + clamp(${CONFIG.BUTTON_MIN_SIZE}, ${CONFIG.BUTTON_SIZE}, ${CONFIG.BUTTON_MAX_SIZE}) + 1vh + ${adminBarHeight}) !important;
                    right: ${CONFIG.BUTTON_POSITION.right} !important;
                    width: min(${CONFIG.CHAT_SIZE.width}, ${CONFIG.CHAT_MAX_WIDTH}) !important;
                    height: min(${CONFIG.CHAT_SIZE.height}, ${CONFIG.CHAT_MAX_HEIGHT}) !important;
                    border-radius: 12px !important;
                `;
      }
    }

    // Public API
    open() {
      this.openChat();
    }
    close() {
      this.closeChat();
    }
    toggle() {
      this.toggleChat();
    }
    isOpened() {
      return this.isOpen;
    }

    // WordPress-specific debugging
    debug() {
      return {
        isLoaded: true,
        isOpen: this.isOpen,
        config: CONFIG,
        wordpressIssues: this.wordpressIssues,
        hasButton: !!this.chatButton,
        hasWidget: !!this.chatWidget,
        apiUrl: CONFIG.API_URL,
        widgetUrl: CONFIG.WIDGET_URL,
      };
    }
  }

  // WordPress-specific initialization
  function initializeWordPressWidget() {
    debugLog("Initializing WordPress widget");

    try {
      const widget = new IUEAChatbotWordPress();

      // Expose widget to global scope
      window.IUEAChatbot = {
        open: () => widget.open(),
        close: () => widget.close(),
        toggle: () => widget.toggle(),
        isOpen: () => widget.isOpened(),
        debug: () => widget.debug(),
        version: "2.0.0-wordpress",
      };

      // WordPress-specific ready event
      const event = new CustomEvent("iueaChatbotReady", {
        detail: {
          widget: window.IUEAChatbot,
          wordpress: true,
          issues: widget.wordpressIssues,
        },
      });
      document.dispatchEvent(event);

      debugLog("WordPress widget initialized successfully");

      // Add troubleshooting info
      console.log(
        "%c🤖 IUEA Chatbot for WordPress",
        "color: #dc2626; font-weight: bold; font-size: 16px;"
      );
      console.log("✅ Chatbot loaded successfully!");
      if (widget.wordpressIssues.length > 0) {
        console.log(
          "⚠️ WordPress compatibility issues detected:",
          widget.wordpressIssues
        );
      }
      console.log("🔧 For troubleshooting, run: window.IUEAChatbot.debug()");
    } catch (error) {
      console.error("Failed to initialize IUEA Chatbot:", error);
      debugLog("Initialization failed", error);
    }
  }

  // Initialize when DOM is ready with WordPress considerations
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeWordPressWidget);
  } else {
    // WordPress often loads scripts after DOM ready
    if (document.body) {
      initializeWordPressWidget();
    } else {
      setTimeout(initializeWordPressWidget, 100);
    }
  }
})();
