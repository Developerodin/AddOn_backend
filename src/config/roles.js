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

/** WHMS fulfilment-stage permissions — gate warehouse order flow transitions and stage screens. */
const whmsStagePermissions = [
  'whmsPickingSupervise',
  'whmsBarcode',
  'whmsScanning',
  'whmsBilling',
  'whmsDispatch',
  'whmsReturns',
  'whmsReturnsApprove',
];

const agentPermissions = [...basePermissions, 'manageHelpSupportTickets', 'getHelpSupportAnalytics'];

const adminPermissions = [...agentPermissions, 'deleteHelpSupportTickets', ...whmsStagePermissions];

const allRoles = {
  user: basePermissions,
  accounts: [...agentPermissions, 'whmsBilling'],
  admin: adminPermissions,
  super_admin: adminPermissions,
  floor_supervisor: [...basePermissions, 'whmsPickingSupervise', 'whmsReturns', 'whmsReturnsApprove'],
  barcode_team: [...basePermissions, 'whmsBarcode'],
  scanning_team: [...basePermissions, 'whmsScanning', 'whmsReturns'],
  billing_team: [...basePermissions, 'whmsBilling'],
  dispatch_team: [...basePermissions, 'whmsDispatch'],
};

const roles = Object.keys(allRoles);
const roleRights = new Map(Object.entries(allRoles));

export { roles, roleRights, whmsStagePermissions };
