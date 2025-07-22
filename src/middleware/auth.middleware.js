const jwt = require("jsonwebtoken");
const { getAuth } = require("firebase-admin/auth");

const authenticateUser = async (req, res, next) => {
  try {
    // Development bypass - remove this in production
    if (process.env.NODE_ENV === "development" || !process.env.JWT_SECRET) {
      console.log("🔓 Development mode: Bypassing authentication");
      req.user = {
        uid: "dev_user_123",
        email: "dev@example.com",
        role: "admin",
        organizationId: "dev_org_123",
      };
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Invalid token format" });
    }

    try {
      // Try Firebase token first
      console.log("🔐 Verifying Firebase token...");
      const decodedToken = await getAuth().verifyIdToken(token);
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        role: decodedToken.role || "user",
        organizationId: decodedToken.organizationId || "default_org",
      };
      console.log(
        `✅ Firebase authenticated user: ${req.user.email || req.user.uid} (${
          req.user.role
        })`
      );
      return next();
    } catch (firebaseError) {
      console.log(
        "❌ Firebase token verification failed:",
        firebaseError.message
      );

      // Fallback to JWT
      try {
        console.log("🔐 Trying JWT verification...");
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Verify if decoded token has required fields
        if (!decoded.uid) {
          return res.status(401).json({
            message: "Invalid token - missing required claims",
            debug: { decoded },
          });
        }

        req.user = {
          uid: decoded.uid,
          email: decoded.email,
          role: decoded.role || "user",
          organizationId: decoded.organizationId || "default_org",
        };

        console.log(
          `✅ JWT authenticated user: ${req.user.email || req.user.uid} (${
            req.user.role
          })`
        );
        next();
      } catch (jwtError) {
        console.error("JWT verification also failed:", jwtError.message);
        return res.status(401).json({
          message: "Invalid token",
          error: jwtError.message,
        });
      }
    }
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Insufficient permissions",
        userRole: req.user.role,
        allowedRoles: allowedRoles,
      });
    }

    next();
  };
};

module.exports = { authenticateUser, checkRole };
