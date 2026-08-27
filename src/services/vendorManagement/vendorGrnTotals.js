/**
 * Vendor GRN commercial totals: rupee discount, freight, GST split, round-off.
 * Qty totals (expected/verified/M1–M4) stay elsewhere; this file only does money.
 */

const SUPPLIER_HOME_STATES = new Set(['maharashtra', 'mh']);

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

export const QTY_TOTAL_KEYS = ['expected', 'verified', 'variance', 'm1', 'm2', 'm3', 'm4'];

/**
 * Coerce any value to a finite number, defaulting to 0.
 * @param {*} value
 * @returns {number}
 */
export const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param {string|null|undefined} value
 * @returns {string}
 */
export const trimSafe = (value) => (value == null ? '' : String(value).trim());

/**
 * Flatten GRN lots into printable line items.
 * @param {Array<Object>} lots
 * @returns {Array<Object>}
 */
export const flattenLotItems = (lots = []) => {
  const items = [];
  (lots || []).forEach((lot) => {
    (lot.items || []).forEach((item) => {
      items.push({ ...item, lotNumber: lot.lotNumber });
    });
  });
  return items;
};

/**
 * Pick operational qty totals from a totals object.
 * @param {Object} [totals={}]
 * @returns {Object}
 */
export const pickQtyTotals = (totals = {}) => {
  const out = {};
  QTY_TOTAL_KEYS.forEach((key) => {
    out[key] = toNumber(totals?.[key]);
  });
  return out;
};

/**
 * Whether two qty-total blocks match (revision trigger — ignore financial fields).
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
export const qtyTotalsEqual = (a, b) =>
  QTY_TOTAL_KEYS.every((key) => toNumber(a?.[key]) === toNumber(b?.[key]));

/**
 * Normalize persisted / PATCH adjustment inputs (rupee discount, not percent).
 * @param {Object} [adjustments={}]
 * @returns {{ discountAmount: number, freightAmount: number, freightGstPercent: number, roundOff: number|null }}
 */
export const normalizeAdjustments = (adjustments = {}) => {
  const hasRoundOff = adjustments.roundOff !== undefined && adjustments.roundOff !== null;
  return {
    discountAmount: Math.max(0, toNumber(adjustments.discountAmount)),
    freightAmount: Math.max(0, toNumber(adjustments.freightAmount)),
    freightGstPercent: Math.min(100, Math.max(0, toNumber(adjustments.freightGstPercent))),
    roundOff: hasRoundOff ? toNumber(adjustments.roundOff) : null,
  };
};

/**
 * Convert an integer rupee amount to Indian-numbering English words.
 * @param {number} num
 * @returns {string}
 */
const numberToWords = (num) => {
  const n = Math.floor(Math.abs(toNumber(num)));
  if (n === 0) return 'Zero Rupees';

  const twoDigit = (x) => {
    if (x < 20) return ONES[x];
    const t = Math.floor(x / 10);
    const o = x % 10;
    return TENS[t] + (o ? ` ${ONES[o]}` : '');
  };
  const threeDigit = (x) => {
    const h = Math.floor(x / 100);
    const r = x % 100;
    const head = h ? `${ONES[h]} Hundred${r ? ' ' : ''}` : '';
    return head + (r ? twoDigit(r) : '');
  };

  let result = '';
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n / 100000) % 100);
  const thousand = Math.floor((n / 1000) % 100);
  const hundred = n % 1000;
  if (crore) result += `${twoDigit(crore)} Crore `;
  if (lakh) result += `${twoDigit(lakh)} Lakh `;
  if (thousand) result += `${twoDigit(thousand)} Thousand `;
  if (hundred) result += threeDigit(hundred);
  return `${result.trim()} Rupees`;
};

/**
 * Build amount-in-words string from a rupee total.
 * @param {number} grandTotal
 * @returns {string}
 */
export const formatAmountInWords = (grandTotal) => {
  const rupees = Math.floor(grandTotal);
  const paise = Math.round((grandTotal - rupees) * 100);
  return paise > 0
    ? `${numberToWords(rupees)} and ${numberToWords(paise).replace(' Rupees', '')} Paise Only`
    : `${numberToWords(rupees)} Only`;
};

/**
 * Compute commercial totals from line items, vendor state, and rupee adjustments.
 * @param {Array<Object>} items - { amount, gstRate, verifiedQty }
 * @param {Object} [vendor={}] - vendor snapshot (state drives SGST/CGST vs IGST)
 * @param {Object} [adjustments={}]
 * @param {{ applyAutoRoundOff?: boolean }} [opts={}]
 * @returns {Object}
 */
