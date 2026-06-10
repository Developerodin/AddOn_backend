#!/usr/bin/env node
/**
 * Reverts a failed/partial QC lot vendor-return so the lot can be re-processed via Return lot.
 *
 * Typical case: `finalizeQcLotReturn` updated lot → `lot_returned_to_vendor` then failed before
 * challan / vendor-return finalize (e.g. Mongo retryWrites on standalone).
 *
 * Usage:
 *   node scripts/revert-qc-lot-vendor-return.js --po=PO-2026-1204 --lot=94385-02062026
 *   node scripts/revert-qc-lot-vendor-return.js --po=PO-2026-1204 --lot=94385-02062026 --apply
 *   node scripts/revert-qc-lot-vendor-return.js --po=PO-2026-1204 --lot=94385-02062026 --apply --qc-remark="QC rejected at intake"
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import YarnPurchaseOrder from '../src/models/yarnReq/yarnPurchaseOrder.model.js';
import YarnPoVendorReturn from '../src/models/yarnReq/yarnPoVendorReturn.model.js';
import YarnPoReturnChallan from '../src/models/yarnReq/yarnPoReturnChallan.model.js';
import YarnBox from '../src/models/yarnReq/yarnBox.model.js';
import YarnCone from '../src/models/yarnReq/yarnCone.model.js';
import { connectMongooseForScript } from './lib/mongoScriptConnect.js';
import { syncInventoriesFromStorageForCatalogIds } from '../src/services/yarnManagement/yarnInventory.service.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

/**
 * @param {string} name
 * @returns {string}
 */
function readArg(name) {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? String(hit.slice(prefix.length)).trim() : '';
}

const PO_NUMBER = readArg('po');
const LOT_NUMBER = readArg('lot');
const QC_REMARK_OVERRIDE = readArg('qc-remark');

/**
 * @param {string} msg
 * @param {unknown} [data]
 */
