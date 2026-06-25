/** Super-admin email with full ticket management access */
export const HELP_SUPPORT_SUPER_EMAIL = 'admin@addon.in';

/** Roles that can act as help & support agents (view all, change status, analytics). */
const AGENT_ROLES = new Set(['accounts', 'admin', 'super_admin']);

/** Roles that can delete tickets. */
const ADMIN_ROLES = new Set(['admin', 'super_admin']);

/**
 * Normalize role string (handles superadmin / casing variants).
 * @param {string} [role]
 * @returns {string|undefined}
 */
const normalizeRole = (role) => {
  if (!role) return undefined;
  const normalized = String(role).trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'superadmin') return 'super_admin';
  return normalized;
};

/**
 * Whether user email grants super-admin help & support access.
 * @param {{ email?: string }} user
 * @returns {boolean}
 */
const isSuperSupportEmail = (user) =>
  user?.email?.trim().toLowerCase() === HELP_SUPPORT_SUPER_EMAIL;

/**
 * Whether the user is a help & support agent.
 * @param {{ role?: string, email?: string }} user
 * @returns {boolean}
 */
export const isHelpSupportAgent = (user) => {
  if (isSuperSupportEmail(user)) return true;
  const role = normalizeRole(user?.role);
  return Boolean(role && AGENT_ROLES.has(role));
};

/**
 * Whether the user may delete help & support tickets (super email only).
 * @param {{ email?: string }} user
 * @returns {boolean}
 */
export const canDeleteHelpSupportTicket = (user) => isSuperSupportEmail(user);

/**
 * Whether the user is a help & support admin (assign anyone, etc.).
 * @param {{ role?: string, email?: string }} user
 * @returns {boolean}
 */
export const isHelpSupportAdmin = (user) => {
  if (isSuperSupportEmail(user)) return true;
  const role = normalizeRole(user?.role);
  return Boolean(role && ADMIN_ROLES.has(role));
};

/**
 * Whether the user raised the ticket.
 * @param {{ _id?: import('mongoose').Types.ObjectId | string }} user
 * @param {{ raisedBy?: import('mongoose').Types.ObjectId | string | { toString(): string } }} ticket
 * @returns {boolean}
 */
export const isTicketOwner = (user, ticket) => {
  if (!user?._id || !ticket?.raisedBy) return false;
  const ownerId = ticket.raisedBy._id ? ticket.raisedBy._id.toString() : ticket.raisedBy.toString();
  return user._id.toString() === ownerId;
};

/**
 * Whether the user may view a ticket.
 * @param {{ _id?: import('mongoose').Types.ObjectId | string, role?: string, email?: string }} user
 * @param {{ raisedBy?: import('mongoose').Types.ObjectId | string }} ticket
 * @returns {boolean}
 */
export const canViewTicket = (user, ticket) => isHelpSupportAgent(user) || isTicketOwner(user, ticket);

const HELP_SUPPORT_API_RIGHTS = new Set([
  'getHelpSupportTickets',
  'manageHelpSupportTickets',
  'getHelpSupportAnalytics',
  'deleteHelpSupportTickets',
]);

/**
 * Grants help-support API rights for super-admin email when JWT role rights are stale.
 * @param {{ role?: string, email?: string }} user
 * @param {string[]} requiredRights
 * @returns {boolean}
 */
export const hasHelpSupportApiAccess = (user, requiredRights) => {
  if (!requiredRights.length || !requiredRights.every((r) => HELP_SUPPORT_API_RIGHTS.has(r))) {
    return false;
  }
  if (requiredRights.includes('deleteHelpSupportTickets')) {
    return canDeleteHelpSupportTicket(user);
  }
  return isHelpSupportAgent(user);
};
