const allRoles = {
  user: [],
  admin: ['getUsers', 'manageUsers', 'getMachines', 'manageMachines', 'getOrders', 'manageOrders'],
};

const roles = Object.keys(allRoles);
const roleRights = new Map(Object.entries(allRoles));

export { roles, roleRights };
