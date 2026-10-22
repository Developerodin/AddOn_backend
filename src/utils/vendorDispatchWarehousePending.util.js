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
 * Subtract open vendor STN locks from pending rows.
 * One pool per flow + brand, shared across every transferredData row.
 * Warehouse handoff releases locks in {@link consumeActiveVendorStnAllocations}.
 * Past handoff qty is not subtracted here, or the next print repeats the same rows.
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
  const allocLeft = new Map();
  const out = [];
  for (const row of pendingRows || []) {
    const key = vendorStnAllocationKey(vendorProductionFlowId, row.brand);
    if (!allocLeft.has(key)) {
      allocLeft.set(key, Math.max(0, Number(stnAllocMap.get(key) || 0)));
    }
    const rowQty = Math.max(0, Number(row.transferred || 0));
    const left = allocLeft.get(key) || 0;
    const take = Math.min(rowQty, left);
    allocLeft.set(key, left - take);
    const pending = rowQty - take;
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
  return subtractVendorStnAllocationsFromPending(warehousePending, vendorProductionFlowId, stnAllocMap);
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

/**
 * Copy one vendor allocation subdocument to a plain object.
 * @param {Object} alloc
 * @returns {{ vendorProductionFlowId: unknown, brand: string, quantity: number }}
 */
const plainVendorAllocation = (alloc) => {
  const plain = typeof alloc?.toObject === 'function' ? alloc.toObject() : { ...alloc };
  return {
    vendorProductionFlowId: plain.vendorProductionFlowId,
    brand: plain.brand || '',
    quantity: Number(plain.quantity) || 0,
  };
};

/**
 * Release active vendor-note locks for qty the warehouse just accepted.
 * Oldest note first. Extra accept qty does not create a credit.
 * A blank brand consumes the lock only when that flow has a single locked brand.
 * @param {{ vendorProductionFlowId: unknown, brand?: string, quantity: number }} params
 * @returns {Promise<{ consumed: number }>}
 */
export const consumeActiveVendorStnAllocations = async ({
  vendorProductionFlowId,
  brand,
  quantity,
} = {}) => {
  let remaining = Number(quantity);
  if (!vendorProductionFlowId || !Number.isFinite(remaining) || remaining <= 0) {
    return { consumed: 0 };
  }

  const notes = await VendorDispatchStockTransferNote.find({
    status: VendorDispatchStnStatus.ACTIVE,
    'allocations.vendorProductionFlowId': vendorProductionFlowId,
  }).sort({ stnDate: 1, createdAt: 1 });

  let key = brandKey(brand);
  if (!key) {
    const brands = new Set();
    for (const note of notes) {
      for (const alloc of note.allocations || []) {
        if (String(alloc.vendorProductionFlowId) !== String(vendorProductionFlowId)) continue;
        const allocBrand = brandKey(alloc.brand);
        if (allocBrand) brands.add(allocBrand);
      }
    }
    if (brands.size !== 1) return { consumed: 0 };
    key = [...brands][0];
  }

  let consumed = 0;
  for (const note of notes) {
    if (remaining <= 1e-9) break;
    let changed = false;
    const next = [];
    for (const alloc of note.allocations || []) {
      const sameFlow = String(alloc.vendorProductionFlowId) === String(vendorProductionFlowId);
      const sameBrand = brandKey(alloc.brand) === key;
      if (!sameFlow || !sameBrand || remaining <= 1e-9) {
        next.push(plainVendorAllocation(alloc));
        continue;
      }
      const qty = Number(alloc.quantity) || 0;
      const take = Math.min(qty, remaining);
      remaining -= take;
      consumed += take;
      changed = true;
      const left = qty - take;
      if (left > 1e-9) {
        next.push({ ...plainVendorAllocation(alloc), quantity: left });
      }
    }
    if (!changed) continue;
    note.allocations = next;
    note.markModified('allocations');
    try {
      await note.save();
    } catch (err) {
      throw new Error(
        `Failed to release vendor transfer-note lock on ${note.stnSerial || note._id}: ${err?.message || err}`
      );
    }
  }

  return { consumed };
};
