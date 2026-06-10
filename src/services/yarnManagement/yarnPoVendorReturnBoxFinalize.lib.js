import httpStatus from 'http-status';
import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import YarnPoVendorReturn from '../../models/yarnReq/yarnPoVendorReturn.model.js';
import YarnPurchaseOrder from '../../models/yarnReq/yarnPurchaseOrder.model.js';
import YarnCone from '../../models/yarnReq/yarnCone.model.js';
import YarnBox from '../../models/yarnReq/yarnBox.model.js';
import { activeYarnBoxMatch, activeYarnConeMatch } from './yarnStockActiveFilters.js';
import { syncInventoriesFromStorageForCatalogIds } from './yarnInventory.service.js';
import * as yarnPoReturnChallanService from './yarnPoReturnChallan.service.js';
import {
  isTransactionUnsupportedError,
  normaliseVendorReturnActor,
} from './yarnPoVendorReturnFinalize.lib.js';

/**
 * Adjusts PO received lot subdocuments after box-level vendor return.
 *
 * @param {import('mongoose').Document} purchaseOrder
 * @param {Array<{ lotNumber?: string, grossWeight?: number, netWeight?: number, numberOfCones?: number, yarnCatalogId?: import('mongoose').Types.ObjectId }>} boxLines
 * @returns {void}
 */
export function applyBoxReturnToReceivedLots(purchaseOrder, boxLines) {
  const lots = purchaseOrder.receivedLotDetails;
  if (!Array.isArray(lots) || lots.length === 0) return;

  const poItems = purchaseOrder.poItems || [];

  for (const snap of boxLines) {
    const ln = String(snap.lotNumber || '').trim();
    if (!ln) continue;

    const lot = lots.find((l) => String(l.lotNumber || '').trim() === ln);
    if (!lot) continue;

    if (typeof lot.numberOfBoxes === 'number') {
      lot.numberOfBoxes = Math.max(0, lot.numberOfBoxes - 1);
    }
    const coneN = Number(snap.numberOfCones || 0);
    if (coneN > 0 && typeof lot.numberOfCones === 'number') {
      lot.numberOfCones = Math.max(0, lot.numberOfCones - coneN);
    }
    const gw = Number(snap.grossWeight || snap.boxWeight || 0);
    if (gw > 0 && typeof lot.totalWeight === 'number') {
      lot.totalWeight = Math.max(0, lot.totalWeight - gw);
    }

    const lotPoItems = lot.poItems;
    if (!Array.isArray(lotPoItems) || lotPoItems.length === 0) continue;

    let targetIdx = -1;
    if (snap.yarnCatalogId) {
      targetIdx = lotPoItems.findIndex((p) => {
        const line = poItems.find((pi) => pi._id && String(pi._id) === String(p.poItem));
        return line && line.yarnCatalogId && String(line.yarnCatalogId) === String(snap.yarnCatalogId);
      });
    }
    if (targetIdx < 0) targetIdx = 0;

    const row = lotPoItems[targetIdx];
    const netKg = Number(snap.netWeight || 0);
    if (row && typeof row.receivedQuantity === 'number' && netKg > 0) {
      row.receivedQuantity = Math.max(0, row.receivedQuantity - netKg);
    }
  }
}

/**
 * Archives LT boxes (and any cones on those boxes), completes vendor return, issues challan.
 *
 * @param {{
 *   returnDocId: import('mongoose').Types.ObjectId,
 *   boxLinePayloads: object[],
 *   poNumber: string,
 *   cancellationIntent: 'partial'|'full_po',
 *   remark: string,
 *   actor: { user: import('mongoose').Types.ObjectId | null, username: string },
 *   user?: { userId?: string, username?: string },
 * }} params
 * @returns {Promise<{ vendorReturn: object|null, purchaseOrder: object|null, challan: object|null }>}
 */
