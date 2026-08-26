/**
 * Pure helpers for the production Core Report (one row per factory code).
 */

/** PO statuses that must not inflate vendorwise pending / in-transit. */
export const EXCLUDED_PO_STATUSES = Object.freeze(['draft', 'goods_received', 'po_rejected']);

/**
 * Coerces a value to a finite number, defaulting to 0.
 * @param {unknown} value
 * @returns {number}
 */
export const toNumber = (value) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * True when the value looks like a 24-char ObjectId (avoids mongoose isValid false positives).
 * @param {unknown} value
 * @returns {boolean}
 */
export const isObjectIdString = (value) => /^[a-fA-F0-9]{24}$/.test(String(value ?? ''));

/**
 * Resolves a Mongo id string from a raw or populated ref.
 * BSON ObjectId.id is a 12-byte Buffer — never String(ref.id) for that case.
 * @param {unknown} ref
 * @returns {string}
 */
export const refId = (ref) => {
  if (ref == null) return '';
  if (typeof ref === 'string' || typeof ref === 'number') return String(ref);
  if (typeof ref.toHexString === 'function') return ref.toHexString();
  if (ref._bsontype === 'ObjectId' && typeof ref.toString === 'function') {
    return ref.toString();
  }
  if (typeof ref === 'object') {
    if (ref._id != null && ref._id !== ref) return refId(ref._id);
    if (typeof ref.id === 'string' && isObjectIdString(ref.id)) return ref.id;
  }
  const asString = String(ref);
  return asString === '[object Object]' ? '' : asString;
};

/**
 * Case-insensitive factory-code join key.
 * @param {unknown} value
 * @returns {string}
 */
export const factoryKey = (value) => String(value ?? '').trim().toLowerCase();

/**
 * Escapes a user search string for safe regex matching.
 * @param {string} value
 * @returns {string}
 */
export const escapeRegexLiteral = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Reads a product attribute by any of the given names (case-insensitive).
 * @param {unknown} attributes Map or plain object
 * @param {string[]} names Candidate keys (e.g. Color / color)
 * @returns {string}
 */
export const attrValue = (attributes, names) => {
  if (!attributes) return '';
  const obj =
    attributes instanceof Map ? Object.fromEntries(attributes) : /** @type {Record<string, unknown>} */ (attributes);
  if (!obj || typeof obj !== 'object') return '';
  const keys = Object.keys(obj);
  for (const name of names) {
    const found = keys.find((key) => key.toLowerCase() === name.toLowerCase());
    if (found != null && obj[found] != null && String(obj[found]).trim()) {
      return String(obj[found]).trim();
    }
  }
  return '';
};

/**
 * Collects valid StyleCode ObjectIds from a product, skipping legacy embedded junk.
 * Lean Product.styleCodes is usually raw ObjectIds — those must stringify via toHexString.
 * @param {Record<string, unknown>} product
 * @returns {string[]}
 */
export const styleIdsFromProduct = (product) => {
  const ids = [];
  for (const ref of product?.styleCodes ?? []) {
    const id = refId(ref);
    if (isObjectIdString(id)) ids.push(id);
  }
  return ids;
};

/**
 * Factory-code join key from a warehouse itemData snapshot.
 * @param {unknown} itemData
 * @returns {string}
 */
export const itemDataFactoryKey = (itemData) => {
  if (!itemData || typeof itemData !== 'object' || Array.isArray(itemData)) return '';
  const data = /** @type {Record<string, unknown>} */ (itemData);
  return factoryKey(data.factoryCode ?? data.FactoryCode ?? data.factory_code);
};

/**
 * Vendor display name from a PO header / snapshot.
 * @param {Record<string, unknown>} po
 * @returns {string}
 */
export const vendorNameOf = (po) => {
  const snapshot = po?.vendorSnapshot;
  const fromSnapshot =
    snapshot && typeof snapshot === 'object' ? String(snapshot.vendorName ?? '').trim() : '';
  return String(po?.vendorName ?? '').trim() || fromSnapshot || 'Unknown vendor';
};

/**
 * Received qty per PO line from receivedLotDetails (poItems themselves have no receivedQuantity).
 * @param {Record<string, unknown>} po
 * @returns {Map<string, number>}
 */
export const receivedByPoLine = (po) => {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const lot of po?.receivedLotDetails ?? []) {
    for (const line of lot?.poItems ?? []) {
      const id = refId(line?.poItem);
      if (!id) continue;
      map.set(id, (map.get(id) ?? 0) + toNumber(line?.receivedQuantity));
    }
  }
  return map;
};

/**
 * Empty numeric totals for Core Report (vendorPending filled by caller).
 * @returns {{
 *   sapStock: number,
 *   inwardPending: number,
 *   inTransit: number,
 *   wip: number,
 *   runningOnMachine: number,
 *   productionPlanning: number,
 *   totalInhand: number,
 *   vendorPending: Record<string, number>
 * }}
 */
export const createEmptyCoreMetrics = () => ({
  sapStock: 0,
  inwardPending: 0,
  inTransit: 0,
  wip: 0,
  runningOnMachine: 0,
  productionPlanning: 0,
  totalInhand: 0,
  vendorPending: {},
});

/**
 * SAP + inward pending + WIP. Negatives are kept so a broken residual stays visible.
 * @param {number} sapStock
 * @param {number} inwardPending
 * @param {number} wip
 * @returns {number}
 */
export const totalInhandOf = (sapStock, inwardPending, wip) =>
  toNumber(sapStock) + toNumber(inwardPending) + toNumber(wip);

/**
 * Adds one row's numeric columns into an accumulator (including vendor keys).
 * @param {ReturnType<typeof createEmptyCoreMetrics>} acc
 * @param {ReturnType<typeof createEmptyCoreMetrics>} row
 * @param {string[]} vendorColumns
 * @returns {ReturnType<typeof createEmptyCoreMetrics>}
 */
export const addCoreMetrics = (acc, row, vendorColumns) => {
  acc.sapStock += toNumber(row.sapStock);
  acc.inwardPending += toNumber(row.inwardPending);
  acc.inTransit += toNumber(row.inTransit);
  acc.wip += toNumber(row.wip);
  acc.runningOnMachine += toNumber(row.runningOnMachine);
  acc.productionPlanning += toNumber(row.productionPlanning);
  acc.totalInhand += toNumber(row.totalInhand);
  for (const vendor of vendorColumns) {
    acc.vendorPending[vendor] =
      (acc.vendorPending[vendor] ?? 0) + toNumber(row.vendorPending?.[vendor]);
  }
  return acc;
};
