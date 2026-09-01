import { resolveIstMonthPeriod } from '../../utils/istPeriod.util.js';

/** Hard cap on GRNs loaded for a monthly summary (flatten happens in memory). */
export const MONTHLY_SUMMARY_GRN_CAP = 5000;

/**
 * Coerces a value to a finite number, defaulting to 0.
 * @param {unknown} value
 * @returns {number}
 */
export const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Escapes a user search string for safe regex matching.
 * @param {string} value
 * @returns {string}
 */
export const escapeRegexLiteral = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Resolves the GRN document id from a lean or toJSON doc.
 * @param {Object} grn
 * @returns {string}
 */
export const resolveGrnId = (grn) => {
  if (!grn) return '';
  if (grn.id) return String(grn.id);
  if (grn._id) return String(grn._id);
  return '';
};

/**
 * Sums boxes across GRN lots, skipping voided lots.
 * @param {Array<{ numberOfBoxes?: number, voided?: boolean }>} lots
 * @returns {number}
 */
export const sumLotBoxes = (lots = []) =>
  (Array.isArray(lots) ? lots : []).reduce(
    (sum, lot) => sum + (lot?.voided ? 0 : toNumber(lot?.numberOfBoxes)),
    0
  );

/**
 * Empty monthly-summary totals bucket.
 * @returns {{ grnCount: number, lineCount: number, boxes: number, qty: number, amount: number, gst: number, grandTotal: number }}
 */
export const emptyMonthlySummaryTotals = () => ({
  grnCount: 0,
  lineCount: 0,
  boxes: 0,
  qty: 0,
  amount: 0,
  gst: 0,
  grandTotal: 0,
});

/**
 * Builds the Mongo filter for an IST calendar month of active GRNs.
 * @param {{ year?: unknown, month?: unknown, supplierName?: string }} params
 * @returns {{ filter: Object, period: ReturnType<typeof resolveIstMonthPeriod> }}
 */
export const buildMonthlySummaryFilter = ({ year, month, supplierName } = {}) => {
  const period = resolveIstMonthPeriod({ year, month });
  const filter = {
    status: 'active',
    grnDate: { $gte: period.monthStart, $lt: period.monthEndExclusive },
  };
  const trimmed = typeof supplierName === 'string' ? supplierName.trim() : '';
  if (trimmed) {
    filter['supplier.name'] = { $regex: escapeRegexLiteral(trimmed), $options: 'i' };
  }
  return { filter, period };
};

/**
 * Flattens one GRN into yarn-line summary rows. Header-level boxes/GST/grand
 * total appear only on the first line so month totals are not double-counted.
 * GRNs with no items still emit a single blank yarn row.
 * @param {Object} grn
 * @returns {Array<Object>}
 */
export const flattenGrnToSummaryRows = (grn) => {
  if (!grn) return [];
  const grnId = resolveGrnId(grn);
  const boxes = sumLotBoxes(grn.lots);
  const gst = toNumber(grn.totals?.gst);
  const grandTotal = toNumber(grn.totals?.grandTotal);
  const items = Array.isArray(grn.items) && grn.items.length > 0 ? grn.items : [{}];

  return items.map((item, index) => {
    const isFirstItemOfGrn = index === 0;
    return {
      grnId,
      grnNumber: grn.grnNumber || '',
      grnDate: grn.grnDate || null,
      poNumber: grn.poNumber || '',
      supplier: grn.supplier?.name || '',
      numberOfBoxes: isFirstItemOfGrn ? boxes : null,
      yarnName: item?.yarnName || '',
      shadeCode: item?.shadeCode || '',
      qty: toNumber(item?.quantity),
      rate: toNumber(item?.rate),
      amount: toNumber(item?.amount),
      gst: isFirstItemOfGrn ? gst : null,
      grandTotal: isFirstItemOfGrn ? grandTotal : null,
      isFirstItemOfGrn,
    };
  });
};

/**
 * Flattens a list of GRNs into yarn-line summary rows.
 * @param {Array<Object>} grns
 * @returns {Array<Object>}
 */
export const flattenGrnsToSummaryRows = (grns = []) =>
  (Array.isArray(grns) ? grns : []).flatMap(flattenGrnToSummaryRows);

/**
 * Month-true totals: qty/amount sum every line; boxes/GST/grand total sum
 * unique GRNs via the first-item-only fields.
 * @param {Array<Object>} rows
 * @returns {{ grnCount: number, lineCount: number, boxes: number, qty: number, amount: number, gst: number, grandTotal: number }}
 */
export const computeMonthlySummaryTotals = (rows = []) => {
  const totals = emptyMonthlySummaryTotals();
  const grnIds = new Set();
  rows.forEach((row) => {
    totals.lineCount += 1;
    totals.qty += toNumber(row.qty);
    totals.amount += toNumber(row.amount);
    if (row.isFirstItemOfGrn) {
      totals.boxes += toNumber(row.numberOfBoxes);
      totals.gst += toNumber(row.gst);
      totals.grandTotal += toNumber(row.grandTotal);
    }
    if (row.grnId) grnIds.add(String(row.grnId));
  });
  totals.grnCount = grnIds.size;
  return totals;
};

/**
 * Slices flattened rows for a page. Totals are not recomputed here.
 * @param {Array<Object>} rows
 * @param {number} page
 * @param {number} limit
 * @returns {{ results: Array<Object>, page: number, limit: number, totalPages: number, totalResults: number }}
 */
export const paginateMonthlySummaryRows = (rows = [], page = 1, limit = 50) => {
  const limitNum = Math.min(200, Math.max(1, toNumber(limit) || 50));
  const totalResults = rows.length;
  const totalPages = totalResults === 0 ? 0 : Math.ceil(totalResults / limitNum);
  const pageNum = Math.max(1, Math.floor(toNumber(page) || 1));
  const start = (pageNum - 1) * limitNum;
  return {
    results: rows.slice(start, start + limitNum),
    page: pageNum,
    limit: limitNum,
    totalPages,
    totalResults,
  };
};
