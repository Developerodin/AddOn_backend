/**
 * GRN-2026-0263 revision: drop the duplicate 1-bag line and keep 4 bags / 89.68 kg.
 */
import { YarnBox, YarnGrn, YarnPurchaseOrder } from '../../models/index.js';
import { computeSnapshotDiff, computeTotals } from '../../services/yarnManagement/yarnGrnSnapshot.builder.js';
import {
  BEIGE_PO,
  BEIGE_LOT,
  BEIGE_GRN_BASE,
  BEIGE_GRN_KEEP,
  PHANTOM_NET,
  KEEP_NET,
  KEEP_BOXES,
  NOT_RETURNED,
  nearlyEqual,
  isPhantomBagLine,
  isKeepBagLine,
  grnAlreadyCorrect,
  writeCount,
} from './yarnReceiptCorrectionSep2026.shared.js';

/**
 * Rebuild printed item rows after the phantom bag line is removed.
 * @param {Object[]} items
 * @param {Object[]} keptLots
 * @returns {Object[]}
 */
function rebuildGrnItems(items, keptLots) {
  const qtyByPoItem = new Map();
  keptLots.forEach((lot) => {
    (lot.poItems || []).forEach((line) => {
      const id = String(line.poItem || '');
      if (!id) return;
      qtyByPoItem.set(id, (qtyByPoItem.get(id) || 0) + Number(line.receivedQuantity || 0));
    });
  });

  return (items || [])
    .map((item) => {
      const id = String(item.poItem || '');
      if (!qtyByPoItem.has(id)) return { ...item };
      const quantity = qtyByPoItem.get(id);
      const rate = Number(item.rate || 0);
      return { ...item, quantity, amount: quantity * rate };
    })
    .filter((item) => Number(item.quantity) > 0);
}

/**
 * Copy the active GRN, drop the phantom bag, and issue the next revision.
 * @param {Object} parent
 * @param {boolean} apply
 * @returns {Promise<Record<string, unknown>>}
 */
async function issueGrnRevision(parent, apply) {
  const keptLots = (parent.lots || []).filter((lot) => !isPhantomBagLine(lot));
  if (keptLots.length !== 1 || !isKeepBagLine(keptLots[0])) {
    throw new Error(`${parent.grnNumber}: kept lot lines are not the single 4-bag / ${KEEP_NET} kg line`);
  }

  const items = rebuildGrnItems(parent.items, keptLots);
  if (items.length !== 1 || !nearlyEqual(items[0].quantity, KEEP_NET, 0.05)) {
    throw new Error(`${parent.grnNumber}: rebuilt item qty is ${items[0]?.quantity}, expected ${KEEP_NET}`);
  }

  const totals = computeTotals(items, parent.supplier || {}, parent.adjustments || {});
  const family = await YarnGrn.find({ baseGrnNumber: BEIGE_GRN_BASE }).select('revisionNo grnNumber').lean();
  const nextRevisionNo = Math.max(0, ...family.map((g) => Number(g.revisionNo) || 0)) + 1;
  const grnNumber = `${BEIGE_GRN_BASE}-R${nextRevisionNo}`;
  const taken = await YarnGrn.findOne({ grnNumber }).select('_id').lean();
  if (taken) throw new Error(`GRN number ${grnNumber} already exists`);

  const snapshot = { lots: keptLots, items, totals };
  const revisionDiff = computeSnapshotDiff(parent, snapshot);
  revisionDiff.push({
    field: 'correction.removedPhantomBag',
    before: `1 bag / ${PHANTOM_NET} kg`,
    after: `removed; ${KEEP_BOXES} bags / ${KEEP_NET} kg remain`,
  });

  const preview = {
    step: 'grn-263',
    status: apply ? 'revised' : 'would_revise',
    from: parent.grnNumber,
    to: grnNumber,
    removeBoxes: 1,
    removeNetKg: PHANTOM_NET,
    remainingBoxes: KEEP_BOXES,
    remainingNetKg: totals.totalQty,
    grandTotal: totals.grandTotal,
  };
  if (!apply) return preview;

  const created = await YarnGrn.create({
    grnNumber,
    baseGrnNumber: BEIGE_GRN_BASE,
    grnDate: parent.grnDate,
    status: 'active',
    revisionOf: parent._id,
    revisionNo: nextRevisionNo,
    revisionReason:
      'Removed duplicate 1-bag line (22.76 kg). Physical receipt on this GRN is 4 bags / 89.68 kg. GRN-2026-0268 is a different invoice and is unchanged.',
    revisionDiff,
    purchaseOrder: parent.purchaseOrder,
    poNumber: parent.poNumber,
    poDate: parent.poDate,
    supplier: parent.supplier,
    consignee: parent.consignee,
    lots: keptLots,
    items,
    totals,
    adjustments: parent.adjustments || {},
    vendorInvoiceNo: parent.vendorInvoiceNo || '',
    vendorInvoiceDate: parent.vendorInvoiceDate || null,
    discrepancyDetails: parent.discrepancyDetails || '',
    notes: parent.notes || '',
    isLegacy: false,
    createdBy: { username: 'data-correction', email: '' },
  });

  const superseded = await YarnGrn.updateOne(
    { _id: parent._id, status: 'active' },
    { $set: { status: 'superseded', supersededAt: new Date(), supersededByGrn: created._id } }
  );
  if (writeCount(superseded) !== 1) {
    await YarnGrn.deleteOne({ _id: created._id });
    throw new Error(`Could not supersede ${parent.grnNumber}. Rolled back ${grnNumber}.`);
  }

  await YarnPurchaseOrder.updateOne({ _id: parent.purchaseOrder }, { $push: { grnHistory: created._id } });
  preview.grnId = String(created._id);
  return preview;
}

