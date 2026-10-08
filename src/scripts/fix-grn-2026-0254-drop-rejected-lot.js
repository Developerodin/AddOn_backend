#!/usr/bin/env node
/**
 * Drop the QC-rejected lot from GRN-2026-0254.
 *
 * Lot 10730-19092026 (13 boxes, 650 kg, 30s Light Grey Melange Cotton Birla Modal)
 * was QC-rejected and the boxes were already returned. The GRN snapshot still
 * prints that lot. This issues GRN-2026-0254-R1 with only the accepted lot
 * 10726-19092026 and supersedes the original.
 *
 * Does not touch boxes, cones, inventory, PO lot status, or PO-2026-1310.
 *
 * Dry-run is the default. Writes happen only with --apply.
 *
 *   node src/scripts/fix-grn-2026-0254-drop-rejected-lot.js
 *   node src/scripts/fix-grn-2026-0254-drop-rejected-lot.js --apply
 *   node src/scripts/fix-grn-2026-0254-drop-rejected-lot.js --mongo-url="mongodb://..." --apply
 *
 * Run from AddOn_backend so .env loads. Aborts if a fingerprint does not match.
 *
 * @file
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnGrn, YarnPurchaseOrder } from '../models/index.js';
import { computeSnapshotDiff, computeTotals } from '../services/yarnManagement/yarnGrnSnapshot.builder.js';

const APPLY = process.argv.includes('--apply');

const GRN_BASE = 'GRN-2026-0254';
const PO_NUMBER = 'PO-2026-1287';
const REJECTED_LOT = '10730-19092026';
const KEPT_LOT = '10726-19092026';
const REJECTED_YARN = '30s-Light Grey Melange-Light Grey Melange-Cotton/Cotton Birla Modal Melange';
const KEPT_YARN = '20s-Anthra Melange-Anthra Melange-Cotton/Combed Melange';
const REJECTED_SHADE = 'DM68503-I';
const KEPT_SHADE = 'DM-68500-I';
const REJECTED_QTY = 650;
const KEPT_QTY = 626.3;
const REJECTED_RATE = 440;
const KEPT_RATE = 425;
const REJECTED_GROSS = 686;
const KEPT_GROSS = 652;
const REJECTED_CONES = 312;
const KEPT_CONES = 302;
const BOXES = 13;
const PRIOR_SUBTOTAL = 552177.5;
const PRIOR_GST = 27608.875;
const PRIOR_GRAND = 579786.375;
const PRIOR_QTY = 1276.3;
const NEXT_SUBTOTAL = 266177.5;
const NEXT_GST = 13308.875;
const NEXT_GRAND = 279486.375;

const REVISION_REASON =
  'Removed QC-rejected lot 10730-19092026 (13 boxes, 650 kg, 30s Light Grey Melange Cotton Birla Modal, shade DM68503-I). Those boxes were already returned. This GRN keeps only accepted lot 10726-19092026 (13 boxes, 626.30 kg). PO-2026-1310 is unchanged.';

/**
 * Read `--key=value` from argv.
 * @param {string} prefix
 * @returns {string|null}
 */
function getArg(prefix) {
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length).trim() || null;
}

/**
 * @param {string} rawUrl
 * @returns {string}
 */
function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  if (u.endsWith('>')) u = u.slice(0, -1);
  return u;
}

/**
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cli = getArg('--mongo-url=');
  if (cli) return { url: sanitizeMongoUrl(cli), source: '--mongo-url' };
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  return { url: sanitizeMongoUrl(String(process.env.MONGODB_URL || '')), source: 'process.env.MONGODB_URL' };
}

/**
 * @returns {Promise<void>}
 */
async function connectMongo() {
  const { url: u, source } = resolveMongoConnectionString();
  if (!u) throw new Error('MongoDB URL is empty. Set MONGODB_URL or pass --mongo-url=');
  const redacted = u.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`Connecting to MongoDB (${source}): ${redacted}`);
  await mongoose.connect(u, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 30_000 });
}

/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} [eps]
 * @returns {boolean}
 */
function nearlyEqual(actual, expected, eps = 0.02) {
  return Math.abs(Number(actual) - expected) <= eps;
}

/**
 * Mongoose 5 reports `nModified` / `n`. Newer drivers report `modifiedCount`.
 * @param {{ modifiedCount?: number, nModified?: number, n?: number }} res
 * @returns {number}
 */
function writeCount(res) {
  return Number(res?.modifiedCount ?? res?.nModified ?? res?.n ?? 0);
}

