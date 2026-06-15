import httpStatus from 'http-status';
import ApiError from './ApiError.js';

const FULL_ACCESS_ROLES = new Set(['admin', 'super_admin']);

/**
 * @param {import('express').Request['user']} user
 * @returns {string}
 */
export function resolveUserRole(user) {
  const raw = String(user?.role || 'user').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (raw === 'superadmin' || raw === 'super_admin') return 'super_admin';
  if (raw === 'admin') return 'admin';
  if (raw === 'accounts') return 'accounts';
  if (raw === 'user') return 'user';
  return raw || 'user';
}

/**
 * @param {string} role
 * @returns {boolean}
 */
export function hasFullVendorPoAccess(role) {
  return FULL_ACCESS_ROLES.has(role);
}

/**
 * @param {string} role
 * @param {string} [currentStatus]
 */
export function assertCanCreateVendorPo(role) {
  if (role === 'accounts') {
    throw new ApiError(httpStatus.FORBIDDEN, 'Accounts users cannot create vendor purchase orders');
  }
}

/**
 * @param {string} role
 * @param {string} currentStatus
 */
export function assertCanUpdateVendorPo(role, currentStatus) {
  if (hasFullVendorPoAccess(role)) return;
  if (currentStatus !== 'draft') {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'Only draft purchase orders can be edited by user or accounts roles'
    );
  }
}

/**
 * Normalize PO line items for user draft create/update (pricing cleared).
 * @param {Array<Record<string, unknown>>} items
 * @returns {Array<Record<string, unknown>>}
 */
function mapUserDraftPoItems(items) {
  return (items || []).map((item) => ({
    ...item,
    rate: 0,
    gstRate: 0,
  }));
}

/**
 * Merge accounts update: only rate/gst on lines; preserve user-owned line fields from existing PO.
 * @param {Array<Record<string, unknown>>} incoming
 * @param {import('mongoose').Document} existingPo
 * @returns {Array<Record<string, unknown>>}
 */
function mergeAccountsDraftPoItems(incoming, existingPo) {
  const existingItems = existingPo.poItems || [];
  const byId = new Map(existingItems.map((row) => [String(row._id), row]));

  return (incoming || []).map((item) => {
    const lineId = item._id ? String(item._id) : '';
    const existing = lineId ? byId.get(lineId) : null;
    if (!existing) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Accounts cannot add new line items on a user draft');
    }
    return {
      _id: existing._id,
      productId: existing.productId,
      productName: existing.productName,
      quantity: existing.quantity,
      type: existing.type,
      color: existing.color,
      pattern: existing.pattern,
      estimatedDeliveryDate: existing.estimatedDeliveryDate,
      rate: Number(item.rate ?? 0),
      gstRate: Number(item.gstRate ?? 0),
    };
  });
}

/**
 * Apply role-based field rules on vendor PO create body.
 * @param {Record<string, unknown>} body
 * @param {string} role
 * @returns {Record<string, unknown>}
 */
export function applyVendorPoCreateRoleRules(body, role) {
  assertCanCreateVendorPo(role);
  if (hasFullVendorPoAccess(role)) {
    return body;
  }
  if (role === 'user') {
    return {
      ...body,
      currentStatus: 'draft',
      poItems: mapUserDraftPoItems(body.poItems),
      subTotal: 0,
      gst: 0,
      total: 0,
    };
  }
  return body;
}

/**
 * Apply role-based field rules on vendor PO update body.
 * @param {Record<string, unknown>} body
 * @param {string} role
 * @param {import('mongoose').Document} existingPo
 * @returns {Record<string, unknown>}
 */
export function applyVendorPoUpdateRoleRules(body, role, existingPo) {
  assertCanUpdateVendorPo(role, existingPo.currentStatus);

  if (hasFullVendorPoAccess(role)) {
    return body;
  }

  if (role === 'user') {
    const nextStatus = body.currentStatus === 'submitted_to_vendor' ? 'draft' : body.currentStatus || 'draft';
    if (body.currentStatus === 'submitted_to_vendor') {
      throw new ApiError(httpStatus.FORBIDDEN, 'User role cannot submit purchase orders to vendor');
    }
    return {
      vendor: body.vendor,
      vendorName: body.vendorName,
      creditDays: body.creditDays,
      estimatedOrderDeliveryDate: body.estimatedOrderDeliveryDate,
      notes: body.notes,
      poItems: mapUserDraftPoItems(body.poItems),
      subTotal: 0,
      gst: 0,
      total: 0,
      currentStatus: nextStatus,
    };
  }

  if (role === 'accounts') {
    const poItems = mergeAccountsDraftPoItems(body.poItems, existingPo);
    const subTotal = poItems.reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.rate || 0),
      0
    );
    const gst = poItems.reduce(
      (sum, item) =>
        sum + (Number(item.quantity || 0) * Number(item.rate || 0) * Number(item.gstRate || 0)) / 100,
      0
    );
    const submitting = body.currentStatus === 'submitted_to_vendor';
    if (submitting) {
      poItems.forEach((item, idx) => {
        if (Number(item.rate || 0) <= 0) {
          throw new ApiError(httpStatus.BAD_REQUEST, `Line ${idx + 1}: rate is required before submit`);
        }
        if (Number(item.gstRate || 0) <= 0) {
          throw new ApiError(httpStatus.BAD_REQUEST, `Line ${idx + 1}: GST % is required before submit`);
        }
      });
    }
    return {
      poItems,
      subTotal,
      gst,
      total: subTotal + gst,
      ...(submitting ? { currentStatus: 'submitted_to_vendor' } : { currentStatus: 'draft' }),
    };
  }

  return body;
}
