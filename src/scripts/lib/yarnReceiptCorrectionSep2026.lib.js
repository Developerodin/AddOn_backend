/**
 * Box-level corrections for the confirmed Sep 2026 yarn receipt mistakes.
 * GRN 263 revision lives in yarnReceiptCorrectionSep2026.grn.js.
 */
import { YarnBox, YarnCatalog, YarnCone, YarnGrn, YarnPurchaseOrder, YarnTransaction } from '../../models/index.js';
import { syncInventoriesFromStorageForCatalogIds } from '../../services/yarnManagement/yarnInventory.service.js';
import { fixGrn263 } from './yarnReceiptCorrectionSep2026.grn.js';
import {
  REJECTED_PO,
  REJECTED_LOT,
  REJECTED_YARN,
  REJECTED_BOX_COUNT,
  REJECTED_NET_KG,
  BEIGE_GRN_BASE,
  BEIGE_GRN_KEEP,
  NAVY_PO,
  NAVY_LOT,
  NAVY_ORPHAN_BOX_ID,
  NAVY_REPLACEMENT_LOT,
  NAVY_NET,
  NAVY_CONES,
  NOT_RETURNED,
  nearlyEqual,
  hasStorage,
  writeCount,
} from './yarnReceiptCorrectionSep2026.shared.js';

let applyWrites = false;

/**
 * @param {boolean} apply
 * @returns {void}
 */
export function setCorrectionApply(apply) {
  applyWrites = Boolean(apply);
}

/**
 * @returns {boolean}
 */
function writesEnabled() {
  return applyWrites;
}

/**
 * Persist YarnInventory from live boxes for the yarns this script touches.
 * @param {string[]} yarnNames
 * @returns {Promise<string[]>}
 */
async function syncCatalogsByYarnName(yarnNames) {
  const catalogs = await YarnCatalog.find({ yarnName: { $in: yarnNames } }).select('_id yarnName').lean();
  const ids = catalogs.map((c) => c._id);
  if (ids.length && writesEnabled()) {
    await syncInventoriesFromStorageForCatalogIds(ids);
  }
  return catalogs.map((c) => c.yarnName);
}

/**
 * Take the 13 rejected Birla Modal boxes off live stock.
 * @param {Date} returnedAt
 * @returns {Promise<Record<string, unknown>>}
 */
async function fixRejectedLot(returnedAt) {
  const boxes = await YarnBox.find({
    poNumber: REJECTED_PO,
    lotNumber: REJECTED_LOT,
    yarnName: REJECTED_YARN,
    'qcData.status': 'qc_rejected',
    ...NOT_RETURNED,
  }).lean();

  if (boxes.length === 0) {
    const already = await YarnBox.countDocuments({
      poNumber: REJECTED_PO,
      lotNumber: REJECTED_LOT,
      returnedToVendorAt: { $ne: null },
    });
    if (already === REJECTED_BOX_COUNT) {
      return { step: 'rejected-lot', status: 'already_done', boxes: already };
    }
  }

  if (boxes.length !== REJECTED_BOX_COUNT) {
    throw new Error(
      `${REJECTED_PO} lot ${REJECTED_LOT}: expected ${REJECTED_BOX_COUNT} live rejected boxes, found ${boxes.length}`
    );
  }

  const stored = boxes.filter((b) => hasStorage(b.storageLocation));
  if (stored.length) {
    throw new Error(`Refusing to return ${stored.length} rejected boxes that already have a storage location`);
  }

  const net = boxes.reduce((sum, b) => sum + Number(b.boxWeight || 0), 0);
  if (!nearlyEqual(net, REJECTED_NET_KG, 0.05)) {
    throw new Error(`Rejected lot net is ${net} kg, expected ${REJECTED_NET_KG}`);
  }

  const boxIds = boxes.map((b) => b.boxId);
  const coneCount = await YarnCone.countDocuments({ boxId: { $in: boxIds } });
  if (coneCount) {
    throw new Error(`Rejected lot has ${coneCount} cones. Refusing to mark boxes returned.`);
  }

  const preview = {
    step: 'rejected-lot',
    status: writesEnabled() ? 'updated' : 'would_update',
    poNumber: REJECTED_PO,
    lotNumber: REJECTED_LOT,
    boxes: boxes.length,
    netKg: net,
    boxIds,
  };

  if (!writesEnabled()) return preview;

  const res = await YarnBox.updateMany(
    { _id: { $in: boxes.map((b) => b._id) }, returnedToVendorAt: null },
    {
      $set: {
        boxWeight: 0,
        grossWeight: 0,
        numberOfCones: 0,
        storedStatus: false,
        storageLocation: '',
        returnedToVendorAt: returnedAt,
        'coneData.conesIssued': false,
        'coneData.numberOfCones': 0,
        'coneData.coneIssueDate': null,
      },
    }
  );
  const modified = writeCount(res);
  if (modified !== REJECTED_BOX_COUNT) {
    throw new Error(`Rejected-lot update modified ${modified}, expected ${REJECTED_BOX_COUNT}`);
  }
  preview.modifiedCount = modified;
  return preview;
}

