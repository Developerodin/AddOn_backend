import { vendorProductionFlowSequence } from '../models/vendorManagement/vendorProductionFlow.model.js';
import { splitIntegerByWeights } from './vendorStyleQuantity.util.js';

const QC_FLOOR_KEYS = new Set(['secondaryChecking', 'finalChecking']);

/**
 * Floors to update when merging vendor M2 → M1 (source through dispatch).
 * @param {string} sourceFloorKey - secondaryChecking | finalChecking
 * @returns {string[]}
 */
export function getVendorCascadeFloorsForM2Merge(sourceFloorKey) {
  const sourceIdx = vendorProductionFlowSequence.indexOf(sourceFloorKey);
  if (sourceIdx === -1) {
    throw new Error(`Source floor "${sourceFloorKey}" is not in the vendor production sequence`);
  }
  const dispatchIdx = vendorProductionFlowSequence.indexOf('dispatch');
  const endIdx = dispatchIdx === -1 ? vendorProductionFlowSequence.length - 1 : dispatchIdx;
  return vendorProductionFlowSequence.slice(sourceIdx, endIdx + 1);
}

/**
 * Ensure floorQuantities bucket exists for a vendor floor key.
 * @param {Object} flow
 * @param {string} floorKey
 * @returns {Object}
 */
export function ensureVendorFloorData(flow, floorKey) {
  if (!flow.floorQuantities) {
    flow.floorQuantities = {};
  }
  if (!flow.floorQuantities[floorKey]) {
    flow.floorQuantities[floorKey] = {
      received: 0,
      completed: 0,
      remaining: 0,
      transferred: 0,
      m1Quantity: 0,
      m2Quantity: 0,
      m3Quantity: 0,
      m4Quantity: 0,
      vm4Quantity: 0,
      m1Transferred: 0,
      m1Remaining: 0,
      m2Transferred: 0,
      m2Remaining: 0,
      transferredData: [],
    };
  }
  return flow.floorQuantities[floorKey];
}

/**
 * Recalculate QC floor remaining fields after quantity change.
 * @param {Object} fd - floor data
 * @param {string} floorKey - secondaryChecking | finalChecking
 */
export function recalcVendorQcFloorRemaining(fd, floorKey) {
  const m1T = fd.m1Transferred || 0;
  const m2 = fd.m2Quantity || 0;
  const m3 = fd.m3Quantity || 0;
  const m4 =
    floorKey === 'secondaryChecking'
      ? fd.vm4Quantity ?? fd.m4Quantity ?? 0
      : fd.m4Quantity || 0;

  fd.m1Remaining = Math.max(0, (fd.m1Quantity || 0) - m1T);
  fd.m2Remaining = Math.max(0, m2 - (fd.m2Transferred || 0));

  if (floorKey === 'finalChecking') {
    fd.remaining = Math.max(0, (fd.received || 0) - (fd.transferred || 0));
  } else {
    fd.remaining = Math.max(0, (fd.received || 0) - m1T - m2 - m3 - m4);
  }
}

/**
 * Whether a vendor QC floor bucket already has production activity.
 * @param {Object} fd - floor data
 * @returns {boolean}
 */
export function vendorQcFloorHasActivity(fd) {
  return (
    (fd.received || 0) > 0 ||
    (fd.completed || 0) > 0 ||
    (fd.transferred || 0) > 0 ||
    (fd.m1Quantity || 0) > 0 ||
    (fd.m1Transferred || 0) > 0
  );
}

/**
 * Bump M1 and transfer counters on a vendor QC floor after M2→M1 merge.
 * @param {Object} fd - floor data
 * @param {number} qty - merge quantity
 */
export function bumpVendorQcM1AndTransfer(fd, qty) {
  fd.m1Quantity = (fd.m1Quantity || 0) + qty;
  fd.m1Transferred = (fd.m1Transferred || 0) + qty;
  fd.transferred = (fd.transferred || 0) + qty;
}

/**
 * Bump finalChecking.transferredData proportionally (or first row) after M2→M1 cascade.
 * @param {Object} flow - Mongoose vendor production flow document
 * @param {number} qty - merge quantity
 */