/**
 * @param {Object} lot
 * @param {string} lotNumber
 * @param {number} cones
 * @param {number} gross
 * @param {number} net
 * @param {string} yarnName
 * @param {string} shade
 * @param {number} rate
 * @returns {void}
 */
function assertLotFingerprint(lot, lotNumber, cones, gross, net, yarnName, shade, rate) {
  if (!lot || lot.voided) throw new Error(`${lotNumber} is missing or voided on the GRN`);
  if (Number(lot.numberOfBoxes) !== BOXES) {
    throw new Error(`${lotNumber} boxes are ${lot.numberOfBoxes}, expected ${BOXES}`);
  }
  if (Number(lot.numberOfCones) !== cones) {
    throw new Error(`${lotNumber} cones are ${lot.numberOfCones}, expected ${cones}`);
  }
  if (!nearlyEqual(lot.totalWeight, gross, 0.05)) {
    throw new Error(`${lotNumber} gross is ${lot.totalWeight}, expected ${gross}`);
  }
  if (!nearlyEqual(lot.netWeight, net, 0.05)) {
    throw new Error(`${lotNumber} net is ${lot.netWeight}, expected ${net}`);
  }
  const line = (lot.poItems || [])[0];
  if ((lot.poItems || []).length !== 1 || line?.yarnName !== yarnName || line?.shadeCode !== shade) {
    throw new Error(`${lotNumber} yarn line is not ${yarnName} / ${shade}`);
  }
  if (!nearlyEqual(line.receivedQuantity, net, 0.05) || Number(line.rate) !== rate) {
    throw new Error(`${lotNumber} qty/rate is ${line.receivedQuantity} @ ${line.rate}, expected ${net} @ ${rate}`);
  }
}

/**
 * @param {Object} grn
 * @returns {boolean}
 */
function grnAlreadyCorrect(grn) {
  const lots = grn?.lots || [];
  const item = (grn?.items || [])[0];
  return (
    grn?.status === 'active' &&
    lots.length === 1 &&
    lots[0]?.lotNumber === KEPT_LOT &&
    !lots[0]?.voided &&
    Number(lots[0]?.numberOfBoxes) === BOXES &&
    nearlyEqual(lots[0]?.netWeight, KEPT_QTY, 0.05) &&
    (grn.items || []).length === 1 &&
    item?.yarnName === KEPT_YARN &&
    nearlyEqual(item?.quantity, KEPT_QTY, 0.05) &&
    nearlyEqual(grn?.totals?.grandTotal, NEXT_GRAND, 0.02) &&
    nearlyEqual(grn?.totals?.totalQty, KEPT_QTY, 0.05) &&
    !(grn.lots || []).some((lot) => lot.lotNumber === REJECTED_LOT)
  );
}

/**
 * Rebuild printed item rows from the kept lot only.
 * @param {Object[]} items
 * @param {Object[]} keptLots
 * @returns {Object[]}
 */
function rebuildItems(items, keptLots) {
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
      if (!qtyByPoItem.has(id)) return null;
      const quantity = qtyByPoItem.get(id);
      const rate = Number(item.rate || 0);
      return { ...item, quantity, amount: quantity * rate };
    })
    .filter((item) => item && Number(item.quantity) > 0);
}

/**
 * Confirm the rejected boxes are already off live stock and the kept lot is still the accepted receipt.
 * @returns {Promise<void>}
 */
async function assertStockFingerprint() {
  const rejected = await YarnBox.find({ poNumber: PO_NUMBER, lotNumber: REJECTED_LOT })
    .select('returnedToVendorAt qcData.status boxWeight yarnName')
    .lean();
  if (rejected.length !== BOXES) {
    throw new Error(`${PO_NUMBER} lot ${REJECTED_LOT}: expected ${BOXES} boxes, found ${rejected.length}`);
  }
  const liveRejected = rejected.filter((box) => !box.returnedToVendorAt);
  if (liveRejected.length) {
    throw new Error(`${liveRejected.length} rejected boxes are still live. Return them before editing the GRN.`);
  }
  if (rejected.some((box) => box.qcData?.status !== 'qc_rejected' || box.yarnName !== REJECTED_YARN)) {
    throw new Error('Rejected lot boxes are not all qc_rejected Birla Modal');
  }

  const kept = await YarnBox.find({ poNumber: PO_NUMBER, lotNumber: KEPT_LOT, returnedToVendorAt: null })
    .select('qcData.status yarnName')
    .lean();
  if (kept.length !== BOXES || kept.some((box) => box.qcData?.status !== 'qc_approved' || box.yarnName !== KEPT_YARN)) {
    throw new Error(`${KEPT_LOT} is not 13 live qc_approved Anthra boxes. Refusing to rewrite the GRN.`);
  }
}

