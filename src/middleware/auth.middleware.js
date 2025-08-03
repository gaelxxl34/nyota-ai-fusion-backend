const jwt = require("jsonwebtoken");
const { getAuth } = require("firebase-admin/auth");
const admin = require("firebase-admin");

const authenticateUser = async (req, res, next) => {
  try {
    console.log("=== AUTH MIDDLEWARE ===");
    console.log("URL:", req.url);
    console.log("Auth header:", req.headers.authorization);

    // Only bypass authentication if explicitly enabled and no JWT secret
    if (process.env.DISABLE_AUTH === "true" && !process.env.JWT_SECRET) {
      console.log("🔓 Development mode: Bypassing authentication");
      req.user = {
        uid: "dev_user_123",
        email: "dev@example.com",
        role: "organizationAdmin",
        organizationId: "iuea",
      };
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      console.log("❌ No authorization header");
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

      // Get additional user data from Firestore
      const userDoc = await admin
        .firestore()
        .collection("users")
        .doc(decodedToken.uid)
        .get();
      const userData = userDoc.exists ? userDoc.data() : {};

      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email || userData.email,
        role:
          decodedToken.role ||
          userData.role ||
          userData.jobRole ||
          "teamMember",
        name: userData.name || userData.displayName,
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
          role: decoded.role || decoded.jobRole || "teamMember",
          name: decoded.name || decoded.displayName,
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
