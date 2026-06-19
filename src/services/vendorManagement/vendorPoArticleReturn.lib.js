import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { computeDerivedForFloor } from './vendorProductionFlowFloorPatch.js';

/**
 * @param {*} value
 * @returns {number}
 */
const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Verified secondary-checking qty (M1+M2+M3+VM4) available for return.
 * @param {Object} sc - secondaryChecking floor object
 * @returns {{ m1: number, m2: number, m3: number, vm4: number, verifiedAvailable: number }}
 */
export const getVerifiedBreakdown = (sc = {}) => {
  const m1 = toNumber(sc.m1Quantity);
  const m2 = toNumber(sc.m2Quantity);
  const m3 = toNumber(sc.m3Quantity);
  const vm4 = toNumber(sc.vm4Quantity ?? sc.m4Quantity);
  return {
    m1,
    m2,
    m3,
    vm4,
    verifiedAvailable: m1 + m2 + m3 + vm4,
  };
};

/**
 * Sum pending article qty lines for a flow, optionally excluding one flow's own line when upserting.
 * @param {Array<{ vendorProductionFlowId: *, quantity: number }>} lines
 * @param {string} flowId
 * @param {boolean} [excludeFlowId=false]
 * @returns {number}
 */
export const sumPendingArticleQtyForFlow = (lines, flowId, excludeFlowId = false) => {
  const target = String(flowId || '');
  return (lines || []).reduce((sum, row) => {
    if (excludeFlowId && String(row.vendorProductionFlowId) === target) return sum;
    if (String(row.vendorProductionFlowId) !== target) return sum;
    return sum + toNumber(row.quantity);
  }, 0);
};

/**
 * Sum all pending article qty for a flow in session (for validation when upserting same flow).
 * @param {Array<{ vendorProductionFlowId: *, quantity: number }>} lines
 * @param {string} flowId
 * @returns {number}
 */
export const pendingArticleQtyOnFlow = (lines, flowId) =>
  (lines || [])
    .filter((row) => String(row.vendorProductionFlowId) === String(flowId))
    .reduce((sum, row) => sum + toNumber(row.quantity), 0);

/**
 * Deduct return quantity from SC buckets in M4 → M3 → M2 → M1 order.
 * Mutates a copy-friendly sc object; returns updated buckets.
 * @param {Object} sc - secondaryChecking floor (mutable plain object)
 * @param {number} qty
 * @returns {Object} updated sc with derived fields
 */
export const deductVerifiedQtyFromSc = (sc, qty) => {
  let remaining = Math.round(toNumber(qty));
  if (remaining <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Return quantity must be positive');
  }

  const buckets = [
    ['vm4Quantity', toNumber(sc.vm4Quantity ?? sc.m4Quantity)],
    ['m3Quantity', toNumber(sc.m3Quantity)],
    ['m2Quantity', toNumber(sc.m2Quantity)],
    ['m1Quantity', toNumber(sc.m1Quantity)],
  ];

  const total = buckets.reduce((s, [, v]) => s + v, 0);
  if (remaining > total) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Return qty ${remaining} exceeds verified available (${total}) on this article`
    );
  }

  const next = { ...sc };
  for (const [key, available] of buckets) {
    if (remaining <= 0) break;
    const take = Math.min(available, remaining);
    next[key] = available - take;
    remaining -= take;
  }

  const derived = computeDerivedForFloor('secondaryChecking', {
    ...next,
    received: toNumber(next.received),
    m1Quantity: toNumber(next.m1Quantity),
    m2Quantity: toNumber(next.m2Quantity),
    m3Quantity: toNumber(next.m3Quantity),
    vm4Quantity: toNumber(next.vm4Quantity ?? next.m4Quantity),
  });

  return { ...next, ...derived };
};

/**
 * Build article candidate row from a populated production flow.
 * @param {Object} flow
 * @returns {Object|null}
 */
export const buildArticleCandidateFromFlow = (flow) => {
  if (!flow) return null;
  const sc = flow.floorQuantities?.secondaryChecking || {};
  const breakdown = getVerifiedBreakdown(sc);
  if (breakdown.verifiedAvailable <= 0) return null;

  const product = flow.product && typeof flow.product === 'object' ? flow.product : {};
  return {
    flowId: String(flow._id),
    referenceCode: flow.referenceCode || '',
    productName: product.name || '',
    vendorCode: product.vendorCode || '',
    productId: product._id || flow.product || null,
    verifiedAvailable: breakdown.verifiedAvailable,
    /**
     * `m4` mirrors the VM4 (vendor-return) bucket so the PO Return UI — which reads
     * `breakdown.m4` — surfaces the VM4 qty entered during Secondary Checking. `vm4`
     * is kept as the canonical key.
     */
    breakdown: {
      m1: breakdown.m1,
      m2: breakdown.m2,
      m3: breakdown.m3,
      vm4: breakdown.vm4,
      m4: breakdown.vm4,
    },
  };
};
