const https = require("https");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

// Create express app for HTTPS server
const app = express();

// Configure CORS
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3001",
    credentials: true,
  })
);

// Parse JSON request body
app.use(express.json());

// SSL certificate options
const sslOptions = {
  key: fs.readFileSync(
    process.env.SSL_KEY_PATH || path.join(__dirname, "../certificates/key.pem")
  ),
  cert: fs.readFileSync(
    process.env.SSL_CERT_PATH ||
      path.join(__dirname, "../certificates/cert.pem")
  ),
};

// Create HTTPS server
const httpsServer = https.createServer(sslOptions, app);

// Start HTTPS server
const port = process.env.HTTPS_PORT || 3443;
httpsServer.listen(port, () => {
  console.log(`HTTPS server running on port ${port}`);
});

module.exports = httpsServer;
