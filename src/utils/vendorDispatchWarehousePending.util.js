import { brandKey } from './brandQuantity.util.js';
import VendorDispatchStockTransferNote, {
  VendorDispatchStnStatus,
} from '../models/vendorManagement/vendorDispatchStockTransferNote.model.js';
import { getPendingDispatchTransferredData } from './dispatchWarehousePending.util.js';

/**
 * Build lookup key for vendor flow + brand STN allocation maps.
 * @param {string|import('mongoose').Types.ObjectId} vendorProductionFlowId
 * @param {string|null|undefined} brand
 * @returns {string}
 */
export const vendorStnAllocationKey = (vendorProductionFlowId, brand) => {
  return `${String(vendorProductionFlowId)}::${brandKey(brand)}`;
};

/**
 * Aggregate active vendor STN allocations keyed by flow id + brand.
 * @param {Array<{ vendorProductionFlowId?: unknown, brand?: string, quantity?: number }>} allocationRows
 * @returns {Map<string, number>}
 */
export const buildVendorStnAllocationMap = (allocationRows) => {
  const map = new Map();
  for (const row of allocationRows || []) {
    const qty = Number(row?.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const key = vendorStnAllocationKey(row.vendorProductionFlowId, row.brand);
    map.set(key, (map.get(key) || 0) + qty);
  }
  return map;
};

/**
 * Subtract vendor STN allocations from pending rows (per brand).
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} pendingRows
 * @param {string|import('mongoose').Types.ObjectId} vendorProductionFlowId
 * @param {Map<string, number>} stnAllocMap
 * @returns {Array<{ transferred: number, styleCode: string, brand: string }>}
 */
export const subtractVendorStnAllocationsFromPending = (
  pendingRows,
  vendorProductionFlowId,
  stnAllocMap
) => {
  const out = [];
  for (const row of pendingRows || []) {
    const key = vendorStnAllocationKey(vendorProductionFlowId, row.brand);
    const allocated = stnAllocMap.get(key) || 0;
    const pending = Math.max(0, (row.transferred || 0) - allocated);
    if (pending > 0) {
      out.push({
        transferred: pending,
        styleCode: row.styleCode || '',
        brand: row.brand || '',
      });
    }
  }
  return out;
};

/**
 * Vendor dispatch `receivedData` rows that represent warehouse inward handoff.
 * @param {Array<{ receivedStatusFromPreviousFloor?: string }>} receivedData
 * @returns {Array<Object>}
 */
export const filterVendorWarehouseHandoffReceivedData = (receivedData) => {
  return (receivedData || []).filter((rd) =>
    String(rd?.receivedStatusFromPreviousFloor || '').startsWith('warehouse:')
  );
};

/**
 * Vendor dispatch lines pending warehouse inward print, minus active STN allocations.
 *
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} dispatchTransferredData
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} warehouseHandoffReceivedData
 * @param {string|import('mongoose').Types.ObjectId} vendorProductionFlowId
 * @param {Map<string, number>} [stnAllocMap]
 * @returns {Array<{ transferred: number, styleCode: string, brand: string }>}
 */
export const getPrintEligibleVendorDispatchTransferredData = (
  dispatchTransferredData,
  warehouseHandoffReceivedData,
  vendorProductionFlowId,
  stnAllocMap = new Map()
) => {
  const warehousePending = getPendingDispatchTransferredData(
    dispatchTransferredData,
    warehouseHandoffReceivedData
  );
  return subtractVendorStnAllocationsFromPending(
    warehousePending,
    vendorProductionFlowId,
    stnAllocMap
  );
};

/**
 * Sum of print-eligible pending qty for a vendor flow.
 */
export const sumPrintEligibleVendorDispatchTransferred = (
  dispatchTransferredData,
  warehouseHandoffReceivedData,
  vendorProductionFlowId,
  stnAllocMap = new Map()
) => {
  const rows = getPrintEligibleVendorDispatchTransferredData(
    dispatchTransferredData,
    warehouseHandoffReceivedData,
    vendorProductionFlowId,
    stnAllocMap
  );
  return rows.reduce((s, r) => s + (r.transferred || 0), 0);
};

/**
 * Load aggregated active vendor STN allocations keyed by flow id + brand.
 * @returns {Promise<Map<string, number>>}
 */
export const loadActiveVendorStnAllocationMap = async () => {
  const docs = await VendorDispatchStockTransferNote.find({ status: VendorDispatchStnStatus.ACTIVE })
    .select('allocations')
    .lean();
  const rows = docs.flatMap((doc) => doc.allocations || []);
  return buildVendorStnAllocationMap(rows);
};