/**
 * Count yarn transactions that mention this box.
 * @param {{ boxId: string, barcode?: string }} box
 * @returns {Promise<number>}
 */
async function countBoxTransactions(box) {
  return YarnTransaction.countDocuments({
    $or: [{ boxIds: box.boxId }, { orderno: box.boxId }, { boxIds: box.barcode }],
  });
}

/**
 * Delete the duplicate navy carton. The stored replacement box must already exist.
 * Does not change PO lot box counts.
 * @returns {Promise<Record<string, unknown>>}
 */
async function fixOrphanNavyBox() {
  const replacementCandidates = await YarnBox.find({
    poNumber: NAVY_PO,
    lotNumber: NAVY_REPLACEMENT_LOT,
    ...NOT_RETURNED,
  }).lean();
  const replacement = replacementCandidates.find(
    (b) => nearlyEqual(b.boxWeight, NAVY_NET) && Number(b.numberOfCones) === NAVY_CONES && hasStorage(b.storageLocation)
  );
  if (!replacement) {
    throw new Error(`Replacement box on lot ${NAVY_REPLACEMENT_LOT} (${NAVY_NET} kg, in storage) was not found`);
  }

  const box = await YarnBox.findOne({ boxId: NAVY_ORPHAN_BOX_ID }).lean();
  if (!box) {
    return {
      step: 'navy-orphan-box',
      status: 'already_done',
      replacementBoxId: replacement.boxId,
      replacementLocation: replacement.storageLocation,
    };
  }

  if (box.poNumber !== NAVY_PO || box.lotNumber !== NAVY_LOT) {
    throw new Error(`Orphan box ${NAVY_ORPHAN_BOX_ID} is on ${box.poNumber} / ${box.lotNumber}`);
  }
  if (!nearlyEqual(box.boxWeight, NAVY_NET) || Number(box.numberOfCones) !== NAVY_CONES) {
    throw new Error(`Orphan box weight/cones are ${box.boxWeight} / ${box.numberOfCones}, expected ${NAVY_NET} / ${NAVY_CONES}`);
  }
  if (hasStorage(box.storageLocation)) {
    throw new Error(`Orphan box has storage location ${box.storageLocation}. Refusing to delete a stored carton.`);
  }

  const coneCount = await YarnCone.countDocuments({ boxId: box.boxId });
  const txCount = await countBoxTransactions(box);
  if (coneCount || txCount) {
    throw new Error(`Orphan box has ${coneCount} cones and ${txCount} transactions. Refusing to delete.`);
  }

  const preview = {
    step: 'navy-orphan-box',
    status: writesEnabled() ? 'deleted' : 'would_delete',
    boxId: box.boxId,
    barcode: box.barcode,
    netKg: box.boxWeight,
    replacementBoxId: replacement.boxId,
    replacementLocation: replacement.storageLocation,
    poLotBoxCountUntouched: true,
  };
  if (!writesEnabled()) return preview;

  const res = await YarnBox.deleteOne({ _id: box._id, boxId: NAVY_ORPHAN_BOX_ID });
  if (writeCount(res) !== 1) throw new Error(`Delete of ${NAVY_ORPHAN_BOX_ID} removed ${writeCount(res)} rows`);
  return preview;
}

