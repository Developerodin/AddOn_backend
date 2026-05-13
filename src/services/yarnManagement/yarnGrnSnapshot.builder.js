/**
 * Pure helpers that build a YarnGrn snapshot from a populated YarnPurchaseOrder.
 * No Mongo I/O lives here — keeps the service file thin and unit-testable.
 */

const SUPPLIER_HOME_STATES = new Set(['maharashtra', 'mh']);

const CONSIGNEE_DEFAULT = Object.freeze({
  name: 'ADDON HOLDINGS',
  address: '',
  stateCode: '27',
  gstNo: '27AAACA8827A1ZZ',
});

/**
 * Convert any value to a non-NaN finite number, defaulting to 0.
 * @param {*} value
 * @returns {number}
 */
const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param {string|null|undefined} value
 * @returns {string}
 */
const trimSafe = (value) => (value == null ? '' : String(value).trim());

/**
 * Resolve a PO line item by its sub-document _id.
 * @param {Array<Object>} poItems
 * @param {string} id
 */
const findPoItem = (poItems, id) => {
  if (!Array.isArray(poItems) || !id) return null;
  return poItems.find((it) => {
    const itId = it?._id?.toString?.() || it?.id?.toString?.();
    return itId === id;
  }) || null;
};

/**
 * Build the supplier snapshot block from a populated PO.
 * @param {Object} po
 */
const buildSupplierSnapshot = (po) => {
  const sup = po?.supplier && typeof po.supplier === 'object' ? po.supplier : {};
  return {
    supplierId: sup?._id || sup?.id || (typeof po?.supplier === 'string' ? po.supplier : null),
    name: trimSafe(po?.supplierName || sup?.brandName),
    contactPersonName: trimSafe(sup?.contactPersonName),
    contactNumber: trimSafe(sup?.contactNumber),
    email: trimSafe(sup?.email),
    address: trimSafe(sup?.address),
    city: trimSafe(sup?.city),
    state: trimSafe(sup?.state),
    pincode: trimSafe(sup?.pincode),
    country: trimSafe(sup?.country),
    gstNo: trimSafe(sup?.gstNo || sup?.gstin || sup?.gst),
  };
};

/**
 * Build the consignee snapshot. Currently always defaults to ADDON HOLDINGS,
 * but stored on every GRN so changing it later doesn't rewrite history.
 */
const buildConsigneeSnapshot = () => ({ ...CONSIGNEE_DEFAULT });

/**
 * Build the lots[] subdoc array for a GRN, scoped to the supplied lot numbers.
 * Hydrates per-line yarn details from the PO so reprints survive PO edits.
 * @param {Object} po - populated YarnPurchaseOrder
 * @param {Array<string>} lotNumbers - subset of receivedLotDetails to include
 */
const buildLotsSnapshot = (po, lotNumbers) => {
  if (!Array.isArray(po?.receivedLotDetails) || !lotNumbers?.length) return [];
  const wanted = new Set(lotNumbers.map((n) => trimSafe(n)));
  return po.receivedLotDetails
    .filter((l) => wanted.has(trimSafe(l.lotNumber)))
    .map((lot) => ({
      lotNumber: trimSafe(lot.lotNumber),
      numberOfCones: toNumber(lot.numberOfCones),
      totalWeight: toNumber(lot.totalWeight),
      netWeight: toNumber(lot.netWeight),
      numberOfBoxes: toNumber(lot.numberOfBoxes),
      poItems: (lot.poItems || []).map((entry) => {
        const refId = entry?.poItem?.toString?.() || (typeof entry?.poItem === 'string' ? entry.poItem : '');
        const ref = findPoItem(po.poItems, refId);
        return {
          poItem: refId || undefined,
          receivedQuantity: toNumber(entry.receivedQuantity),
          yarnName: trimSafe(ref?.yarnName || ref?.yarnCatalogId?.yarnName),
          sizeCount: trimSafe(ref?.sizeCount),
          shadeCode: trimSafe(ref?.shadeCode || ref?.yarnCatalogId?.shadeCode),
          rate: toNumber(ref?.rate),
        };
      }),
      voided: false,
    }));
};