export const computeVendorGrnFinancials = (
  items = [],
  vendor = {},
  adjustments = {},
  opts = {}
) => {
  const subTotal = items.reduce((s, it) => s + toNumber(it.amount), 0);
  const totalQty = items.reduce((s, it) => s + toNumber(it.verifiedQty ?? it.quantity), 0);

  const adj = normalizeAdjustments(adjustments);
  const discountAmount = Math.min(adj.discountAmount, subTotal);
  const taxableValue = subTotal - discountAmount;

  const avgGstRate = items.length
    ? items.reduce((s, it) => s + toNumber(it.gstRate), 0) / items.length
    : 0;

  const itemGst = (taxableValue * avgGstRate) / 100;
  const freightAmount = adj.freightAmount;
  const freightGst = (freightAmount * adj.freightGstPercent) / 100;
  const totalGst = itemGst + freightGst;

  const vendorState = (vendor?.state || '').toLowerCase();
  const sameState = SUPPLIER_HOME_STATES.has(vendorState);
  const sgst = sameState ? totalGst / 2 : 0;
  const cgst = sameState ? totalGst / 2 : 0;
  const igst = sameState ? 0 : totalGst;

  const preRoundTotal = taxableValue + itemGst + freightAmount + freightGst;
  const roundOffSuggested = Math.round(preRoundTotal) - preRoundTotal;

  const hasFinancialAdj =
    adj.discountAmount > 0 || adj.freightAmount > 0 || adj.freightGstPercent > 0;

  let roundOff = 0;
  if (adj.roundOff !== null) {
    roundOff = adj.roundOff;
  } else if (opts.applyAutoRoundOff || hasFinancialAdj) {
    roundOff = roundOffSuggested;
  }

  const grandTotal = preRoundTotal + roundOff;
  const taxLabel = sameState
    ? `GST ${avgGstRate.toFixed(1)}%`
    : `IGST ${avgGstRate.toFixed(1)}%`;

  return {
    subTotal,
    discountAmount,
    taxableValue,
    freightAmount,
    freightGst,
    itemGst,
    preRoundTotal,
    roundOff,
    roundOffSuggested,
    sgst,
    cgst,
    igst,
    gst: totalGst,
    grandTotal,
    totalQty,
    taxLabel,
    amountInWords: formatAmountInWords(grandTotal),
  };
};

/**
 * Merge qty totals with financial totals computed from lots.
 * @param {Object} qtyTotals
 * @param {Array<Object>} lots
 * @param {Object} vendor
 * @param {Object} [adjustments={}]
 * @returns {Object}
 */
export const attachFinancialTotals = (qtyTotals, lots, vendor, adjustments = {}) => ({
  ...pickQtyTotals(qtyTotals),
  ...computeVendorGrnFinancials(flattenLotItems(lots), vendor, adjustments, {
    applyAutoRoundOff: true,
  }),
});

/**
 * Recalc line amount from verified qty × rate.
 * @param {Object} item
 * @returns {Object}
 */
export const recalcItemAmount = (item) => ({
  ...item,
  amount: toNumber(item.verifiedQty) * toNumber(item.rate),
});

/**
 * Apply user-entered HSN / rate / unit onto matching lot items.
 * @param {Array<Object>} lots
 * @param {Array<Object>} lineCommercial
 * @returns {Array<Object>}
 */
export const applyLineCommercial = (lots = [], lineCommercial = []) => {
  if (!Array.isArray(lineCommercial) || lineCommercial.length === 0) {
    return (lots || []).map((lot) => ({
      ...lot,
      items: (lot.items || []).map(recalcItemAmount),
    }));
  }

  return (lots || []).map((lot) => ({
    ...lot,
    items: (lot.items || []).map((item) => {
      const match = lineCommercial.find((lc) => {
        const lotOk = !lc.lotNumber || trimSafe(lc.lotNumber) === trimSafe(lot.lotNumber);
        if (!lotOk) return false;
        if (lc.poItem) return String(item.poItem || '') === String(lc.poItem);
        if (lc.productId) return String(item.productId || '') === String(lc.productId);
        return Boolean(lc.lotNumber);
      });
      if (!match) return recalcItemAmount(item);
      const rate = match.rate !== undefined ? toNumber(match.rate) : toNumber(item.rate);
      const hsnCode =
        match.hsnCode !== undefined ? trimSafe(match.hsnCode) : trimSafe(item.hsnCode);
      const unit =
        match.unit !== undefined ? trimSafe(match.unit) || 'Pairs' : trimSafe(item.unit) || 'Pairs';
      return recalcItemAmount({ ...item, rate, hsnCode, unit });
    }),
  }));
};

/**
 * Copy user commercial overrides from a parent GRN onto a revised qty snapshot.
 * @param {Array<Object>} parentLots
 * @param {Array<Object>} newLots
 * @returns {Array<Object>}
 */
