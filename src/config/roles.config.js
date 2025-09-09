/**
 * Role and Permission Configuration
 * Defines all roles and their associated permissions in the system
 */

const LEAD_STAGES = {
  INTERESTED: "INTERESTED",
  APPLIED: "APPLIED",
  IN_REVIEW: "IN_REVIEW",
  QUALIFIED: "QUALIFIED",
  ADMITTED: "ADMITTED",
  ENROLLED: "ENROLLED",
  DEFERRED: "DEFERRED",
  EXPIRED: "EXPIRED",
};

const PERMISSIONS = {
  // Page access permissions
  LEADS_OVERVIEW: "leads_overview",
  CHAT_CONFIG: "chat_config",
  DATA_CENTER: "data_center",
  ANALYTICS: "analytics",
  TEAM: "team",
  SETTINGS: "settings",
  KNOWLEDGE_BASE: "knowledge_base",

  // Data visibility permissions
  VIEW_ALL_LEADS: "view_all_leads",
  VIEW_MARKETING_LEADS: "view_marketing_leads", // new_contact to applied
  VIEW_ADMISSIONS_LEADS: "view_admissions_leads", // applied to enrolled

  // Action permissions
  MANAGE_TEAM: "manage_team",
  MANAGE_SETTINGS: "manage_settings",
  EXPORT_DATA: "export_data",
  CREATE_APPLICATION: "create_application",
};

const ROLES = {
  superAdmin: {
    name: "Super Admin",
    description: "Full system access including user management",
    permissions: Object.values(PERMISSIONS),
    leadStageAccess: {
      from: LEAD_STAGES.INTERESTED,
      to: LEAD_STAGES.EXPIRED,
    },
  },

  admin: {
    name: "Admin",
    description: "Administrative access to most features",
    permissions: Object.values(PERMISSIONS),
    leadStageAccess: {
      from: LEAD_STAGES.INTERESTED,
      to: LEAD_STAGES.EXPIRED,
    },
  },

  admissionAdmin: {
    name: "Admission Admin",
    description:
      "Administrative access to admission features (Applied to the very end)",
    permissions: [
      PERMISSIONS.CHAT_CONFIG,
      PERMISSIONS.DATA_CENTER,
      PERMISSIONS.ANALYTICS,
      PERMISSIONS.TEAM,
      PERMISSIONS.SETTINGS,
      PERMISSIONS.KNOWLEDGE_BASE,
      PERMISSIONS.VIEW_ADMISSIONS_LEADS,
      PERMISSIONS.MANAGE_TEAM,
      PERMISSIONS.MANAGE_SETTINGS,
      PERMISSIONS.EXPORT_DATA,
      PERMISSIONS.CREATE_APPLICATION,
    ],
    leadStageAccess: {
      from: LEAD_STAGES.APPLIED,
      to: LEAD_STAGES.EXPIRED,
    },
  },

  marketingAgent: {
    name: "Marketing Agent",
    description: "Access to marketing features (Interested to Admitted)",
    permissions: [
      PERMISSIONS.CHAT_CONFIG,
      PERMISSIONS.DATA_CENTER,
      PERMISSIONS.SETTINGS,
      PERMISSIONS.VIEW_MARKETING_LEADS,
      PERMISSIONS.CREATE_APPLICATION,
    ],
    leadStageAccess: {
      from: LEAD_STAGES.INTERESTED,
      to: LEAD_STAGES.ADMITTED,
    },
  },

  admissionAgent: {
    name: "Admission Agent",
    description: "Access to admissions features (Applied to the very end)",
    permissions: [
      PERMISSIONS.CHAT_CONFIG,
      PERMISSIONS.DATA_CENTER,
      PERMISSIONS.SETTINGS,
      PERMISSIONS.VIEW_ADMISSIONS_LEADS,
      PERMISSIONS.CREATE_APPLICATION,
    ],
    leadStageAccess: {
      from: LEAD_STAGES.APPLIED,
      to: LEAD_STAGES.EXPIRED,
    },
  },
};

// Helper functions
const getRolePermissions = (role) => {
  return ROLES[role]?.permissions || [];
};

const hasPermission = (role, permission) => {
  const permissions = getRolePermissions(role);
  return permissions.includes(permission);
};

const getLeadStageAccess = (role) => {
  return ROLES[role]?.leadStageAccess || null;
};

const canViewLeadStage = (role, stage) => {
  const access = getLeadStageAccess(role);
  if (!access) return false;

  // Map database status values to our LEAD_STAGES
  const statusToStageMap = {
    NO_LEAD: LEAD_STAGES.INTERESTED, // Conversations not linked to leads
    INQUIRY: LEAD_STAGES.INTERESTED,
    INTERESTED: LEAD_STAGES.INTERESTED,
    APPLIED: LEAD_STAGES.APPLIED,
    IN_REVIEW: LEAD_STAGES.IN_REVIEW,
    QUALIFIED: LEAD_STAGES.QUALIFIED,
    ADMITTED: LEAD_STAGES.ADMITTED,
    ENROLLED: LEAD_STAGES.ENROLLED,
    DEFERRED: LEAD_STAGES.DEFERRED,
    EXPIRED: LEAD_STAGES.EXPIRED,
  };

  // Convert the stage if it's a database status value
  const normalizedStage = statusToStageMap[stage] || stage;

  const stages = Object.values(LEAD_STAGES);
  const fromIndex = stages.indexOf(access.from);
  const toIndex = stages.indexOf(access.to);
  const stageIndex = stages.indexOf(normalizedStage);

  return stageIndex >= fromIndex && stageIndex <= toIndex;
};

module.exports = {
  LEAD_STAGES,
  PERMISSIONS,
  ROLES,
  getRolePermissions,
  hasPermission,
  getLeadStageAccess,
  canViewLeadStage,
};
