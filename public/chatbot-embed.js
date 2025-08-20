(function () {
  "use strict";

  // Configuration
  const CONFIG = {
    API_URL: "http://localhost:3000", // Change this to your production URL
    WIDGET_URL: "http://localhost:3000/chatbot/chatbot-widget.html",
    BUTTON_SIZE: "60px",
    BUTTON_POSITION: { bottom: "20px", right: "20px" },
    CHAT_SIZE: { width: "400px", height: "600px" },
    Z_INDEX: 999999,
  };

  // Check if widget is already loaded
  if (window.IUEAChatbotLoaded) {
    return;
  }
  window.IUEAChatbotLoaded = true;

  class IUEAChatbotEmbed {
    constructor() {
      this.isOpen = false;
      this.chatButton = null;
      this.chatWidget = null;
      this.unreadCount = 0;

      this.init();
    }

    init() {
      this.createStyles();
      this.createChatButton();
      this.setupEventListeners();
    }

    createStyles() {
      const styles = `
                .iuea-chat-button {
                    position: fixed;
                    bottom: ${CONFIG.BUTTON_POSITION.bottom};
                    right: ${CONFIG.BUTTON_POSITION.right};
                    width: ${CONFIG.BUTTON_SIZE};
                    height: ${CONFIG.BUTTON_SIZE};
                    background: linear-gradient(135deg, #dc2626, #991b1b);
                    border-radius: 50%;
                    cursor: pointer;
                    z-index: ${CONFIG.Z_INDEX};
                    box-shadow: 0 4px 20px rgba(220, 38, 38, 0.4);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.3s ease;
                    border: none;
                    outline: none;
                }

                .iuea-chat-button:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 25px rgba(220, 38, 38, 0.6);
                }

                .iuea-chat-button svg {
                    width: 24px;
                    height: 24px;
                    fill: white;
                    transition: transform 0.3s ease;
                }

                .iuea-chat-button.open svg {
                    transform: rotate(45deg);
                }

                .iuea-chat-widget {
                    position: fixed;
                    bottom: calc(${CONFIG.BUTTON_POSITION.bottom} + ${
        CONFIG.BUTTON_SIZE
      } + 10px);
                    right: ${CONFIG.BUTTON_POSITION.right};
                    width: ${CONFIG.CHAT_SIZE.width};
                    height: ${CONFIG.CHAT_SIZE.height};
                    z-index: ${CONFIG.Z_INDEX - 1};
                    border-radius: 12px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
                    transform: translateY(20px) scale(0.95);
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
                    overflow: hidden;
                    border: none;
                }

                .iuea-chat-widget.open {
                    transform: translateY(0) scale(1);
                    opacity: 1;
                    visibility: visible;
                }

                .iuea-chat-notification {
                    position: absolute;
                    top: -5px;
                    right: -5px;
                    background: #ef4444;
                    color: white;
                    border-radius: 50%;
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                    font-weight: bold;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                }

                .iuea-chat-pulse {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    background: rgba(220, 38, 38, 0.4);
                    animation: pulse 2s infinite;
                }

                @keyframes pulse {
                    0% {
                        transform: translate(-50%, -50%) scale(1);
                        opacity: 1;
                    }
                    100% {
                        transform: translate(-50%, -50%) scale(1.3);
                        opacity: 0;
                    }
                }

                /* Mobile responsive */
                @media (max-width: 768px) {
                    .iuea-chat-widget {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        width: 100vw;
                        height: 100vh;
                        border-radius: 0;
                        transform: translateY(100%);
                    }

                    .iuea-chat-widget.open {
                        transform: translateY(0);
                    }

                    .iuea-chat-button {
                        bottom: 20px;
                        right: 20px;
                    }

                    /* Hide chat button when widget is open on mobile */
                    .iuea-chat-widget.open ~ .iuea-chat-button,
                    body.iuea-chat-open .iuea-chat-button {
                        opacity: 0;
                        visibility: hidden;
                        pointer-events: none;
                        transform: scale(0.8);
                        transition: all 0.3s ease;
                    }
                }
            `;

      const styleSheet = document.createElement("style");
      styleSheet.textContent = styles;
      document.head.appendChild(styleSheet);
    }

    createChatButton() {
      this.chatButton = document.createElement("button");
      this.chatButton.className = "iuea-chat-button";
      this.chatButton.setAttribute("aria-label", "Open IUEA Chat Assistant");
      this.chatButton.innerHTML = `
                <div class="iuea-chat-pulse"></div>
                <svg viewBox="0 0 24 24">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 12h-2v-2h2v2zm0-4h-2V6h2v4z"/>
                </svg>
            `;

      document.body.appendChild(this.chatButton);
    }

    createChatWidget() {
      if (this.chatWidget) return;

      this.chatWidget = document.createElement("iframe");
      this.chatWidget.className = "iuea-chat-widget";
      this.chatWidget.src = `${CONFIG.WIDGET_URL}?apiUrl=${encodeURIComponent(
        CONFIG.API_URL + "/api/chatbot"
      )}`;
      this.chatWidget.frameBorder = "0";
      this.chatWidget.title = "IUEA Chat Assistant";
      this.chatWidget.setAttribute("allow", "microphone; camera");

      document.body.appendChild(this.chatWidget);

      // Listen for messages from iframe
      window.addEventListener("message", (event) => {
        // Allow messages from same origin or localhost for development
        const allowedOrigins = [
          new URL(CONFIG.WIDGET_URL).origin,
          "http://localhost:3000",
          window.location.origin,
        ];

        if (!allowedOrigins.includes(event.origin)) return;

        this.handleIframeMessage(event.data);
      });
    }

    handleIframeMessage(data) {
      switch (data.type) {
        case "newMessage":
          if (!this.isOpen) {
            this.showNotification();
          }
          break;
        case "chatInitialized":
          console.log("IUEA Chat initialized");
          break;
        case "chatError":
          console.error("IUEA Chat error:", data.error);
          break;
        case "closeChat":
          this.closeChat();
          break;
      }
    }

    setupEventListeners() {
      this.chatButton.addEventListener("click", (e) => {
        e.preventDefault();
        this.toggleChat();
      });

      // Close on escape key
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.isOpen) {
          this.closeChat();
        }
      });

      // Handle clicks outside chat widget
      document.addEventListener("click", (e) => {
        if (
          this.isOpen &&
          !this.chatWidget.contains(e.target) &&
          !this.chatButton.contains(e.target)
        ) {
          // Don't auto-close on mobile
          if (window.innerWidth > 768) {
            this.closeChat();
          }
        }
      });

      // Handle window resize
      window.addEventListener("resize", () => {
        if (this.chatWidget) {
          this.positionWidget();
        }

        // Update body class based on screen size and chat state
        if (this.isOpen) {
          if (window.innerWidth <= 768) {
            document.body.classList.add("iuea-chat-open");
          } else {
            document.body.classList.remove("iuea-chat-open");
          }
        }
      });
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

      // Add body class for mobile button hiding
      if (window.innerWidth <= 768) {
        document.body.classList.add("iuea-chat-open");
      }

      // Focus the iframe after opening
      setTimeout(() => {
        this.chatWidget.focus();
      }, 300);
    }

    closeChat() {
      this.isOpen = false;
      this.chatButton.classList.remove("open");
      if (this.chatWidget) {
        this.chatWidget.classList.remove("open");
      }

      // Remove body class when chat is closed
      document.body.classList.remove("iuea-chat-open");
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

      // Mobile full screen
      if (window.innerWidth <= 768) {
        this.chatWidget.style.position = "fixed";
        this.chatWidget.style.top = "0";
        this.chatWidget.style.left = "0";
        this.chatWidget.style.right = "0";
        this.chatWidget.style.bottom = "0";
        this.chatWidget.style.width = "100vw";
        this.chatWidget.style.height = "100vh";
        this.chatWidget.style.borderRadius = "0";
      } else {
        // Desktop positioning
        this.chatWidget.style.position = "fixed";
        this.chatWidget.style.bottom = `calc(${CONFIG.BUTTON_POSITION.bottom} + ${CONFIG.BUTTON_SIZE} + 10px)`;
        this.chatWidget.style.right = CONFIG.BUTTON_POSITION.right;
        this.chatWidget.style.width = CONFIG.CHAT_SIZE.width;
        this.chatWidget.style.height = CONFIG.CHAT_SIZE.height;
        this.chatWidget.style.borderRadius = "12px";
        this.chatWidget.style.top = "auto";
        this.chatWidget.style.left = "auto";
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
  }

  // Wait for DOM to be ready
  function initializeWidget() {
    const widget = new IUEAChatbotEmbed();

    // Expose widget to global scope
    window.IUEAChatbot = {
      open: () => widget.open(),
      close: () => widget.close(),
      toggle: () => widget.toggle(),
      isOpen: () => widget.isOpened(),
    };

    // Trigger custom event when widget is ready
    const event = new CustomEvent("iueaChatbotReady", {
      detail: { widget: window.IUEAChatbot },
    });
    document.dispatchEvent(event);
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeWidget);
  } else {
    initializeWidget();
  }
})();