/**
 * Confirm the PO still records the rejection and the accepted lot, then leave it alone.
 * @returns {Promise<import('mongoose').Types.ObjectId>}
 */
async function assertPoFingerprint() {
  const po = await YarnPurchaseOrder.findOne({ poNumber: PO_NUMBER })
    .select('receivedLotDetails currentStatus')
    .lean();
  if (!po) throw new Error(`${PO_NUMBER} not found`);

  const rejected = (po.receivedLotDetails || []).find((lot) => lot.lotNumber === REJECTED_LOT);
  const kept = (po.receivedLotDetails || []).find((lot) => lot.lotNumber === KEPT_LOT);
  if (!rejected || rejected.status !== 'lot_rejected' || rejected.qcData?.status !== 'qc_rejected') {
    throw new Error(`${PO_NUMBER} lot ${REJECTED_LOT} is not lot_rejected / qc_rejected`);
  }
  if (!kept || kept.status !== 'lot_accepted' || kept.qcData?.status !== 'qc_approved') {
    throw new Error(`${PO_NUMBER} lot ${KEPT_LOT} is not lot_accepted / qc_approved`);
  }
  return po._id;
}

/**
 * Copy the active GRN without the rejected lot and issue the next revision.
 * @param {Object} parent
 * @returns {Promise<Record<string, unknown>>}
 */