function log(msg, data) {
  if (data === undefined) {
    console.log(msg);
    return;
  }
  console.log(msg, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
}

/**
 * @param {string | undefined} remarks
 * @returns {string}
 */
function stripReturnToVendorRemark(remarks) {
  const r = String(remarks || '').trim();
  if (/^Return to vendor:/i.test(r)) return '';
  return r;
}

/**
 * @param {Array<{ notes?: string }>} statusLogs
 * @param {string} lotNumber
 * @returns {string}
 */
function inferPriorQcRemark(statusLogs, lotNumber) {
  const ln = lotNumber.trim();
  const hits = (statusLogs || [])
    .map((e) => String(e?.notes || '').trim())
    .filter(
      (n) =>
        n &&
        n.includes(ln) &&
        /QC rejected|qc rejected/i.test(n) &&
        !/return to vendor/i.test(n)
    );
  return hits.length ? hits[hits.length - 1] : '';
}

/**
 * Adds back PO lot tallies reduced by cone-level vendor return lines.
 *
 * @param {import('mongoose').Document} purchaseOrder
 * @param {string} lotNumber
 * @param {object[]} coneLines
 */
function restoreReceivedLotsFromConeLines(purchaseOrder, lotNumber, coneLines) {
  const lot = (purchaseOrder.receivedLotDetails || []).find(
    (l) => String(l.lotNumber || '').trim() === lotNumber
  );
  if (!lot) return;

  const poItems = purchaseOrder.poItems || [];
  for (const snap of coneLines) {
    if (String(snap.lotNumber || '').trim() !== lotNumber) continue;
    if (typeof lot.numberOfCones === 'number') lot.numberOfCones += 1;
    const gw = Number(snap.grossWeight || snap.coneWeight || 0);
    if (gw > 0 && typeof lot.totalWeight === 'number') lot.totalWeight += gw;

    const lotPoItems = lot.poItems;
    if (!Array.isArray(lotPoItems) || !lotPoItems.length) continue;

    let targetIdx = -1;
    if (snap.yarnCatalogId) {
      targetIdx = lotPoItems.findIndex((p) => {
        const line = poItems.find((pi) => pi._id && String(pi._id) === String(p.poItem));
        return line?.yarnCatalogId && String(line.yarnCatalogId) === String(snap.yarnCatalogId);
      });
    }
    if (targetIdx < 0) targetIdx = 0;
    const row = lotPoItems[targetIdx];
    if (row && typeof row.receivedQuantity === 'number') row.receivedQuantity += 1;
  }
}

/**
 * Adds back PO lot tallies reduced by box-level vendor return lines.
 *
 * @param {import('mongoose').Document} purchaseOrder
 * @param {string} lotNumber
 * @param {object[]} boxLines
 */
function restoreReceivedLotsFromBoxLines(purchaseOrder, lotNumber, boxLines) {
  const lot = (purchaseOrder.receivedLotDetails || []).find(
    (l) => String(l.lotNumber || '').trim() === lotNumber
  );
  if (!lot) return;

  const poItems = purchaseOrder.poItems || [];
  for (const snap of boxLines) {
    if (String(snap.lotNumber || '').trim() !== lotNumber) continue;
    if (typeof lot.numberOfBoxes === 'number') lot.numberOfBoxes += 1;
    const coneN = Number(snap.numberOfCones || 0);
    if (coneN > 0 && typeof lot.numberOfCones === 'number') lot.numberOfCones += coneN;
    const gw = Number(snap.grossWeight || snap.boxWeight || 0);
    if (gw > 0 && typeof lot.totalWeight === 'number') lot.totalWeight += gw;

    const lotPoItems = lot.poItems;
    if (!Array.isArray(lotPoItems) || !lotPoItems.length) continue;

    let targetIdx = -1;
    if (snap.yarnCatalogId) {
      targetIdx = lotPoItems.findIndex((p) => {
        const line = poItems.find((pi) => pi._id && String(pi._id) === String(p.poItem));
        return line?.yarnCatalogId && String(line.yarnCatalogId) === String(snap.yarnCatalogId);
      });
    }
    if (targetIdx < 0) targetIdx = 0;
    const row = lotPoItems[targetIdx];
    const netKg = Number(snap.netWeight || 0);
    if (row && typeof row.receivedQuantity === 'number' && netKg > 0) {
      row.receivedQuantity += netKg;
    }
  }
}

/**
 * Finds vendor-return docs that reference this lot (lines, box lines, or ST pending barcodes).
 *
 * @param {string} poNumber
 * @param {string} lotNumber
 * @param {Set<string>} lotBarcodes
 * @returns {Promise<object[]>}
 */
async function findVendorReturnsForLot(poNumber, lotNumber, lotBarcodes) {
  const all = await YarnPoVendorReturn.find({ poNumber }).sort({ createdAt: -1 }).lean();
  const ln = lotNumber.trim();
  return all.filter((vr) => {
    if ((vr.lines || []).some((l) => String(l.lotNumber || '').trim() === ln)) return true;
    if ((vr.boxLines || []).some((l) => String(l.lotNumber || '').trim() === ln)) return true;
    if (
      vr.status === 'pending_session' &&
      (vr.pendingBarcodes || []).some((b) => lotBarcodes.has(String(b).trim()))
    ) {
      return true;
    }
    return false;
  });
}

/**
 * Collects barcodes for cones in this lot (for pending ST session cleanup).
 *
 * @param {string} poNumber
 * @param {string} lotNumber
 * @returns {Promise<Set<string>>}
 */
async function lotConeBarcodes(poNumber, lotNumber) {
  const boxes = await YarnBox.find({ poNumber, lotNumber }).select('boxId').lean();
  const boxIds = boxes.map((b) => b.boxId).filter(Boolean);
  const cones = await YarnCone.find({ poNumber, boxId: { $in: boxIds } }).select('barcode').lean();
  return new Set(cones.map((c) => String(c.barcode || '').trim()).filter(Boolean));
}

/**
 * @param {object} report
 * @returns {Promise<void>}
 */
async function applyRollback(report) {
  const { poNumber, lotNumber, purchaseOrder, vendorReturns, lotBarcodes, qcRemark } = report;
  const catalogIds = new Set();

  for (const vr of vendorReturns) {
    const vrId = vr._id;
    const coneLines = (vr.lines || []).filter((l) => String(l.lotNumber || '').trim() === lotNumber);
    const boxLines = (vr.boxLines || []).filter((l) => String(l.lotNumber || '').trim() === lotNumber);

    for (const line of coneLines) {
      const coneUpdate = {
        $set: { issueStatus: 'not_issued' },
        $unset: { returnedToVendorAt: '', vendorReturnId: '' },
      };
      const stBefore = String(line.coneStorageIdBefore || '').trim();
      if (stBefore) coneUpdate.$set.coneStorageId = stBefore;
      else coneUpdate.$unset.coneStorageId = '';

      await YarnCone.updateOne({ _id: line.coneId }, coneUpdate);
      if (line.yarnCatalogId) catalogIds.add(String(line.yarnCatalogId));
    }

    for (const line of boxLines) {
      const loc = String(line.storageLocationBefore || '').trim();
      await YarnBox.updateOne(
        { boxId: line.boxId },
        {
          $set: {
            storageLocation: loc || null,
            storedStatus: Boolean(loc),
          },
          $unset: { returnedToVendorAt: '', vendorReturnId: '' },
        }
      );
      if (line.yarnCatalogId) catalogIds.add(String(line.yarnCatalogId));

      await YarnCone.updateMany(
        { poNumber, boxId: line.boxId, vendorReturnId: vrId },
        {
          $set: { issueStatus: 'not_issued' },
          $unset: { returnedToVendorAt: '', vendorReturnId: '' },
        }
      );
    }

    const challan = await YarnPoReturnChallan.findOne({ vendorReturnId: vrId }).lean();
    if (challan) {
      await YarnPoReturnChallan.deleteOne({ _id: challan._id });
      log(`[apply] deleted challan ${challan.challanNumber}`);
    }

    const hasOnlyThisLot =
      (vr.lines || []).every((l) => String(l.lotNumber || '').trim() === lotNumber) &&
      (vr.boxLines || []).every((l) => String(l.lotNumber || '').trim() === lotNumber);

    if (vr.status === 'pending_session' && !hasOnlyThisLot && Array.isArray(vr.pendingBarcodes)) {
      const kept = vr.pendingBarcodes.filter((b) => !lotBarcodes.has(String(b).trim()));
      await YarnPoVendorReturn.updateOne({ _id: vrId }, { $set: { pendingBarcodes: kept } });
      log(`[apply] trimmed pending ST barcodes on vendor return ${vrId}`);
    } else {
      await YarnPoVendorReturn.deleteOne({ _id: vrId });
      log(`[apply] deleted vendor return ${vrId} (${vr.status})`);
    }

    restoreReceivedLotsFromConeLines(purchaseOrder, lotNumber, coneLines);
    restoreReceivedLotsFromBoxLines(purchaseOrder, lotNumber, boxLines);
  }

  const lotIdx = (purchaseOrder.receivedLotDetails || []).findIndex(
    (l) => String(l.lotNumber || '').trim() === lotNumber
  );
  if (lotIdx < 0) throw new Error(`Lot ${lotNumber} missing on PO`);

  purchaseOrder.receivedLotDetails[lotIdx].status = 'lot_rejected';
  purchaseOrder.receivedLotDetails[lotIdx].qcData = {
    ...(purchaseOrder.receivedLotDetails[lotIdx].qcData || {}),
    status: 'qc_rejected',
    date: new Date(),
    remarks: qcRemark,
  };
  purchaseOrder.markModified('receivedLotDetails');

  if (!purchaseOrder.statusLogs) purchaseOrder.statusLogs = [];
  purchaseOrder.statusLogs.push({
    statusCode: purchaseOrder.currentStatus,
    updatedBy: { username: 'revert-qc-lot-script' },
    updatedAt: new Date(),
    notes: `Script revert: lot ${lotNumber} restored to lot_rejected (QC rejected) for re-return.`,
  });

  await purchaseOrder.save();

  const boxQcSet = {
    'qcData.status': 'qc_rejected',
    'qcData.date': new Date(),
    'qcData.remarks': qcRemark,
  };
  const boxResult = await YarnBox.updateMany({ poNumber, lotNumber }, { $set: boxQcSet });
  log(`[apply] updated ${boxResult.modifiedCount ?? 0} box(es) qcData → qc_rejected`);

  if (catalogIds.size) {
    await syncInventoriesFromStorageForCatalogIds([...catalogIds]);
    log(`[apply] synced inventory for ${catalogIds.size} catalog id(s)`);
  }
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  if (!PO_NUMBER || !LOT_NUMBER) {
    console.error('Usage: node scripts/revert-qc-lot-vendor-return.js --po=PO-XXXX --lot=LOT [--apply] [--qc-remark=text]');
    process.exit(1);
  }

  const redactedUri = await connectMongooseForScript(config);
  log(`[revert-qc-lot-vendor-return] connected to ${redactedUri} (apply=${APPLY})`);

  const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber: PO_NUMBER });
  if (!purchaseOrder) throw new Error(`PO not found: ${PO_NUMBER}`);

  const lot = (purchaseOrder.receivedLotDetails || []).find(
    (l) => String(l.lotNumber || '').trim() === LOT_NUMBER
  );
  if (!lot) throw new Error(`Lot not found on PO: ${LOT_NUMBER}`);

  const lotBarcodes = await lotConeBarcodes(PO_NUMBER, LOT_NUMBER);
  const vendorReturns = await findVendorReturnsForLot(PO_NUMBER, LOT_NUMBER, lotBarcodes);
  const challans = [];
  for (const vr of vendorReturns) {
    const c = await YarnPoReturnChallan.findOne({ vendorReturnId: vr._id }).lean();
    if (c) challans.push(c);
  }

  const inferredRemark =
    QC_REMARK_OVERRIDE ||
    stripReturnToVendorRemark(lot.qcData?.remarks) ||
    inferPriorQcRemark(purchaseOrder.statusLogs, LOT_NUMBER) ||
    'QC rejected';

  const activeBoxes = await YarnBox.countDocuments({
    poNumber: PO_NUMBER,
    lotNumber: LOT_NUMBER,
    $or: [{ returnedToVendorAt: { $exists: false } }, { returnedToVendorAt: null }],
  });
  const archivedBoxes = await YarnBox.countDocuments({
    poNumber: PO_NUMBER,
    lotNumber: LOT_NUMBER,
    returnedToVendorAt: { $ne: null },
  });

  log('\n--- Current state ---');
  log(`PO: ${PO_NUMBER}  currentStatus: ${purchaseOrder.currentStatus}`);
  log(`Lot: ${LOT_NUMBER}  status: ${lot.status}`);
  log(`Lot qcData:`, lot.qcData || null);
  log(`Boxes active/archived: ${activeBoxes} / ${archivedBoxes}`);
  log(`Vendor return doc(s): ${vendorReturns.length}`);
  for (const vr of vendorReturns) {
    log(`  - ${vr._id} status=${vr.status} remark=${vr.remark} cones=${vr.lines?.length || 0} boxes=${vr.boxLines?.length || 0}`);
  }
  log(`Challan(s): ${challans.length}`, challans.map((c) => c.challanNumber));

  if (lot.status !== 'lot_returned_to_vendor' && vendorReturns.length === 0 && archivedBoxes === 0) {
    log('\n[skip] Lot is not lot_returned_to_vendor and no vendor-return artifacts found. Nothing to revert.');
    await mongoose.disconnect();
    return;
  }

  log('\n--- Planned changes ---');
  log(`Lot status: ${lot.status} → lot_rejected`);
  log(`Lot/box qcData.status → qc_rejected`);
  log(`QC remark → "${inferredRemark}"`);
  if (vendorReturns.length) log(`Remove ${vendorReturns.length} vendor return doc(s) and ${challans.length} challan(s) for this lot`);
  if (archivedBoxes) log(`Un-archive ${archivedBoxes} box(es) if linked to vendor returns`);

  if (!APPLY) {
    log('\n[dry-run] Pass --apply to write changes.');
    await mongoose.disconnect();
    return;
  }

  await applyRollback({
    poNumber: PO_NUMBER,
    lotNumber: LOT_NUMBER,
    purchaseOrder,
    vendorReturns,
    lotBarcodes,
    qcRemark: inferredRemark,
  });

  const after = await YarnPurchaseOrder.findOne({ poNumber: PO_NUMBER }).lean();
  const afterLot = (after?.receivedLotDetails || []).find(
    (l) => String(l.lotNumber || '').trim() === LOT_NUMBER
  );
  log('\n[done] Lot restored:', {
    status: afterLot?.status,
    qcStatus: afterLot?.qcData?.status,
    remarks: afterLot?.qcData?.remarks,
  });
  log('Re-run Return lot on Yarn QC process page after deploying retryWrites fix.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
