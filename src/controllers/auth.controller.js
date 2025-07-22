const admin = require("firebase-admin");

const authController = {
  verifyToken: async (req, res) => {
    try {
      const token = req.headers.authorization?.split("Bearer ")[1];
      if (!token) {
        return res.status(401).json({ error: "No token provided" });
      }

      const decodedToken = await admin.auth().verifyIdToken(token);
      res.json({ user: decodedToken });
    } catch (error) {
      res.status(401).json({ error: "Invalid token" });
    }
  },

  login: async (req, res) => {
    try {
      const { email, password } = req.body;
      // Implement your login logic here
      res.json({ token: "mock-token" });
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  },
};

module.exports = authController;
