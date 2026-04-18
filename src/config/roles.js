const allPermissions = ['getUsers', 'manageUsers', 'getMachines', 'manageMachines', 'getOrders', 'manageOrders', 'getUserActivityLogs'];

const allRoles = {
  user: allPermissions,
  admin: allPermissions,
};

const roles = Object.keys(allRoles);
const roleRights = new Map(Object.entries(allRoles));

export { roles, roleRights };
