import { rowsMatchByBrand, brandKey } from './brandQuantity.util.js';
import DispatchStockTransferNote, { DispatchStnStatus } from '../models/production/dispatchStockTransferNote.model.js';

/**
 * How much of each previous-floor `transferredData` row is already consumed by
 * the receiving floor's `receivedData`, matching by brand (legacy styleCode rows included).
 *
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} dispatchTransferredData
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} warehouseReceivedData
 * @returns {number[]} consumed amount per dispatch row index
 */
export const computeConsumedPerDispatchRow = (dispatchTransferredData, warehouseReceivedData) => {
  const prevTransferredData = Array.isArray(dispatchTransferredData) ? dispatchTransferredData : [];
  const consumedPerEntry = new Array(prevTransferredData.length).fill(0);

  for (const rd of warehouseReceivedData || []) {
    const rdBrand = brandKey(rd?.brand);
    let rdRemaining = rd.transferred || 0;
    if (rdRemaining <= 0 || !rdBrand) continue;
    for (let j = 0; j < prevTransferredData.length; j += 1) {
      if (rdRemaining <= 0) break;
      const td = prevTransferredData[j];
      if (rowsMatchByBrand(td, rd)) {
        const available = (td.transferred || 0) - consumedPerEntry[j];
        const take = Math.min(available, rdRemaining);
        if (take > 0) {
          consumedPerEntry[j] += take;
          rdRemaining -= take;
        }
      }
    }
  }

  return consumedPerEntry;
};

/**
 * Dispatch lines not yet matched to warehouse inward (container accept), same rules as server netting.
 *
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} dispatchTransferredData
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} warehouseReceivedData
 * @returns {Array<{ transferred: number, styleCode: string, brand: string }>}
 */
export const getPendingDispatchTransferredData = (dispatchTransferredData, warehouseReceivedData) => {
  const prevTransferredData = Array.isArray(dispatchTransferredData) ? dispatchTransferredData : [];
  const consumed = computeConsumedPerDispatchRow(prevTransferredData, warehouseReceivedData);
  const out = [];
  for (let j = 0; j < prevTransferredData.length; j += 1) {
    const td = prevTransferredData[j];
    const pending = Math.max(0, (td.transferred || 0) - consumed[j]);
    if (pending > 0) {
      out.push({
        transferred: pending,
        styleCode: '',
        brand: td.brand || '',
      });
    }
  }
  return out;
};

/**
 * Sum of pending qty from {@link getPendingDispatchTransferredData}.
 */
export const sumPendingDispatchTransferred = (dispatchTransferredData, warehouseReceivedData) => {
  const rows = getPendingDispatchTransferredData(dispatchTransferredData, warehouseReceivedData);
  return rows.reduce((s, r) => s + (r.transferred || 0), 0);
};

/**
 * Build lookup key for article + brand STN allocation maps.
 * @param {string|import('mongoose').Types.ObjectId} articleId
 * @param {string|null|undefined} brand
 * @returns {string}
 */
export const stnAllocationKey = (articleId, brand) => {
  return `${String(articleId)}::${brandKey(brand)}`;
};

/**
 * Aggregate active STN allocations into a map keyed by articleId + brand.
 * @param {Array<{ articleId?: unknown, brand?: string, quantity?: number }>} allocationRows
 * @returns {Map<string, number>}
 */
export const buildStnAllocationMap = (allocationRows) => {
  const map = new Map();
  for (const row of allocationRows || []) {
    const qty = Number(row?.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const key = stnAllocationKey(row.articleId, row.brand);
    map.set(key, (map.get(key) || 0) + qty);
  }
  return map;
};

/**
 * Subtract STN allocations from warehouse-pending dispatch rows (per brand).
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} pendingRows
 * @param {string|import('mongoose').Types.ObjectId} articleId
 * @param {Map<string, number>} stnAllocMap
 * @returns {Array<{ transferred: number, styleCode: string, brand: string }>}
 */
export const subtractStnAllocationsFromPending = (pendingRows, articleId, stnAllocMap) => {
  const out = [];
  for (const row of pendingRows || []) {
    const key = stnAllocationKey(articleId, row.brand);
    const allocated = stnAllocMap.get(key) || 0;
    const pending = Math.max(0, (row.transferred || 0) - allocated);
    if (pending > 0) {
      out.push({
        transferred: pending,
        styleCode: '',
        brand: row.brand || '',
      });
    }
  }
  return out;
};

/**
 * Dispatch lines pending warehouse inward, minus active STN allocations.
 *
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} dispatchTransferredData
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} warehouseReceivedData
 * @param {string|import('mongoose').Types.ObjectId} articleId
 * @param {Map<string, number>} [stnAllocMap]
 * @returns {Array<{ transferred: number, styleCode: string, brand: string }>}
 */
export const getPrintEligibleDispatchTransferredData = (
  dispatchTransferredData,
  warehouseReceivedData,
  articleId,
  stnAllocMap = new Map()
) => {
  const warehousePending = getPendingDispatchTransferredData(dispatchTransferredData, warehouseReceivedData);
  return subtractStnAllocationsFromPending(warehousePending, articleId, stnAllocMap);
};

/**
 * Sum of print-eligible pending qty (warehouse + STN netting).
 */
export const sumPrintEligibleDispatchTransferred = (
  dispatchTransferredData,
  warehouseReceivedData,
  articleId,
  stnAllocMap = new Map()
) => {
  const rows = getPrintEligibleDispatchTransferredData(
    dispatchTransferredData,
    warehouseReceivedData,
    articleId,
    stnAllocMap
  );
  return rows.reduce((s, r) => s + (r.transferred || 0), 0);
};

/**
 * Load aggregated active STN allocations keyed by articleId + brand.
 * @returns {Promise<Map<string, number>>}
 */
export const loadActiveStnAllocationMap = async () => {
  const docs = await DispatchStockTransferNote.find({ status: DispatchStnStatus.ACTIVE })
    .select('allocations')
    .lean();
  const rows = docs.flatMap((doc) => doc.allocations || []);
  return buildStnAllocationMap(rows);
};
