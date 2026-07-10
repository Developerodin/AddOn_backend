import crypto from 'crypto';

/**
 * Map WHMS flow statuses to OpenCart order_status_id values.
 * Verified from oc_order_status: Pending=1, Processing=2, Shipped=3, Complete=5, Canceled=7.
 */

/** @typedef {{ orderStatusId: number, notify: boolean, label: string }} WebsiteStatusTarget */

/** @type {Record<string, WebsiteStatusTarget | null>} */
const WHMS_TO_WEBSITE_MAP = {
  'order-created': { orderStatusId: 2, notify: false, label: 'Processing' },
  picking: { orderStatusId: 2, notify: false, label: 'Processing' },
  billed: { orderStatusId: 2, notify: false, label: 'Processing' },
  dispatched: { orderStatusId: 3, notify: true, label: 'Shipped' },
  'partial-dispatched': { orderStatusId: 3, notify: true, label: 'Shipped (partial)' },
  'ready-for-pickup': { orderStatusId: 3, notify: true, label: 'Ready for pickup' },
  delivered: { orderStatusId: 5, notify: true, label: 'Complete' },
  cancelled: { orderStatusId: 7, notify: true, label: 'Canceled' },
  // Internal stages — do not push to website
  'picking-done': null,
  'barcode-in-progress': null,
  'packing-done': null,
  'sent-to-scanning': null,
  'scanning-in-progress': null,
  'scanning-done': null,
  'sent-to-billing': null,
  'ready-to-dispatch': null,
};

/**
 * Resolve website order status target for a WHMS flow status.
 * @param {string} flowStatus
 * @returns {WebsiteStatusTarget | null}
 */
export const mapWhmsToWebsite = (flowStatus) => {
  const key = String(flowStatus || '').trim().toLowerCase();
  return WHMS_TO_WEBSITE_MAP[key] ?? null;
};

/**
 * Build a customer-visible history comment for a website push.
 * @param {string} label
 * @param {object} [dispatch]
 * @returns {string}
 */
export const buildWhmsSyncComment = (label, dispatch = {}) => {
  const parts = [`WHMS-SYNC: ${label}`];
  if (dispatch.courierName) parts.push(`via ${dispatch.courierName}`);
  if (dispatch.trackingNumber) parts.push(`AWB: ${dispatch.trackingNumber}`);
  if (dispatch.boxCount) parts.push(`Boxes: ${dispatch.boxCount}`);
  return parts.join('. ') + '.';
};

/**
 * Build a deterministic sync token for outbound idempotency.
 * @param {object} order
 * @param {string} event
 * @returns {string}
 */
export const buildSyncToken = (order, event) => {
  const id = String(order._id || order.id);
  const flow = String(order.flowStatus || '');
  const tracking = String(order.dispatch?.trackingNumber || '');
  const updated = order.updatedAt ? new Date(order.updatedAt).toISOString() : '';
  return crypto.createHash('sha256').update(`${id}|${flow}|${tracking}|${event}|${updated}`).digest('hex');
};