async function issueRevision(parent) {
  const keptLots = (parent.lots || []).filter((lot) => lot.lotNumber === KEPT_LOT && !lot.voided);
  if (keptLots.length !== 1) throw new Error(`${parent.grnNumber} does not have exactly one kept lot`);

  const items = rebuildItems(parent.items, keptLots);
  if (items.length !== 1 || items[0].yarnName !== KEPT_YARN || !nearlyEqual(items[0].quantity, KEPT_QTY, 0.05)) {
    throw new Error(`Rebuilt item is ${items[0]?.yarnName} / ${items[0]?.quantity}, expected ${KEPT_YARN} / ${KEPT_QTY}`);
  }
  if (!nearlyEqual(items[0].amount, NEXT_SUBTOTAL, 0.02) || Number(items[0].rate) !== KEPT_RATE) {
    throw new Error(`Rebuilt amount is ${items[0].amount} @ ${items[0].rate}`);
  }

  const totals = computeTotals(items, parent.supplier || {}, parent.adjustments || {});
  if (
    !nearlyEqual(totals.subTotal, NEXT_SUBTOTAL, 0.02) ||
    !nearlyEqual(totals.igst, NEXT_GST, 0.02) ||
    !nearlyEqual(totals.grandTotal, NEXT_GRAND, 0.02) ||
    !nearlyEqual(totals.totalQty, KEPT_QTY, 0.05) ||
    totals.sgst ||
    totals.cgst
  ) {
    throw new Error(`Recomputed totals ${totals.subTotal} / IGST ${totals.igst} / ${totals.grandTotal} do not match the kept lot`);
  }

  const family = await YarnGrn.find({ baseGrnNumber: GRN_BASE }).select('revisionNo grnNumber').lean();
  const nextRevisionNo = Math.max(0, ...family.map((row) => Number(row.revisionNo) || 0)) + 1;
  const grnNumber = `${GRN_BASE}-R${nextRevisionNo}`;
  const taken = await YarnGrn.findOne({ grnNumber }).select('_id').lean();
  if (taken) throw new Error(`GRN number ${grnNumber} already exists`);

  const snapshot = { lots: keptLots, items, totals };
  const revisionDiff = computeSnapshotDiff(parent, snapshot);
  revisionDiff.push({
    field: 'correction.removedRejectedLot',
    before: `${REJECTED_LOT} / ${BOXES} boxes / ${REJECTED_QTY} kg`,
    after: 'removed; accepted lot remains',
  });

  const preview = {
    status: APPLY ? 'revised' : 'would_revise',
    from: parent.grnNumber,
    to: grnNumber,
    removedLot: REJECTED_LOT,
    removedBoxes: BOXES,
    removedNetKg: REJECTED_QTY,
    remainingLot: KEPT_LOT,
    remainingBoxes: BOXES,
    remainingCones: KEPT_CONES,
    remainingGrossKg: KEPT_GROSS,
    remainingNetKg: totals.totalQty,
    subTotal: totals.subTotal,
    igst: totals.igst,
    grandTotal: totals.grandTotal,
    amountInWords: totals.amountInWords,
  };
  if (!APPLY) return preview;

  const created = await YarnGrn.create({
    grnNumber,
    baseGrnNumber: GRN_BASE,
    grnDate: parent.grnDate,
    status: 'active',
    revisionOf: parent._id,
    revisionNo: nextRevisionNo,
    revisionReason: REVISION_REASON,
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
 * Issue the revision only when the stored GRN still matches the printed original.
 * @returns {Promise<Record<string, unknown>>}
 */
async function fixGrn() {
  await assertStockFingerprint();
  await assertPoFingerprint();

  const active = await YarnGrn.find({ baseGrnNumber: GRN_BASE, status: 'active' }).lean();
  const fixed = active.find(grnAlreadyCorrect);
  const parent = active.find(
    (grn) =>
      grn.grnNumber === GRN_BASE &&
      Number(grn.revisionNo) === 0 &&
      (grn.lots || []).some((lot) => lot.lotNumber === REJECTED_LOT) &&
      (grn.lots || []).some((lot) => lot.lotNumber === KEPT_LOT)
  );

  if (fixed && !parent) {
    return { status: 'already_done', grnNumber: fixed.grnNumber };
  }
  if (fixed && parent) {
    if (APPLY) {
      await YarnGrn.updateOne(
        { _id: parent._id, status: 'active' },
        { $set: { status: 'superseded', supersededAt: new Date(), supersededByGrn: fixed._id } }
      );
    }
    return {
      status: APPLY ? 'superseded_stale_active' : 'would_supersede_stale_active',
      kept: fixed.grnNumber,
      stale: parent.grnNumber,
    };
  }
  if (active.length !== 1 || !parent) {
    throw new Error(`Expected one active ${GRN_BASE} that still contains both lots`);
  }
  if ((parent.lots || []).length !== 2 || (parent.items || []).length !== 2) {
    throw new Error(`${parent.grnNumber} has ${parent.lots?.length} lots and ${parent.items?.length} items, expected 2 and 2`);
  }

  const rejected = parent.lots.find((lot) => lot.lotNumber === REJECTED_LOT);
  const kept = parent.lots.find((lot) => lot.lotNumber === KEPT_LOT);
  assertLotFingerprint(rejected, REJECTED_LOT, REJECTED_CONES, REJECTED_GROSS, REJECTED_QTY, REJECTED_YARN, REJECTED_SHADE, REJECTED_RATE);
  assertLotFingerprint(kept, KEPT_LOT, KEPT_CONES, KEPT_GROSS, KEPT_QTY, KEPT_YARN, KEPT_SHADE, KEPT_RATE);

  const totals = parent.totals || {};
  if (
    !nearlyEqual(totals.subTotal, PRIOR_SUBTOTAL, 0.02) ||
    !nearlyEqual(totals.igst, PRIOR_GST, 0.02) ||
    !nearlyEqual(totals.grandTotal, PRIOR_GRAND, 0.02) ||
    !nearlyEqual(totals.totalQty, PRIOR_QTY, 0.05)
  ) {
    throw new Error(
      `${parent.grnNumber} totals ${totals.subTotal} / ${totals.igst} / ${totals.grandTotal} / qty ${totals.totalQty} do not match the printed GRN`
    );
  }

  return issueRevision(parent);
}

/**
 * Read-back so a second run is obvious.
 * @returns {Promise<Record<string, unknown>>}
 */
async function verify() {
  const active = await YarnGrn.find({ baseGrnNumber: GRN_BASE, status: 'active' })
    .select('grnNumber revisionNo totals.grandTotal totals.totalQty lots.lotNumber lots.netWeight lots.numberOfBoxes')
    .lean();
  const rejectedLive = await YarnBox.countDocuments({
    poNumber: PO_NUMBER,
    lotNumber: REJECTED_LOT,
    returnedToVendorAt: null,
  });
  return {
    active: active.map((grn) => ({
      grnNumber: grn.grnNumber,
      revisionNo: grn.revisionNo,
      grandTotal: grn.totals?.grandTotal,
      totalQty: grn.totals?.totalQty,
      lots: grn.lots,
    })),
    rejectedLiveBoxes: rejectedLive,
  };
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  logger.info(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);
  await connectMongo();
  const result = await fixGrn();
  const verification = await verify();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ apply: APPLY, result, verification }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.error(err);
  try {
    await mongoose.disconnect();
  } catch (disconnectErr) {
    logger.error(disconnectErr);
  }
  process.exit(1);
});
