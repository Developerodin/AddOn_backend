/**
 * Fingerprints for the confirmed Sep 2026 yarn receipt corrections.
 * Shared so the GRN revision and the box updates abort on the same rules.
 */
export const REJECTED_PO = 'PO-2026-1287';
export const REJECTED_LOT = '10730-19092026';
export const REJECTED_YARN = '30s-Light Grey Melange-Light Grey Melange-Cotton/Cotton Birla Modal Melange';
export const REJECTED_BOX_COUNT = 13;
export const REJECTED_NET_KG = 650;

export const BEIGE_PO = 'PO-2026-1291';
export const BEIGE_LOT = 'EW86228-21092026';
export const BEIGE_GRN_BASE = 'GRN-2026-0263';
export const BEIGE_GRN_KEEP = 'GRN-2026-0268';
export const PHANTOM_NET = 22.76;
export const PHANTOM_GROSS = 27.42;
export const KEEP_NET = 89.68;
export const KEEP_BOXES = 4;

export const NAVY_PO = 'PO-2026-1268';
export const NAVY_LOT = 'MU2607754-23092026';
export const NAVY_ORPHAN_BOX_ID = 'BOX-PO-2026-1268-MU2607754-23092026-1790153529730-3';
export const NAVY_REPLACEMENT_LOT = 'MU2609133-230920261';
export const NAVY_NET = 14.4;
export const NAVY_CONES = 17;

export const NOT_RETURNED = { $or: [{ returnedToVendorAt: { $exists: false } }, { returnedToVendorAt: null }] };


/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} [eps]
 * @returns {boolean}
 */
export function nearlyEqual(actual, expected, eps = 0.02) {
  return Math.abs(Number(actual) - expected) <= eps;
}

/**
 * @param {string|null|undefined} location
 * @returns {boolean}
 */
export function hasStorage(location) {
  return Boolean(location && String(location).trim());
}

/**
 * Duplicate 1-bag line that was reprinted onto GRN-2026-0268.
 * @param {Object} lot
 * @returns {boolean}
 */
export function isPhantomBagLine(lot) {
  return (
    lot?.lotNumber === BEIGE_LOT &&
    Number(lot.numberOfBoxes) === 1 &&
    nearlyEqual(lot.netWeight, PHANTOM_NET) &&
    nearlyEqual(lot.totalWeight, PHANTOM_GROSS) &&
    !lot.voided
  );
}

/**
 * The 4 bags that were actually received on GRN 263.
 * @param {Object} lot
 * @returns {boolean}
 */
export function isKeepBagLine(lot) {
  return (
    lot?.lotNumber === BEIGE_LOT &&
    Number(lot.numberOfBoxes) === KEEP_BOXES &&
    nearlyEqual(lot.netWeight, KEEP_NET, 0.05) &&
    !lot.voided
  );
}

/**
 * Mongoose 5 reports `nModified` / `n`. Newer drivers report `modifiedCount` / `deletedCount`.
 * @param {{ modifiedCount?: number, nModified?: number, deletedCount?: number, n?: number }} res
 * @returns {number}
 */
export function writeCount(res) {
  return Number(res?.modifiedCount ?? res?.nModified ?? res?.deletedCount ?? res?.n ?? 0);
}

/**
 * @param {Object} grn
 * @returns {boolean}
 */
export function grnAlreadyCorrect(grn) {
  const lots = grn?.lots || [];
  return (
    grn?.status === 'active' &&
    lots.length === 1 &&
    isKeepBagLine(lots[0]) &&
    !lots.some(isPhantomBagLine) &&
    nearlyEqual(grn?.totals?.totalQty, KEEP_NET, 0.05)
  );
}