/**
 * Read-back so a second run, or a bad fingerprint, is obvious.
 * @returns {Promise<Record<string, unknown>>}
 */
async function verify() {
  const rejectedLive = await YarnBox.countDocuments({
    poNumber: REJECTED_PO,
    lotNumber: REJECTED_LOT,
    boxWeight: { $gt: 0 },
    ...NOT_RETURNED,
  });
  const activeGrn = await YarnGrn.findOne({ baseGrnNumber: BEIGE_GRN_BASE, status: 'active' })
    .select('grnNumber totals.totalQty lots.numberOfBoxes lots.netWeight')
    .lean();
  const grn268 = await YarnGrn.findOne({ grnNumber: BEIGE_GRN_KEEP, status: 'active' })
    .select('lots.numberOfBoxes lots.netWeight')
    .lean();
  const orphan = await YarnBox.countDocuments({ boxId: NAVY_ORPHAN_BOX_ID });
  const po1268 = await YarnPurchaseOrder.findOne({ poNumber: NAVY_PO }).select('receivedLotDetails').lean();
  const navyLot = (po1268?.receivedLotDetails || []).find((l) => l.lotNumber === NAVY_LOT);
  const po1310 = await YarnPurchaseOrder.findOne({ poNumber: 'PO-2026-1310' }).select('poNumber currentStatus').lean();

  return {
    rejectedLiveBoxes: rejectedLive,
    activeGrn263: activeGrn
      ? { grnNumber: activeGrn.grnNumber, totalQty: activeGrn.totals?.totalQty, lots: activeGrn.lots }
      : null,
    grn268Boxes: grn268?.lots?.[0]?.numberOfBoxes ?? null,
    orphanBoxStillExists: orphan > 0,
    po1268LotMu2607754Boxes: navyLot?.numberOfBoxes ?? null,
    po1310Status: po1310?.currentStatus ?? null,
  };
}

/**
 * Delete blank cartons the Process button regenerated for the rejected lot.
 * Returned boxes are hidden, so that button treated the lot as having zero boxes and inserted 13 empty ones.
 * @returns {Promise<Record<string, unknown>>}
 */
async function removeRegeneratedEmptyShells() {
  const candidates = await YarnBox.find({
    poNumber: REJECTED_PO,
    lotNumber: REJECTED_LOT,
    ...NOT_RETURNED,
  }).lean();

  const empty = [];
  for (const box of candidates) {
    const weight = Number(box.boxWeight || 0);
    const cones = Number(box.numberOfCones || 0);
    if (weight > 0 || cones > 0 || hasStorage(box.storageLocation) || box.qcData?.status) continue;
    const coneDocs = await YarnCone.countDocuments({ boxId: box.boxId });
    const txCount = await countBoxTransactions(box);
    if (coneDocs || txCount) {
      throw new Error(`Box ${box.boxId} looks empty but has ${coneDocs} cones and ${txCount} transactions`);
    }
    empty.push(box);
  }

  if (!empty.length) return { step: 'empty-shells', status: 'none' };

  const preview = {
    step: 'empty-shells',
    status: writesEnabled() ? 'deleted' : 'would_delete',
    boxes: empty.length,
    boxIds: empty.map((b) => b.boxId),
  };
  if (!writesEnabled()) return preview;

  const res = await YarnBox.deleteMany({ _id: { $in: empty.map((b) => b._id) } });
  const removed = writeCount(res);
  if (removed !== empty.length) {
    throw new Error(`Deleted ${removed} empty shells, expected ${empty.length}`);
  }
  return preview;
}