/**
 * Build the printed items[] table rows by aggregating received quantities
 * across the given lots, so an item that appears on two lots shows up
 * with combined quantity. Falls back to the PO's full poItems when the lots
 * have no per-item breakdown.
 * @param {Object} po
 * @param {Array<Object>} lots - already-built grn lots snapshot
 */
const buildItemsSnapshot = (po, lots) => {
  if (!Array.isArray(po?.poItems)) return [];

  const aggregated = new Map();
  let anyBreakdown = false;
  lots.forEach((lot) => {
    (lot.poItems || []).forEach((line) => {
      anyBreakdown = true;
      const id = line.poItem?.toString?.() || trimSafe(line.poItem);
      if (!id) return;
      const cur = aggregated.get(id) || { qty: 0 };
      cur.qty += toNumber(line.receivedQuantity);
      aggregated.set(id, cur);
    });
  });

  if (!anyBreakdown) {
    return po.poItems.map((it) => {
      const qty = toNumber(it.quantity);
      const rate = toNumber(it.rate);
      return {
        poItem: it._id,
        yarnName: trimSafe(it.yarnName || it.yarnCatalogId?.yarnName),
        yarnCatalogId: it.yarnCatalogId?._id || it.yarnCatalogId,
        sizeCount: trimSafe(it.sizeCount),
        shadeCode: trimSafe(it.shadeCode || it.yarnCatalogId?.shadeCode),
        pantoneName: trimSafe(it.pantoneName),
        quantity: qty,
        rate,
        amount: qty * rate,
        gstRate: toNumber(it.gstRate),
        unit: 'KGS',
      };
    });
  }

  const items = [];
  po.poItems.forEach((it) => {
    const id = it._id?.toString?.();
    const agg = id && aggregated.get(id);
    if (!agg || agg.qty <= 0) return;
    const rate = toNumber(it.rate);
    items.push({
      poItem: it._id,
      yarnName: trimSafe(it.yarnName || it.yarnCatalogId?.yarnName),
      yarnCatalogId: it.yarnCatalogId?._id || it.yarnCatalogId,
      sizeCount: trimSafe(it.sizeCount),
      shadeCode: trimSafe(it.shadeCode || it.yarnCatalogId?.shadeCode),
      pantoneName: trimSafe(it.pantoneName),
      quantity: agg.qty,
      rate,
      amount: agg.qty * rate,
      gstRate: toNumber(it.gstRate),
      unit: 'KGS',
    });
  });
  return items;
};

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/**
 * Convert an integer rupee amount to Indian-numbering English words
 * (Crore/Lakh/Thousand). Used for the GRN total-in-words line.
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
 * Compute the totals block (sub-total, GST split, grand total) from snapshot
 * line items only so a partial GRN never inherits the full PO's `total` / `gst`.
 * Tax is summed per line: amount × (gstRate / 100). Supplier state drives SGST+CGST vs IGST.
 * @param {Array<Object>} items - printed rows (received qty × rate per line)
 * @param {Object} supplier - already-built supplier snapshot (for state)
 */
const computeTotals = (items, supplier) => {
  const subTotal = items.reduce((s, it) => s + toNumber(it.amount), 0);
  const totalQty = items.reduce((s, it) => s + toNumber(it.quantity), 0);

  const supplierState = (supplier?.state || '').toLowerCase();
  const sameState = SUPPLIER_HOME_STATES.has(supplierState);

  const totalGst = items.reduce((s, it) => {
    const amt = toNumber(it.amount);
    const ratePct = toNumber(it.gstRate);
    return s + (amt * ratePct) / 100;
  }, 0);

  const sgst = sameState ? totalGst / 2 : 0;
  const cgst = sameState ? totalGst / 2 : 0;
  const igst = sameState ? 0 : totalGst;

  const grandTotal = subTotal + totalGst;

  const avgGstRate = items.length
    ? items.reduce((s, it) => s + toNumber(it.gstRate || 0), 0) / items.length
    : 0;

  const taxLabel = sameState
    ? `GST ${avgGstRate.toFixed(1)}%`
    : `IGST ${avgGstRate.toFixed(1)}%`;

  const rupees = Math.floor(grandTotal);
  const paise = Math.round((grandTotal - rupees) * 100);
  const amountInWords = paise > 0
    ? `${numberToWords(rupees)} and ${numberToWords(paise).replace(' Rupees', '')} Paise Only`
    : `${numberToWords(rupees)} Only`;

  return {
    subTotal,
    sgst,
    cgst,
    igst,
    gst: totalGst,
    grandTotal,
    totalQty,
    taxLabel,
    amountInWords,
  };
};

