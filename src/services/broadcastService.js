/**
 * Broadcast Service for Server-Sent Events (SSE)
 * Handles real-time updates for WhatsApp messages and conversations
 */

// Store active SSE connections
const sseClients = new Map();

/**
 * Get the clients map (for external access)
 */
function getClients() {
  return sseClients;
}

/**
 * Add a new SSE client connection (without setting headers)
 */
function addSSEClientSimple(clientId, response) {
  console.log(`📡 New SSE client connected: ${clientId}`);

  // Store client connection
  sseClients.set(clientId, {
    response: response,
    connectedAt: new Date(),
    lastPing: new Date(),
  });

  // Handle client disconnect
  response.on("close", () => {
    console.log(`📡 SSE client disconnected: ${clientId}`);
    sseClients.delete(clientId);
  });

  // Send periodic ping to keep connection alive
  const pingInterval = setInterval(() => {
    if (sseClients.has(clientId)) {
      try {
        const client = sseClients.get(clientId);
        client.response.write(
          `data: ${JSON.stringify({
            type: "ping",
            timestamp: new Date().toISOString(),
          })}\n\n`
        );
        client.lastPing = new Date();
      } catch (error) {
        console.error(`❌ Error sending ping to client ${clientId}:`, error);
        clearInterval(pingInterval);
        sseClients.delete(clientId);
      }
    } else {
      clearInterval(pingInterval);
    }
  }, 15000); // Send ping every 15 seconds for better responsiveness

  return clientId;
}

/**
 * Add a new SSE client connection (legacy function - with headers)
 */
function addSSEClient(clientId, response) {
  console.log(`📡 New SSE client connected: ${clientId}`);

  // Set SSE headers
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Cache-Control",
  });

  // Send initial connection confirmation
  response.write(
    `data: ${JSON.stringify({
      type: "connection",
      message: "SSE connected successfully",
      timestamp: new Date().toISOString(),
    })}\n\n`
  );

  return addSSEClientSimple(clientId, response);
}

/**
 * Broadcast message to all connected SSE clients
 */
function broadcastMessage(data, eventType = "message") {
  const message = {
    type: eventType,
    data: data,
    timestamp: new Date().toISOString(),
  };

  const messageString = `data: ${JSON.stringify(message)}\n\n`;
  let sentCount = 0;
  let failedCount = 0;

  sseClients.forEach((client, clientId) => {
    try {
      client.response.write(messageString);
      sentCount++;
    } catch (error) {
      console.log(`📡 Failed to send to client ${clientId}:`, error.message);
      sseClients.delete(clientId);
      failedCount++;
    }
  });

  if (sentCount > 0) {
    console.log(
      `📡 Broadcasted ${eventType} to ${sentCount} clients${
        failedCount > 0 ? ` (${failedCount} failed)` : ""
      }`
    );
  }

  return { sent: sentCount, failed: failedCount };
}

/**
 * Broadcast automated WhatsApp message
 */
function broadcastAutomatedMessage(
  phoneNumber,
  message,
  contactName,
  source = "automation"
) {
  const data = {
    phoneNumber: phoneNumber,
    message: message,
    contactName: contactName,
    source: source,
    direction: "outgoing",
    sender: "system",
  };

  return broadcastMessage(data, "automated_message");
}

/**
 * Broadcast conversation event
 */
function broadcastConversationEvent(
  conversationData,
  eventType = "conversation_update"
) {
  return broadcastMessage(conversationData, eventType);
}

/**
 * Broadcast incoming WhatsApp message
 */
function broadcastIncomingMessage(messageData) {
  return broadcastMessage(messageData, "incoming_message");
}

/**
 * Broadcast outgoing WhatsApp message
 */
function broadcastOutgoingMessage(messageData) {
  return broadcastMessage(messageData, "outgoing_message");
}

/**
 * Get SSE connection statistics
 */
function getSSEStats() {
  return {
    connectedClients: sseClients.size,
    connections: Array.from(sseClients.entries()).map(([clientId, client]) => ({
      clientId: clientId,
      connectedAt: client.connectedAt,
      lastPing: client.lastPing,
    })),
  };
}

/**
 * Cleanup disconnected clients
 */
function cleanupClients() {
  const now = new Date();
  let cleanedCount = 0;

  sseClients.forEach((client, clientId) => {
    // Remove clients that haven't been pinged in over 1 minute
    if (now - client.lastPing > 60000) {
      try {
        client.response.end();
      } catch (error) {
        // Connection already closed
      }
      sseClients.delete(clientId);
      cleanedCount++;
    }
  });

  if (cleanedCount > 0) {
    console.log(`📡 Cleaned up ${cleanedCount} stale SSE connections`);
  }

  return cleanedCount;
}

// Run cleanup every 2 minutes for better performance
setInterval(cleanupClients, 120000);

/**
 * Add a new SSE client connection (alias for addSSEClient)
 */
function addConnection(clientId, response) {
  return addSSEClient(clientId, response);
}

/**
 * Remove SSE client connection
 */
function removeConnection(clientId) {
  if (sseClients.has(clientId)) {
    try {
      const client = sseClients.get(clientId);
      client.response.end();
    } catch (error) {
      // Connection already closed
    }
    sseClients.delete(clientId);
    console.log(`📡 Manually removed SSE client: ${clientId}`);
    return true;
  }
  return false;
}

module.exports = {
  addSSEClient,
  addSSEClientSimple,
  addConnection,
  removeConnection,
  broadcastMessage,
  broadcastAutomatedMessage,
  broadcastConversationEvent,
  broadcastIncomingMessage,
  broadcastOutgoingMessage,
  getSSEStats,
  cleanupClients,
  getClients,
};
