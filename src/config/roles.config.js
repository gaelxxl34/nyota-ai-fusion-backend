/**
 * Role and Permission Configuration
 * Defines all roles and their associated permissions in the system
 */

const LEAD_STAGES = {
  NEW_CONTACT: "new_contact",
  CONTACTED: "contacted",
  QUALIFIED: "qualified",
  APPLIED: "applied",
  ADMITTED: "admitted",
  ENROLLED: "enrolled",
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
};

const ROLES = {
  superAdmin: {
    name: "Super Admin",
    description: "Full system access including user management",
    permissions: Object.values(PERMISSIONS),
    leadStageAccess: {
      from: LEAD_STAGES.NEW_CONTACT,
      to: LEAD_STAGES.ENROLLED,
    },
  },

  admin: {
    name: "Admin",
    description: "Administrative access to most features",
    permissions: Object.values(PERMISSIONS),
    leadStageAccess: {
      from: LEAD_STAGES.NEW_CONTACT,
      to: LEAD_STAGES.ENROLLED,
    },
  },

  marketingManager: {
    name: "Marketing Manager",
    description: "Access to marketing and lead generation features",
    permissions: [
      PERMISSIONS.CHAT_CONFIG,
      PERMISSIONS.DATA_CENTER,
      PERMISSIONS.ANALYTICS,
      PERMISSIONS.SETTINGS,
      PERMISSIONS.VIEW_MARKETING_LEADS,
    ],
    leadStageAccess: {
      from: LEAD_STAGES.NEW_CONTACT,
      to: LEAD_STAGES.APPLIED,
    },
  },

  admissionsOfficer: {
    name: "Admissions Officer",
    description: "Access to admissions and enrollment features",
    permissions: [
      PERMISSIONS.CHAT_CONFIG,
      PERMISSIONS.DATA_CENTER,
      PERMISSIONS.ANALYTICS,
      PERMISSIONS.SETTINGS,
      PERMISSIONS.VIEW_ADMISSIONS_LEADS,
    ],
    leadStageAccess: {
      from: LEAD_STAGES.APPLIED,
      to: LEAD_STAGES.ENROLLED,
    },
  },

  teamMember: {
    name: "Team Member",
    description: "Basic access to assigned features",
    permissions: [PERMISSIONS.DATA_CENTER, PERMISSIONS.SETTINGS],
    leadStageAccess: {
      from: LEAD_STAGES.NEW_CONTACT,
      to: LEAD_STAGES.ENROLLED,
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
    INQUIRY: LEAD_STAGES.NEW_CONTACT,
    CONTACTED: LEAD_STAGES.CONTACTED,
    PRE_QUALIFIED: LEAD_STAGES.QUALIFIED,
    QUALIFIED: LEAD_STAGES.QUALIFIED,
    APPLIED: LEAD_STAGES.APPLIED,
    ADMITTED: LEAD_STAGES.ADMITTED,
    ENROLLED: LEAD_STAGES.ENROLLED,
    REJECTED: LEAD_STAGES.NEW_CONTACT,
    NURTURE: LEAD_STAGES.CONTACTED,
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