export const carryForwardCommercial = (parentLots = [], newLots = []) => {
  const parentItems = flattenLotItems(parentLots);
  return (newLots || []).map((lot) => ({
    ...lot,
    items: (lot.items || []).map((item) => {
      const parent =
        parentItems.find(
          (p) =>
            String(p.vendorProductionFlowId || '') === String(item.vendorProductionFlowId || '') &&
            trimSafe(p.lotNumber) === trimSafe(lot.lotNumber)
        ) ||
        parentItems.find(
          (p) =>
            String(p.poItem || '') === String(item.poItem || '') &&
            trimSafe(p.lotNumber) === trimSafe(lot.lotNumber)
        ) ||
        parentItems.find((p) => String(p.poItem || '') === String(item.poItem || ''));
      if (!parent) return recalcItemAmount(item);
      const rate = parent.rate != null ? toNumber(parent.rate) : toNumber(item.rate);
      const gstRate = parent.gstRate != null ? toNumber(parent.gstRate) : toNumber(item.gstRate);
      const hsnCode = trimSafe(parent.hsnCode) || trimSafe(item.hsnCode);
      const unit = trimSafe(parent.unit) || trimSafe(item.unit) || 'Pairs';
      return recalcItemAmount({ ...item, rate, gstRate, hsnCode, unit });
    }),
  }));
};

/**
 * Resolve a VPO poItem matching a GRN line.
 * @param {Array<Object>} poItems
 * @param {Object} item
 * @returns {Object|undefined}
 */
const findPoItem = (poItems, item) =>
  (poItems || []).find(
    (pi) =>
      (item.poItem && String(pi._id) === String(item.poItem)) ||
      (item.productId && String(pi.productId) === String(item.productId))
  );

/**
 * Fill missing rate/gstRate from VPO poItems (display-only for legacy GRNs).
 * @param {Array<Object>} lots
 * @param {Object} [vpo]
 * @returns {Array<Object>}
 */
export const backfillLotsFromVpo = (lots = [], vpo) => {
  const poItems = vpo?.poItems || [];
  return (lots || []).map((lot) => ({
    ...lot,
    items: (lot.items || []).map((item) => {
      const poItem = findPoItem(poItems, item);
      const rate = item.rate != null ? toNumber(item.rate) : toNumber(poItem?.rate);
      const gstRate = item.gstRate != null ? toNumber(item.gstRate) : toNumber(poItem?.gstRate);
      const unit = trimSafe(item.unit) || 'Pairs';
      const hsnCode = trimSafe(item.hsnCode);
      return recalcItemAmount({ ...item, rate, gstRate, unit, hsnCode });
    }),
  }));
};

/**
 * Display-hydrate a GRN with VPO rates and recomputed financial totals.
 * Does not persist.
 * @param {Object} grn
 * @param {Object|null} vpo
 * @returns {Object}
 */
export const hydrateGrnCommercial = (grn, vpo = null) => {
  if (!grn) return grn;
  const lots = backfillLotsFromVpo(grn.lots, vpo);
  const adjustments = grn.adjustments || {};
  return {
    ...grn,
    lots,
    totals: attachFinancialTotals(grn.totals, lots, grn.vendor, adjustments),
  };
};

/**
 * Whether any line is missing rate/gstRate and needs a VPO lookup.
 * @param {Object} grn
 * @returns {boolean}
 */
export const needsVpoBackfill = (grn) =>
  (grn?.lots || []).some((lot) =>
    (lot.items || []).some((item) => item.rate == null || item.gstRate == null)
  );

/**
 * Apply header PATCH (notes, discrepancy, adjustments, line commercial) onto a plain GRN.
 * @param {Object} grn
 * @param {Object} fields
 * @returns {Object}
 */
export const applyHeaderPatch = (grn, fields = {}) => {
  const next = { ...grn };
  if (fields.notes !== undefined) next.notes = fields.notes || '';
  if (fields.discrepancyDetails !== undefined) {
    next.discrepancyDetails = fields.discrepancyDetails || '';
  }

  const hasFinancial =
    typeof fields.discountAmount === 'number' ||
    typeof fields.freightAmount === 'number' ||
    typeof fields.freightGstPercent === 'number' ||
    typeof fields.roundOff === 'number' ||
    Array.isArray(fields.lineCommercial);

  if (!hasFinancial) return next;

  const adjustments = {
    discountAmount: toNumber(grn.adjustments?.discountAmount),
    freightAmount: toNumber(grn.adjustments?.freightAmount),
    freightGstPercent: toNumber(grn.adjustments?.freightGstPercent),
    roundOff: toNumber(grn.adjustments?.roundOff),
  };
  if (typeof fields.discountAmount === 'number') adjustments.discountAmount = fields.discountAmount;
  if (typeof fields.freightAmount === 'number') adjustments.freightAmount = fields.freightAmount;
  if (typeof fields.freightGstPercent === 'number') {
    adjustments.freightGstPercent = fields.freightGstPercent;
  }
  if (typeof fields.roundOff === 'number') adjustments.roundOff = fields.roundOff;
  next.adjustments = normalizeAdjustments(adjustments);
  next.adjustments.roundOff = toNumber(adjustments.roundOff);

  next.lots = applyLineCommercial(grn.lots, fields.lineCommercial);
  next.totals = attachFinancialTotals(grn.totals, next.lots, grn.vendor, next.adjustments);
  return next;
};
