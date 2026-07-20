import { roleRights } from '../config/roles.js';
import { getNavigationPermission } from './navigationHelper.js';

/**
 * WHMS stage API rights that can be granted via Warehouse Management navigation toggles.
 * Role-only rights (e.g. whmsBarcode, whmsReturnsApprove) are intentionally omitted.
 */
const WHMS_RIGHT_TO_NAV_PATH = Object.freeze({
  whmsPickingSupervise: 'Warehouse Management.Pick&Pack',
  whmsScanning: 'Warehouse Management.Scanning',
  whmsBilling: 'Warehouse Management.Billing',
  whmsDispatch: 'Warehouse Management.Dispatch',
  whmsReturns: 'Warehouse Management.Returns',
});

/**
 * Whether a user has a WHMS stage API right via their assigned navigation permission.
 * @param {{ navigation?: object }} user
 * @param {string} right
 * @returns {boolean}
 */
export const hasWhmsNavigationAccess = (user, right) => {
  const navPath = WHMS_RIGHT_TO_NAV_PATH[right];
  if (!navPath || !user?.navigation) return false;
  return getNavigationPermission(user.navigation, navPath);
};

/**
 * Whether a user has a WHMS stage API right from role rights or navigation permission.
 * @param {{ role?: string, navigation?: object }} user
 * @param {string} right
 * @returns {boolean}
 */
export const userHasWhmsRight = (user, right) => {
  if (!user || !right) return false;
  const rights = roleRights.get(user.role) || [];
  if (rights.includes(right)) return true;
  return hasWhmsNavigationAccess(user, right);
};

/**
 * Whether navigation (or role) grants all required WHMS API rights for route auth.
 * @param {{ role?: string, navigation?: object }} user
 * @param {string[]} requiredRights
 * @returns {boolean}
 */
export const hasWhmsApiAccess = (user, requiredRights) => {
  if (!requiredRights.length) return false;
  return requiredRights.every((right) => userHasWhmsRight(user, right));
};

export { WHMS_RIGHT_TO_NAV_PATH };