export function bumpVendorFinalCheckingTransferredDataForM2Merge(flow, qty) {
  const fc = ensureVendorFloorData(flow, 'finalChecking');
  const rows = Array.isArray(fc.transferredData) ? fc.transferredData : [];
  if (!rows.length || qty <= 0) return;

  const weights = rows.map((r) => Math.max(0, Number(r?.transferred ?? 0)));
  const hasWeight = weights.some((w) => w > 0);
  const increments = hasWeight ? splitIntegerByWeights(qty, weights) : [qty, ...Array(rows.length - 1).fill(0)];

  fc.transferredData = rows.map((row, idx) => ({
    styleCode: String(row?.styleCode ?? ''),
    brand: String(row?.brand ?? ''),
    transferred: Math.max(0, Number(row?.transferred ?? 0)) + (increments[idx] || 0),
  }));

  const lineSum = fc.transferredData.reduce((s, r) => s + (r.transferred || 0), 0);
  fc.completed = lineSum;
  fc.transferred = Math.max(fc.transferred || 0, lineSum);
  flow.markModified('floorQuantities.finalChecking');
}

/**
 * Apply cascade M2→M1 merge increment on one floor in the vendor pipeline.
 * @param {Object} flow - Mongoose vendor production flow document
 * @param {string} floorKey - floor key in vendor sequence
 * @param {number} qty - Merge quantity
 * @param {string} sourceFloorKey - Original M2 source QC floor key
 */
export function applyVendorCascadeMergeIncrement(flow, floorKey, qty, sourceFloorKey) {
  const fd = ensureVendorFloorData(flow, floorKey);
  const isSource = floorKey === sourceFloorKey;
  const isQc = QC_FLOOR_KEYS.has(floorKey);

  if (isQc) {
    if (isSource || vendorQcFloorHasActivity(fd)) {
      if (isSource) {
        fd.m2Quantity = Math.max(0, (fd.m2Quantity || 0) - qty);
        if (floorKey === 'finalChecking') {
          fd.completed = (fd.completed || 0) + qty;
        }
      }
      bumpVendorQcM1AndTransfer(fd, qty);
      if (floorKey === 'secondaryChecking') {
        fd.completed = fd.m1Quantity || 0;
      }
      recalcVendorQcFloorRemaining(fd, floorKey);
      flow.markModified(`floorQuantities.${floorKey}`);
    }
    return;
  }

  if (floorKey === 'dispatch') {
    fd.received = (fd.received || 0) + qty;
    fd.remaining = Math.max(0, (fd.received || 0) - (fd.transferred || 0));
    flow.markModified(`floorQuantities.${floorKey}`);
    return;
  }

  if ((fd.received || 0) > 0 || (fd.completed || 0) > 0 || (fd.transferred || 0) > 0) {
    fd.received = (fd.received || 0) + qty;
    fd.completed = (fd.completed || 0) + qty;
    if ((fd.transferred || 0) > 0) {
      fd.transferred = (fd.transferred || 0) + qty;
    }
    fd.remaining = Math.max(0, (fd.received || 0) - (fd.transferred || 0));
    flow.markModified(`floorQuantities.${floorKey}`);
  }
}

/**
 * Whether the vendor flow has been received on dispatch floor.
 * @param {Object} flow
 * @returns {boolean}
 */
export function isVendorFlowPresentOnDispatchFloor(flow) {
  const dispatchReceived = Number(flow.floorQuantities?.dispatch?.received ?? 0);
  if (dispatchReceived > 0) return true;
  return flow.currentFloorKey === 'dispatch';
}

/**
 * M2→M1 merge is allowed only when dispatch has received qty or flow is on dispatch.
 * @param {Object} flow
 * @returns {{ eligible: boolean, reason: string|null }}
 */
export function assessVendorM2MergeEligibility(flow) {
  if (!isVendorFlowPresentOnDispatchFloor(flow)) {
    return {
      eligible: false,
      reason: 'M2 merge is only allowed after the flow has been received on Dispatch floor.',
    };
  }
  return { eligible: true, reason: null };
}
