const { hasPermission, canViewLeadStage } = require("../config/roles.config");

/**
 * Middleware to check if user has required permission
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    const userRole = req.user?.role || req.user?.jobRole;

    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "No role assigned to user",
      });
    }

    if (!hasPermission(userRole, permission)) {
      return res.status(403).json({
        success: false,
        message: `Permission denied. Required permission: ${permission}`,
      });
    }

    next();
  };
};

/**
 * Middleware to filter leads based on user's role stage access
 */
const filterLeadsByRole = (req, res, next) => {
  const userRole = req.user?.role || req.user?.jobRole;

  if (!userRole) {
    return res.status(403).json({
      success: false,
      message: "No role assigned to user",
    });
  }

  // Store the role in request for use in controllers
  req.userRole = userRole;
  req.canViewLeadStage = (stage) => canViewLeadStage(userRole, stage);

  next();
};

/**
 * Middleware to check multiple permissions (OR condition)
 */
const requireAnyPermission = (permissions) => {
  return (req, res, next) => {
    const userRole = req.user?.role || req.user?.jobRole;

    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "No role assigned to user",
      });
    }

    const hasAnyPermission = permissions.some((permission) =>
      hasPermission(userRole, permission)
    );

    if (!hasAnyPermission) {
      return res.status(403).json({
        success: false,
        message: `Permission denied. Required one of: ${permissions.join(
          ", "
        )}`,
      });
    }

    next();
  };
};

/**
 * Middleware to check if user has one of the required roles
 */
const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    const userRole = req.user?.role || req.user?.jobRole;

    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "No role assigned to user",
      });
    }

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${allowedRoles.join(", ")}`,
      });
    }

    next();
  };
};

module.exports = {
  requirePermission,
  filterLeadsByRole,
  requireAnyPermission,
  checkRole,
};