/**
 * Drop a leftover 1-bag PO lot line when the 4-bag line for the same lot is already present.
 * @param {boolean} apply
 * @returns {Promise<Record<string, unknown>>}
 */
async function fixBeigePoLotIfNeeded(apply) {
  const po = await YarnPurchaseOrder.findOne({ poNumber: BEIGE_PO }).select('receivedLotDetails').lean();
  if (!po) throw new Error(`${BEIGE_PO} not found`);

  const lots = po.receivedLotDetails || [];
  const phantom = lots.filter(isPhantomBagLine);
  const keep = lots.filter(isKeepBagLine);
  if (!phantom.length) {
    if (!keep.length) throw new Error(`${BEIGE_PO} has no 4-bag lot ${BEIGE_LOT}`);
    return { step: 'po-1291-lot', status: 'already_4_bags' };
  }
  if (keep.length !== 1 || phantom.length !== 1) {
    throw new Error(`${BEIGE_PO} lot ${BEIGE_LOT} shape is not 1 phantom + 1 keep line`);
  }

  const nextLots = lots.filter((lot) => !isPhantomBagLine(lot));
  if (!apply) return { step: 'po-1291-lot', status: 'would_remove_phantom_lot_line' };

  await YarnPurchaseOrder.updateOne({ _id: po._id }, { $set: { receivedLotDetails: nextLots } });
  return { step: 'po-1291-lot', status: 'removed_phantom_lot_line' };
}

/**
 * Correct GRN 263 only when four physical bags of the original lot are on hand.
 * @param {boolean} apply
 * @returns {Promise<Record<string, unknown>>}
 */
export async function fixGrn263(apply) {
  const liveBoxes = await YarnBox.find({
    poNumber: BEIGE_PO,
    lotNumber: BEIGE_LOT,
    ...NOT_RETURNED,
  })
    .select('boxWeight')
    .lean();
  const liveNet = liveBoxes.reduce((sum, b) => sum + Number(b.boxWeight || 0), 0);
  if (liveBoxes.length !== KEEP_BOXES || !nearlyEqual(liveNet, KEEP_NET, 0.05)) {
    throw new Error(
      `${BEIGE_PO} lot ${BEIGE_LOT}: expected ${KEEP_BOXES} live boxes / ${KEEP_NET} kg, found ${liveBoxes.length} / ${liveNet}`
    );
  }

  const keepGrn = await YarnGrn.findOne({ grnNumber: BEIGE_GRN_KEEP, status: 'active' }).select('lots totals').lean();
  if (!keepGrn || (keepGrn.lots || []).length !== 1 || Number(keepGrn.lots[0].numberOfBoxes) !== 1) {
    throw new Error(`${BEIGE_GRN_KEEP} is not the expected active 1-bag GRN. Refusing to edit GRN 263.`);
  }

  const poFix = await fixBeigePoLotIfNeeded(apply);
  const active = await YarnGrn.find({ baseGrnNumber: BEIGE_GRN_BASE, status: 'active' }).lean();
  const fixed = active.find(grnAlreadyCorrect);
  const parent = active.find((g) => (g.lots || []).some(isPhantomBagLine) && (g.lots || []).some(isKeepBagLine));

  if (fixed && !parent) {
    return { step: 'grn-263', status: 'already_done', grnNumber: fixed.grnNumber, poLot: poFix };
  }
  if (fixed && parent) {
    if (apply) {
      await YarnGrn.updateOne(
        { _id: parent._id, status: 'active' },
        { $set: { status: 'superseded', supersededAt: new Date(), supersededByGrn: fixed._id } }
      );
    }
    return {
      step: 'grn-263',
      status: apply ? 'superseded_stale_active' : 'would_supersede_stale_active',
      kept: fixed.grnNumber,
      stale: parent.grnNumber,
      poLot: poFix,
    };
  }
  if (!parent) {
    throw new Error(`No active ${BEIGE_GRN_BASE} revision with both the 1-bag and 4-bag lines`);
  }
  if ((parent.lots || []).length !== 2) {
    throw new Error(`${parent.grnNumber} has ${parent.lots.length} lot lines, expected exactly 2`);
  }

  const grnFix = await issueGrnRevision(parent, apply);
  return { ...grnFix, poLot: poFix };
}