/**
 * Cheap "did the printable content of this lot change?" check.
 * Compares only the fields that show up on the printed GRN — status flips
 * and other cosmetic edits do NOT trigger a revision.
 * @param {Object} prior - lot doc from prior PO state
 * @param {Object} current - lot doc from updated PO state
 * @returns {boolean}
 */
const lotMaterialChange = (prior, current) => {
  if (!prior || !current) return Boolean(prior) !== Boolean(current);
  if (toNumber(prior.numberOfCones) !== toNumber(current.numberOfCones)) return true;
  if (toNumber(prior.totalWeight) !== toNumber(current.totalWeight)) return true;
  if (toNumber(prior.netWeight) !== toNumber(current.netWeight)) return true;
  if (toNumber(prior.numberOfBoxes) !== toNumber(current.numberOfBoxes)) return true;

  const priorMap = new Map(
    (prior.poItems || []).map((p) => [p.poItem?.toString?.() || String(p.poItem), toNumber(p.receivedQuantity)])
  );
  const currentMap = new Map(
    (current.poItems || []).map((c) => [c.poItem?.toString?.() || String(c.poItem), toNumber(c.receivedQuantity)])
  );
  if (priorMap.size !== currentMap.size) return true;
  for (const [k, v] of priorMap) {
    if (currentMap.get(k) !== v) return true;
  }
  return false;
};

/**
 * Diff two GRN snapshots, returning an array of {field, before, after}
 * entries. Used to populate revisionDiff so the audit page can render
 * a concise before/after table without recomputing.
 * @param {Object} before - prior YarnGrn doc (lean)
 * @param {Object} after - newly built snapshot fragment (totals + lots + items)
 */
const computeSnapshotDiff = (before, after) => {
  const diff = [];
  const cmp = (field, b, a) => {
    if (toNumber(b) !== toNumber(a)) diff.push({ field, before: toNumber(b), after: toNumber(a) });
  };

  cmp('totals.subTotal', before?.totals?.subTotal, after?.totals?.subTotal);
  cmp('totals.gst', before?.totals?.gst, after?.totals?.gst);
  cmp('totals.grandTotal', before?.totals?.grandTotal, after?.totals?.grandTotal);
  cmp('totals.totalQty', before?.totals?.totalQty, after?.totals?.totalQty);

  const beforeLots = new Map((before?.lots || []).map((l) => [l.lotNumber, l]));
  const afterLots = new Map((after?.lots || []).map((l) => [l.lotNumber, l]));
  const lotKeys = new Set([...beforeLots.keys(), ...afterLots.keys()]);
  for (const k of lotKeys) {
    const b = beforeLots.get(k);
    const a = afterLots.get(k);
    cmp(`lots.${k}.numberOfCones`, b?.numberOfCones, a?.numberOfCones);
    cmp(`lots.${k}.totalWeight`, b?.totalWeight, a?.totalWeight);
    cmp(`lots.${k}.netWeight`, b?.netWeight, a?.netWeight);
    cmp(`lots.${k}.numberOfBoxes`, b?.numberOfBoxes, a?.numberOfBoxes);
  }
  return diff;
};

/**
 * Build the full snapshot fragment (supplier, consignee, lots, items, totals)
 * from a populated PO + a list of lot numbers to include.
 * @param {Object} po - populated YarnPurchaseOrder
 * @param {Array<string>} lotNumbers
 */
const buildSnapshot = (po, lotNumbers) => {
  const supplier = buildSupplierSnapshot(po);
  const consignee = buildConsigneeSnapshot();
  const lots = buildLotsSnapshot(po, lotNumbers);
  const items = buildItemsSnapshot(po, lots);
  const totals = computeTotals(items, supplier);
  return { supplier, consignee, lots, items, totals };
};

export {
  buildSnapshot,
  buildSupplierSnapshot,
  buildConsigneeSnapshot,
  buildLotsSnapshot,
  buildItemsSnapshot,
  computeTotals,
  computeSnapshotDiff,
  lotMaterialChange,
  numberToWords,
};
