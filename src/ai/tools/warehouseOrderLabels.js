/**
 * Warehouse quantities are whole packs. Drops the fraction. Does not round.
 * @param {unknown} value
 * @returns {number}
 */
export function integerQty(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.trunc(number);
}

/**
 * Coarse status labels from `whmsWarehouseOrderService.ts` `WAREHOUSE_ORDER_STATUS_LABELS`.
 * `submitted` is the legacy alias the UI maps to Pending.
 */
const STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  pending: 'Pending',
  'in-progress': 'In-Progress',
  packed: 'Packed',
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
});

/**
 * Flow-stage labels from `WAREHOUSE_ORDER_FLOW_STATUS_LABELS` in the same file.
 * Keys are the stored `flowStatus` values. This map does not derive a stage.
 */
const FLOW_LABELS = Object.freeze({
  'order-created': 'Order Created',
  picking: 'Picking',
  'picking-done': 'Picking Done',
  'barcode-in-progress': 'Barcode & Qty Update',
  'packing-done': 'Packing Done',
  'sent-to-scanning': 'Sent to Scanning',
  'scanning-in-progress': 'Scanning In Progress',
  'scanning-done': 'Scanning Done',
  'sent-to-billing': 'Sent to Billing',
  billed: 'Billed',
  'ready-to-dispatch': 'Ready to Dispatch',
  dispatched: 'Dispatched',
  'partial-dispatched': 'Partial Dispatch',
  'ready-for-pickup': 'Ready for Pickup',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
});

/**
 * UI label for a stored coarse status. Does not read `flowStatus`.
 * @param {unknown} raw
 * @returns {string}
 */
export function warehouseStatusLabel(raw) {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  if (value === 'submitted') return STATUS_LABELS.pending;
  if (Object.prototype.hasOwnProperty.call(STATUS_LABELS, value)) return STATUS_LABELS[value];
  if (value) return String(raw).trim();
  return STATUS_LABELS.draft;
}

/**
 * UI label for a stored flowStatus. Unknown values stay as stored.
 * A missing flowStatus is null. It is not filled in from the coarse status.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function warehouseFlowStageLabel(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const key = value.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(FLOW_LABELS, key)) return FLOW_LABELS[key];
  return value;
}
