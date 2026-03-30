/**
 * Warehouse inventory API — response shapes for frontend / mobile clients.
 *
 * @typedef {Object} WarehouseInventoryLogDTO
 * @property {string} id
 * @property {string} [warehouseInventoryId]
 * @property {string} [styleCodeId]
 * @property {string} [styleCode]
 * @property {string} action
 * @property {string} message
 * @property {number} [quantityDelta]
 * @property {number} [blockedDelta]
 * @property {number} [totalQuantityAfter]
 * @property {number} [blockedQuantityAfter]
 * @property {number} [availableQuantityAfter]
 * @property {string|null} [userId]
 * @property {unknown} [meta]
 * @property {string} [createdAt]
 *
 * @typedef {Object} WarehouseInventoryProductDTO
 * @property {string} id
 * @property {string} name
 * @property {string} [factoryCode]
 * @property {string} [softwareCode]
 * @property {string} [internalCode]
 * @property {string} [knittingCode]
 *
 * @typedef {Object} WarehouseInventoryStyleMasterDTO
 * @property {string} id
 * @property {string} styleCode
 * @property {string} eanCode
 * @property {number} mrp
 * @property {string} [brand]
 * @property {string} [pack]
 * @property {string} [status]
 *
 * @typedef {Object} WarehouseInventoryDTO
 * @property {string} id
 * @property {WarehouseInventoryProductDTO|null} product
 * @property {WarehouseInventoryStyleMasterDTO|null} styleCodeMaster
 * @property {string} styleCode
 * @property {Record<string, unknown>|null} itemData
 * @property {Record<string, unknown>|null} styleCodeData
 * @property {{ total: number, blocked: number, available: number }} quantities
 * @property {{ total: number }} [logsSummary] — use GET .../logs for full history (paginated)
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 */

const idOf = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if (v.id != null) return String(v.id);
    if (v._id != null) return v._id.toString();
  }
  return String(v);
};

/**
 * @param {unknown} ref
 * @param {string[]} keys
 * @returns {Record<string, unknown>|null}
 */
function shapeRef(ref, keys) {
  if (ref == null) return null;
  if (typeof ref === 'string') {
    return { id: ref };
  }
  if (typeof ref !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (ref);
  const out = { id: idOf(o) };
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined) {
      out[k] = o[k];
    }
  }
  return out;
}

/**
 * @param {unknown} entry
 * @returns {Record<string, unknown>}
 */
function shapeLog(entry) {
  if (!entry || typeof entry !== 'object') return {};
  const o = /** @type {Record<string, unknown>} */ (entry);
  return {
    id: idOf(o),
    action: o.action != null ? String(o.action) : '',
    message: o.message != null ? String(o.message) : '',
    ...(o.quantityDelta !== undefined ? { quantityDelta: o.quantityDelta } : {}),
    ...(o.blockedDelta !== undefined ? { blockedDelta: o.blockedDelta } : {}),
    ...(o.totalQuantityAfter !== undefined ? { totalQuantityAfter: o.totalQuantityAfter } : {}),
    ...(o.blockedQuantityAfter !== undefined ? { blockedQuantityAfter: o.blockedQuantityAfter } : {}),
    ...(o.availableQuantityAfter !== undefined ? { availableQuantityAfter: o.availableQuantityAfter } : {}),
    ...(o.userId != null ? { userId: idOf(o.userId) } : {}),
    ...(o.meta !== undefined ? { meta: o.meta } : {}),
    ...(o.createdAt ? { createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt) } : {}),
  };
}

/**
 * One log row from `warehouse_inventory_logs` (GET .../warehouse-inventory/:id/logs).
 * @param {unknown} raw
 * @returns {WarehouseInventoryLogDTO|null}
 */
export function serializeWarehouseInventoryLog(raw) {
  if (raw == null) return null;
  const d = typeof raw.toJSON === 'function' ? raw.toJSON() : raw;
  if (!d || typeof d !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (d);
  return {
    ...shapeLog(o),
    ...(o.warehouseInventoryId != null ? { warehouseInventoryId: idOf(o.warehouseInventoryId) } : {}),
    ...(o.styleCodeId != null ? { styleCodeId: idOf(o.styleCodeId) } : {}),
    ...(o.styleCode != null && String(o.styleCode) !== '' ? { styleCode: String(o.styleCode) } : {}),
  };
}

/**
 * @param {{ results: unknown[]; page: number; limit: number; totalPages: number; totalResults: number }} pageResult
 */
export function serializeWarehouseInventoryLogPage(pageResult) {
  if (!pageResult || typeof pageResult !== 'object') return pageResult;
  const r = /** @type {Record<string, unknown>} */ (pageResult);
  const results = Array.isArray(r.results) ? r.results.map((row) => serializeWarehouseInventoryLog(row)) : [];
  return {
    results,
    page: r.page,
    limit: r.limit,
    totalPages: r.totalPages,
    totalResults: r.totalResults,
  };
}

/**
 * @param {unknown} raw — mongoose doc (with toJSON) or plain lean object
 * @param {{ logCount?: number }} [options]
 * @returns {WarehouseInventoryDTO|null}
 */
export function serializeWarehouseInventory(raw, options = {}) {
  if (raw == null) return null;
  const doc = typeof raw.toJSON === 'function' ? raw.toJSON() : raw;
  if (!doc || typeof doc !== 'object') return null;

  const d = /** @type {Record<string, unknown>} */ (doc);
  const total = Number(d.totalQuantity) || 0;
  const blocked = Number(d.blockedQuantity) || 0;
  const availNum = Number(d.availableQuantity);
  const available = Number.isFinite(availNum) ? availNum : Math.max(0, total - blocked);

  const product = shapeRef(d.itemId, ['name', 'factoryCode', 'softwareCode', 'internalCode', 'knittingCode']);
  const styleCodeMaster = shapeRef(d.styleCodeId, ['styleCode', 'eanCode', 'mrp', 'brand', 'pack', 'status']);

  const out = {
    id: idOf(d),
    product,
    styleCodeMaster,
    styleCode: d.styleCode != null ? String(d.styleCode) : '',
    itemData: d.itemData !== undefined ? d.itemData : null,
    styleCodeData: d.styleCodeData !== undefined ? d.styleCodeData : null,
    quantities: {
      total,
      blocked,
      available,
    },
    ...(typeof options.logCount === 'number' ? { logsSummary: { total: options.logCount } } : {}),
    ...(d.createdAt
      ? {
          createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
        }
      : {}),
    ...(d.updatedAt
      ? {
          updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : String(d.updatedAt),
        }
      : {}),
  };

  return out;
}

/**
 * Paginated list payload (inventory rows without per-row log counts — use logs endpoint per row).
 *
 * @param {{ results: unknown[]; page: number; limit: number; totalPages: number; totalResults: number }} pageResult
 */
export function serializeWarehouseInventoryPage(pageResult) {
  if (!pageResult || typeof pageResult !== 'object') return pageResult;
  const r = /** @type {Record<string, unknown>} */ (pageResult);
  const results = Array.isArray(r.results) ? r.results.map((row) => serializeWarehouseInventory(row)) : [];
  return {
    results,
    page: r.page,
    limit: r.limit,
    totalPages: r.totalPages,
    totalResults: r.totalResults,
  };
}