const STOCK_CORRECTION_MARKER = '[STOCK CORRECTION]';
const STOCK_CORRECTION_NOTE =
  '[STOCK CORRECTION] Lot 10730-19092026 (13 bags, 650 kg) was booked as 30s Light Grey Melange Cotton Birla Modal, shade DM68503-I. The yarn received was 30s Light Grey Melange Combed Melange, same shade. QC rejected it. Those boxes were removed from unallocated stock. The correct receipt is PO-2026-1310, lot 10730-19.09.2026 (13 bags, 650 kg, accepted). Do not create new boxes for this rejected lot.';

/**
 * Leave a visible note on PO 1287 so the rejected lot is not treated as missing stock later.
 * @returns {Promise<Record<string, unknown>>}
 */
async function addRejectedLotRemark() {
  const po = await YarnPurchaseOrder.findOne({ poNumber: REJECTED_PO }).select('notes receivedLotDetails').lean();
  if (!po) throw new Error(`${REJECTED_PO} not found`);

  const lot = (po.receivedLotDetails || []).find((row) => row.lotNumber === REJECTED_LOT);
  if (!lot || lot.status !== 'lot_rejected') {
    throw new Error(`${REJECTED_PO} lot ${REJECTED_LOT} is not lot_rejected`);
  }

  const alreadyNoted = String(po.notes || '').includes(STOCK_CORRECTION_MARKER);
  const currentRemark = String(lot.qcData?.remarks || '');
  const alreadyOnLot = currentRemark.includes('PO-2026-1310');
  if (alreadyNoted && alreadyOnLot) {
    return { step: 'po-1287-remark', status: 'already_done' };
  }

  const notes = alreadyNoted
    ? po.notes
    : [String(po.notes || '').trim(), STOCK_CORRECTION_NOTE].filter(Boolean).join('\n\n');
  const remarks = alreadyOnLot
    ? currentRemark
    : `${currentRemark.trim()} Boxes removed from live stock. Correct article is on PO-2026-1310, lot 10730-19.09.2026.`.trim();

  const preview = { step: 'po-1287-remark', status: writesEnabled() ? 'updated' : 'would_update', notes, remarks };
  if (!writesEnabled()) return preview;

  const res = await YarnPurchaseOrder.updateOne(
    { _id: po._id },
    {
      $set: {
        notes,
        linkedReplacementPoNumber: 'PO-2026-1310',
        returnReferenceNotes: STOCK_CORRECTION_NOTE,
        'receivedLotDetails.$[lot].qcData.remarks': remarks,
      },
    },
    { arrayFilters: [{ 'lot.lotNumber': REJECTED_LOT }] }
  );
  if (writeCount(res) < 1 && !alreadyNoted) {
    throw new Error(`PO remark update did not modify ${REJECTED_PO}`);
  }
  return preview;
}

/**
 * Run all three confirmed corrections and return the preview or write result.
 * @param {Date} returnedAt
 * @returns {Promise<{ results: Record<string, unknown>[], verification: Record<string, unknown> }>}
 */
export async function runConfirmedYarnReceiptCorrections(returnedAt) {
  const results = [
    await fixRejectedLot(returnedAt),
    await addRejectedLotRemark(),
    await removeRegeneratedEmptyShells(),
    await fixGrn263(writesEnabled()),
    await fixOrphanNavyBox(),
  ];
  if (writesEnabled()) {
    const synced = await syncCatalogsByYarnName([
      REJECTED_YARN,
      '2/40s-Navy-Navy-Cotton/Gassed Mercerized Cotton',
    ]);
    results.push({ step: 'inventory-sync', status: 'synced', yarnNames: synced });
  }
  const verification = await verify();
  return { results, verification };
}

