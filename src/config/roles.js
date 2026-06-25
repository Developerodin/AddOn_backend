const basePermissions = [
  'getUsers',
  'manageUsers',
  'getMachines',
  'manageMachines',
  'getOrders',
  'manageOrders',
  'getUserActivityLogs',
  'getHelpSupportTickets',
];

const agentPermissions = [...basePermissions, 'manageHelpSupportTickets', 'getHelpSupportAnalytics'];

const adminPermissions = [...agentPermissions, 'deleteHelpSupportTickets'];

const allRoles = {
  user: basePermissions,
  accounts: agentPermissions,
  admin: adminPermissions,
  super_admin: adminPermissions,
};

const roles = Object.keys(allRoles);
const roleRights = new Map(Object.entries(allRoles));

export { roles, roleRights };
