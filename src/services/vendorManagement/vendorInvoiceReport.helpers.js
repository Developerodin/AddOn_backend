/**
 * Helpers for the vendor invoice reconciliation report (one row per received lot).
 */

/**
 * Escape a string for use in a RegExp.
 * @param {string} value
 * @returns {string}
 */
export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Coerce a value to a finite number, else 0.
 * @param {*} value
 * @returns {number}
 */
export const toNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Normalize a Mongo id / populated ref to a string.
 * @param {*} value
 * @returns {string}
 */
export const idStr = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value._id) return String(value._id);
    if (value.id) return String(value.id);
  }
  return String(value);
};

/**
 * Invoice qty for a received lot: `totalUnits` when set, else sum of line receivedQuantity.
 * @param {Object} lot
 * @returns {number}
 */
export const lotInvoiceQty = (lot) => {
  if (lot?.totalUnits != null && lot.totalUnits !== '') {
    const n = Number(lot.totalUnits);
    if (Number.isFinite(n)) return n;
  }
  return (lot?.poItems || []).reduce((sum, item) => sum + toNum(item.receivedQuantity), 0);
};

/**
 * First pack-list dispatch date on a PO, if any.
 * @param {Object} po
 * @returns {Date|null}
 */
export const firstPackDispatchDate = (po) => {
  for (const pack of po?.packListDetails || []) {
    if (pack?.dispatchDate) return pack.dispatchDate;
  }
  return null;
};

/**
 * M1 + M2 remaining on a checking floor (qty sitting, not yet transferred).
 * @param {Object} [floor]
 * @returns {number}
 */
export const m1m2Remaining = (floor) => {
  if (!floor) return 0;
  const m1 = Math.max(0, toNum(floor.m1Quantity) - toNum(floor.m1Transferred));
  const m2 = Math.max(0, toNum(floor.m2Quantity) - toNum(floor.m2Transferred));
  return m1 + m2;
};

/**
 * PR column: M1 + M2 remaining on secondary checking + final checking.
 * @param {Object} flow
 * @returns {number}
 */
export const prRemainingFromFlow = (flow) => {
  const fq = flow?.floorQuantities || {};
  return m1m2Remaining(fq.secondaryChecking) + m1m2Remaining(fq.finalChecking);
};

/**
 * Map key for flows belonging to a PO lot (invoice).
 * @param {string} poId
 * @param {string} referenceCode
 * @returns {string}
 */
export const flowLotKey = (poId, referenceCode) =>
  `${poId}::${String(referenceCode || '').trim().toLowerCase()}`;

/**
 * Map key for STN qty by PO number + invoice/lot number.
 * @param {string} vpoNumber
 * @param {string} invoiceNumber
 * @returns {string}
 */
export const stnLineKey = (vpoNumber, invoiceNumber) =>
  `${String(vpoNumber || '').trim().toLowerCase()}::${String(invoiceNumber || '').trim().toLowerCase()}`;

/**
 * Build Mongo filter for POs that have at least one received lot.
 * @param {{ search?: string, from?: Date|string, to?: Date|string }} filter
 * @returns {Object}
 */
export const buildPoMongoFilter = (filter = {}) => {
  const mongo = {
    'receivedLotDetails.0': { $exists: true },
  };

  if (filter.from || filter.to) {
    mongo.createDate = {};
    if (filter.from) {
      const start = new Date(filter.from);
      if (!Number.isNaN(start.getTime())) mongo.createDate.$gte = start;
    }
    if (filter.to) {
      const end = new Date(filter.to);
      if (!Number.isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        mongo.createDate.$lte = end;
      }
    }
    if (!mongo.createDate.$gte && !mongo.createDate.$lte) {
      delete mongo.createDate;
    }
  }

  const search = String(filter.search || '').trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    mongo.$or = [{ vendorName: rx }, { vpoNumber: rx }, { 'receivedLotDetails.lotNumber': rx }];
  }

  return mongo;
};

/**
 * Whether the PO vendor name / VPO number matches the search (lot matching is separate).
 * @param {Object} po
 * @param {string} searchLower
 * @returns {boolean}
 */
export const poMatchesSearchWithoutLot = (po, searchLower) => {
  if (!searchLower) return true;
  return (
    String(po.vendorName || '')
      .toLowerCase()
      .includes(searchLower) ||
    String(po.vpoNumber || '')
      .toLowerCase()
      .includes(searchLower)
  );
};

/**
 * Whether a lot number matches the search string.
 * @param {Object} lot
 * @param {string} searchLower
 * @returns {boolean}
 */
export const lotMatchesSearch = (lot, searchLower) => {
  if (!searchLower) return true;
  return String(lot.lotNumber || '')
    .toLowerCase()
    .includes(searchLower);
};
