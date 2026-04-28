import mongoose from 'mongoose';
import { YarnBox, YarnCone, YarnTransaction } from '../../models/index.js';
import { LT_SECTION_CODES } from '../../models/storageManagement/storageSlot.model.js';
import { yarnConeUnavailableIssueStatuses } from '../../models/yarnReq/yarnCone.model.js';

const toNum = (v) => Number(v ?? 0);
const LT_STORAGE_PATTERN = new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i');

/**
 * PO audit: show box "initial" weight (from yarn_stocked txn), current box state,
 * cones in short-term (by coneStorageId), and classify boxes:
 * - remainingInLongTerm: box has LT storageLocation + storedStatus true + boxWeight > 0
 * - transferredToShortTerm: has >=1 cone with coneStorageId set
 * - inconsistent: e.g. has ST cones but (no storageLocation) while boxWeight > 0
 *
 * @param {Object} params
 * @param {string} params.poNumber
 * @returns {Promise<{ poNumber: string, totals: Object, boxes: Array, inconsistent: Array, remainingInLongTerm: Array, transferredToShortTerm: Array }>}
 */
export async function getPoBoxAuditReport({ poNumber }) {
  const normalizedPo = String(poNumber || '').trim();
  if (!normalizedPo) throw new Error('poNumber is required');

  const boxes = await YarnBox.find({ poNumber: normalizedPo })
    .select('boxId poNumber lotNumber yarnName shadeCode boxWeight tearweight grossWeight storageLocation storedStatus coneData createdAt updatedAt')
    .sort({ createdAt: 1 })
    .lean();

  const boxIds = boxes.map((b) => b.boxId).filter(Boolean);

  const [stConesAgg, stockedTxnsAgg] = await Promise.all([
    YarnCone.aggregate([
      {
        $match: {
          poNumber: normalizedPo,
          boxId: { $in: boxIds },
          coneStorageId: { $exists: true, $nin: [null, ''] },
          issueStatus: { $nin: yarnConeUnavailableIssueStatuses },
        },
      },
      {
        $group: {
          _id: '$boxId',
          coneCount: { $sum: 1 },
          totalConeWeight: { $sum: '$coneWeight' },
          totalConeTare: { $sum: '$tearWeight' },
          storages: { $addToSet: '$coneStorageId' },
        },
      },
    ]),
    YarnTransaction.aggregate([
      {
        $match: {
          transactionType: 'yarn_stocked',
          orderno: { $in: boxIds },
        },
      },
      { $sort: { transactionDate: -1, createdAt: -1 } },
      {
        $group: {
          _id: '$orderno',
          stockedAt: { $first: '$transactionDate' },
          initialTotalWeight: { $first: '$transactionTotalWeight' },
          initialTearWeight: { $first: '$transactionTearWeight' },
          initialNetWeight: { $first: '$transactionNetWeight' },
        },
      },
    ]),
  ]);

  const stByBox = new Map(
    (stConesAgg || []).map((r) => [
      r._id,
      {
        coneCount: toNum(r.coneCount),
        totalConeWeight: toNum(r.totalConeWeight),
        totalConeTare: toNum(r.totalConeTare),
        totalConeNetWeight: Math.max(0, toNum(r.totalConeWeight) - toNum(r.totalConeTare)),
        coneStorageIds: (r.storages || []).filter(Boolean).sort(),
      },
    ])
  );

  const stockedByBox = new Map(
    (stockedTxnsAgg || []).map((r) => [
      r._id,
      {
        stockedAt: r.stockedAt,
        initialTotalWeight: toNum(r.initialTotalWeight),
        initialTearWeight: toNum(r.initialTearWeight),
        initialNetWeight: toNum(r.initialNetWeight),
      },
    ])
  );

  const rows = boxes.map((b) => {
    const boxId = String(b.boxId || '').trim();
    const st = stByBox.get(boxId) || {
      coneCount: 0,
      totalConeWeight: 0,
      totalConeTare: 0,
      totalConeNetWeight: 0,
      coneStorageIds: [],
    };
    const stocked = stockedByBox.get(boxId) || {
      stockedAt: null,
      initialTotalWeight: null,
      initialTearWeight: null,
      initialNetWeight: null,
    };

    const boxWeight = toNum(b.boxWeight);
    const boxTare = toNum(b.tearweight);
    const netBoxWeight = Math.max(0, boxWeight - boxTare);

    const storageLocation = b.storageLocation == null ? '' : String(b.storageLocation).trim();
    const hasLTLocation = storageLocation && LT_STORAGE_PATTERN.test(storageLocation);
    const hasAnyLocation = Boolean(storageLocation);
    const hasSTCones = st.coneCount > 0;

    const remainingInLongTerm = hasLTLocation && b.storedStatus === true && boxWeight > 0;
    const transferredToShortTerm = hasSTCones;

    const inconsistentReasons = [];
    if (hasSTCones && !hasAnyLocation && boxWeight > 0) {
      inconsistentReasons.push('st_cones_exist_but_box_has_no_storageLocation_and_boxWeight_gt_0');
    }
    if (hasSTCones && b.storedStatus === false && hasLTLocation && boxWeight > 0) {
      inconsistentReasons.push('lt_location_present_but_storedStatus_false_with_boxWeight_gt_0');
    }
    if (!hasAnyLocation && boxWeight > 0 && b.storedStatus === true) {
      inconsistentReasons.push('storedStatus_true_but_storageLocation_missing');
    }
    // Fully transferred should be boxWeight=0 and storageLocation unset. If not, flag.
    if (hasSTCones && stocked.initialTotalWeight != null) {
      const fullyTransferredByInitial = st.totalConeWeight >= toNum(stocked.initialTotalWeight) - 0.001;
      if (fullyTransferredByInitial && boxWeight > 0) {
        inconsistentReasons.push('st_cones_weight_matches_initial_stocked_weight_but_boxWeight_not_zero');
      }
    }

    return {
      boxId,
      lotNumber: b.lotNumber,
      yarnName: b.yarnName,
      shadeCode: b.shadeCode,
      storageLocation: storageLocation || null,
      storedStatus: b.storedStatus,
      boxWeight,
      tearweight: boxTare,
      netBoxWeight,
      grossWeight: b.grossWeight,
      conesIssued: b.coneData?.conesIssued,
      shortTerm: st,
      stocked,
      flags: {
        remainingInLongTerm,
        transferredToShortTerm,
        inconsistent: inconsistentReasons.length > 0,
      },
      inconsistentReasons,
      updatedAt: b.updatedAt,
      createdAt: b.createdAt,
    };
  });

  const inconsistent = rows.filter((r) => r.flags.inconsistent);
  const remainingInLongTerm = rows.filter((r) => r.flags.remainingInLongTerm);
  const transferredToShortTerm = rows.filter((r) => r.flags.transferredToShortTerm);

  const totals = {
    totalBoxes: rows.length,
    remainingInLongTerm: remainingInLongTerm.length,
    transferredToShortTerm: transferredToShortTerm.length,
    inconsistent: inconsistent.length,
    totalCurrentBoxWeight: rows.reduce((s, r) => s + toNum(r.boxWeight), 0),
    totalShortTermConeWeight: rows.reduce((s, r) => s + toNum(r.shortTerm.totalConeWeight), 0),
  };

  return {
    poNumber: normalizedPo,
    totals,
    boxes: rows,
    inconsistent,
    remainingInLongTerm,
    transferredToShortTerm,
  };
}