export async function archiveBoxesAndCompleteReturn(params) {
  const { returnDocId, boxLinePayloads, poNumber, cancellationIntent, remark, actor, user } = params;

  if (!boxLinePayloads.length) {
    return { vendorReturn: null, purchaseOrder: null, challan: null };
  }

  const now = new Date();
  const boxIds = boxLinePayloads.map((b) => b.boxId).filter(Boolean);
  const linesForDoc = boxLinePayloads.map((b) => ({
    boxId: b.boxId,
    lotNumber: b.lotNumber,
    yarnCatalogId: b.yarnCatalogId,
    yarnName: b.yarnName,
    shadeCode: b.shadeCode,
    numberOfCones: b.numberOfCones,
    boxWeight: b.boxWeight,
    tearWeight: b.tearWeight,
    netWeight: b.netWeight,
    storageLocationBefore: b.storageLocationBefore,
  }));
  const totalNetWeight = boxLinePayloads.reduce((s, b) => s + Number(b.netWeight || 0), 0);
  const catalogIdSet = new Set(
    boxLinePayloads.filter((b) => b.yarnCatalogId).map((b) => String(b.yarnCatalogId))
  );

  const applyFinalizeMutations = async (mongoSession) => {
    const opts = mongoSession ? { session: mongoSession } : {};

    const coneArchive = {
      returnedToVendorAt: now,
      vendorReturnId: returnDocId,
      issueStatus: 'returned_to_vendor',
      coneStorageId: null,
    };

    await YarnCone.updateMany(
      { poNumber, boxId: { $in: boxIds }, ...activeYarnConeMatch },
      { $set: coneArchive },
      opts
    );

    for (const line of boxLinePayloads) {
      const updated = await YarnBox.findOneAndUpdate(
        { boxId: line.boxId, ...activeYarnBoxMatch },
        {
          $set: {
            returnedToVendorAt: now,
            vendorReturnId: returnDocId,
            storageLocation: null,
            storedStatus: false,
          },
        },
        { new: true, ...opts }
      ).exec();
      if (!updated) {
        throw new Error(`Box ${line.boxId} could not be archived — it may already be returned.`);
      }
    }

    const completedBy = { username: actor.username, user: actor.user };
    const setDoc = {
      status: 'completed',
      boxLines: linesForDoc,
      lines: [],
      pendingBarcodes: [],
      boxCount: boxLinePayloads.length,
      coneCount: 0,
      totalNetWeight,
      completedAt: now,
      completedBy,
    };

    await YarnPoVendorReturn.findByIdAndUpdate(returnDocId, { $set: setDoc }, opts);

    const purchaseOrder = mongoSession
      ? await YarnPurchaseOrder.findOne({ poNumber }).session(mongoSession)
      : await YarnPurchaseOrder.findOne({ poNumber });
    if (purchaseOrder) {
      applyBoxReturnToReceivedLots(purchaseOrder, boxLinePayloads);
      purchaseOrder.vendorReturnRequiresErpCancellation = true;
      purchaseOrder.lastVendorReturnCancellationIntent = cancellationIntent;
      purchaseOrder.lastVendorReturnId = returnDocId;

      if (actor.user) {
        if (!purchaseOrder.statusLogs) purchaseOrder.statusLogs = [];
        purchaseOrder.statusLogs.push({
          statusCode: purchaseOrder.currentStatus,
          updatedBy: {
            username: actor.username,
            user: actor.user,
          },
          updatedAt: now,
          notes: `Vendor return finalized: ${boxLinePayloads.length} box(es). ${remark} ERP: ${cancellationIntent}.`,
        });
      }

      await purchaseOrder.save(opts);
    }
  };

  const mongoSession = await mongoose.startSession();
  try {
    mongoSession.startTransaction();
    try {
      await applyFinalizeMutations(mongoSession);
      await mongoSession.commitTransaction();
    } catch (inner) {
      await mongoSession.abortTransaction().catch(() => {});
      throw inner;
    }
  } catch (err) {
    if (isTransactionUnsupportedError(err)) {
      // eslint-disable-next-line no-console
      console.warn('[yarnPoVendorReturn] Mongo transaction unavailable; finalizing boxes without transaction');
      await applyFinalizeMutations(null);
    } else {
      throw err;
    }
  } finally {
    await mongoSession.endSession().catch(() => {});
  }

  await syncInventoriesFromStorageForCatalogIds([...catalogIdSet]);

  const populated = await YarnPoVendorReturn.findById(returnDocId).lean();
  const purchaseOrderAfter = await YarnPurchaseOrder.findOne({ poNumber });
  const poOut = purchaseOrderAfter ? purchaseOrderAfter.toJSON() : null;

  const challan = await yarnPoReturnChallanService.createChallanFromVendorReturn(
    populated,
    purchaseOrderAfter,
    user || {}
  );

  return { vendorReturn: populated, purchaseOrder: poOut, challan };
}

/**
 * Creates a completed vendor return for LT boxes in one step.
 *
 * @param {{
 *   poNumber: string,
 *   boxLinePayloads: object[],
 *   remark: string,
 *   cancellationIntent: 'partial'|'full_po',
 *   user?: { userId?: string, username?: string },
 * }} params
 * @returns {Promise<{ vendorReturn: object|null, challan: object|null, autoReturnedBoxCount: number }>}
 */
export async function autoFinalizeLtBoxes(params) {
  const boxLinePayloads = params.boxLinePayloads || [];
  if (!boxLinePayloads.length) {
    return { vendorReturn: null, challan: null, autoReturnedBoxCount: 0 };
  }

  const poNumber = String(params.poNumber || '').trim();
  const po = await YarnPurchaseOrder.findOne({ poNumber }).select('_id').lean();
  if (!po) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  const actor = normaliseVendorReturnActor(params.user || {});
  const remark = String(params.remark || '').trim();
  const qcRemark = remark ? `QC box return — ${remark}` : 'QC box return';

  const returnDoc = await YarnPoVendorReturn.create({
    poNumber,
    purchaseOrder: po._id,
    status: 'pending_session',
    remark: qcRemark,
    cancellationIntent: params.cancellationIntent,
    pendingBarcodes: [],
    createdBy: { username: actor.username, user: actor.user },
  });

  const result = await archiveBoxesAndCompleteReturn({
    returnDocId: returnDoc._id,
    boxLinePayloads,
    poNumber,
    cancellationIntent: params.cancellationIntent,
    remark: qcRemark,
    actor,
    user: params.user,
  });

  return {
    vendorReturn: result.vendorReturn,
    challan: result.challan,
    autoReturnedBoxCount: boxLinePayloads.length,
  };
}
