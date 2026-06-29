import httpStatus from 'http-status';
import { VendorBox, VendorProductionFlow } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/** Max units allowed in a single box sync — guards against barcode / typo inflation. */
export const MAX_VENDOR_BOX_UNIT_SYNC = 100_000;

/**
 * Validates and normalizes a box unit quantity for production-flow sync.
 * @param {unknown} qty - Raw quantity from box or delta
 * @param {string} [label] - Field name for error messages
 * @returns {number} Sanitized positive quantity
 */
export function assertSaneBoxUnitQty(qty, label = 'quantityChange') {
  const n = Math.round(Number(qty));
  if (!Number.isFinite(n) || n <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, `${label} must be a positive number`);
  }
  if (n > MAX_VENDOR_BOX_UNIT_SYNC) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `${label} (${n.toLocaleString()}) exceeds the maximum allowed per box (${MAX_VENDOR_BOX_UNIT_SYNC.toLocaleString()}). Check for a scanned barcode in the units field.`
    );
  }
  return n;
}

/**
 * Sums box units for a VPO article, split by secondary-checking acceptance.
 * @param {Array<{ numberOfUnits?: number, secondaryCheckingAccepted?: boolean }>} boxes
 * @returns {{ planned: number, received: number, pending: number }}
 */
export function sumBoxUnitsForSecondaryChecking(boxes) {
  let planned = 0;
  let received = 0;
  for (const box of boxes) {
    const units = Math.max(0, Math.round(Number(box.numberOfUnits) || 0));
    planned += units;
    if (box.secondaryCheckingAccepted) {
      received += units;
    }
  }
  return { planned, received, pending: Math.max(0, planned - received) };
}

/**
 * Builds the production-flow lookup key for a vendor box.
 * @param {{ vendor: unknown, vendorPurchaseOrderId: unknown, productId: unknown }} box
 * @returns {{ vendor: unknown, vendorPurchaseOrder: unknown, product: unknown }}
 */
export function flowFilterFromBox(box) {
  return {
    vendor: box.vendor,
    vendorPurchaseOrder: box.vendorPurchaseOrderId,
    product: box.productId,
  };
}

/**
 * Compares flow secondary-checking totals against vendor box sums.
 * @param {object} flow - Vendor production flow document
 * @param {Array<{ numberOfUnits?: number, secondaryCheckingAccepted?: boolean }>} boxes
 * @returns {{ expected: { planned: number, received: number, pending: number }, actual: { planned: number, received: number, pending: number, remaining: number }, hasDrift: boolean }}
 */
export function auditSecondaryCheckingDrift(flow, boxes) {
  const expected = sumBoxUnitsForSecondaryChecking(boxes);
  const sc = flow.floorQuantities?.secondaryChecking || {};
  const actual = {
    planned: Math.max(0, Math.round(Number(flow.plannedQuantity) || 0)),
    received: Math.max(0, Math.round(Number(sc.received) || 0)),
    pending: Math.max(0, Math.round(Number(sc.pendingFromBoxes) || 0)),
    remaining: Math.max(0, Math.round(Number(sc.remaining) || 0)),
  };
  const hasDrift =
    actual.planned !== expected.planned ||
    actual.received !== expected.received ||
    actual.pending !== expected.pending;
  return { expected, actual, hasDrift };
}

/**
 * Creates a minimal secondary-checking flow when the first box for an article is synced.
 * @param {object} box - Vendor box document
 * @returns {Promise<object>} Existing or newly created flow
 */
export async function ensureSecondaryCheckingFlowForBox(box) {
  const filter = flowFilterFromBox(box);
  let flow = await VendorProductionFlow.findOne(filter);
  if (flow) return flow;

  const lotNumber = box.lotNumber ? String(box.lotNumber) : '';
  const lotEntry = {
    receivedStatusFromPreviousFloor: lotNumber ? `lot:${lotNumber}` : `box:${box.boxId || ''}`,
    lotNumber,
    boxId: box.boxId || '',
    receivedTimestamp: new Date(),
  };

  flow = await VendorProductionFlow.create({
    ...filter,
    currentFloorKey: 'secondaryChecking',
    referenceCode: box.lotNumber || box.vpoNumber,
    plannedQuantity: 0,
    floorQuantities: {
      secondaryChecking: {
        received: 0,
        remaining: 0,
        pendingFromBoxes: 0,
        receivedData: lotNumber ? [lotEntry] : [],
      },
    },
    startedAt: new Date(),
  });
  return flow;
}

/**
 * Recomputes plannedQuantity and secondary-checking intake buckets from vendor boxes.
 * Boxes are the source of truth for batch size and scan-accepted qty.
 * @param {{ vendor: import('mongoose').Types.ObjectId, vendorPurchaseOrder: import('mongoose').Types.ObjectId, product: import('mongoose').Types.ObjectId }} filter
 * @returns {Promise<object|null>} Updated flow document or null when missing
 */
export async function reconcileSecondaryCheckingFromBoxes(filter) {
  const flow = await VendorProductionFlow.findOne(filter);
  if (!flow) return null;

  const boxes = await VendorBox.find({
    vendor: filter.vendor,
    vendorPurchaseOrderId: filter.vendorPurchaseOrder,
    productId: filter.product,
  }).lean();

  const { planned, received, pending } = sumBoxUnitsForSecondaryChecking(boxes);
  const sc = flow.floorQuantities?.secondaryChecking || {};
  const classified =
    Math.max(0, Number(sc.m1Quantity) || 0) +
    Math.max(0, Number(sc.m2Quantity) || 0) +
    Math.max(0, Number(sc.m3Quantity) || 0) +
    Math.max(0, Number(sc.vm4Quantity) || 0);

  flow.plannedQuantity = planned;
  sc.pendingFromBoxes = pending;
  sc.received = received;
  sc.remaining = Math.max(0, received - classified);
  flow.floorQuantities.secondaryChecking = sc;
  await flow.save();
  return flow;
}
