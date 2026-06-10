import mongoose from 'mongoose';
import httpStatus from 'http-status';
import YarnPoVendorReturn from '../../models/yarnReq/yarnPoVendorReturn.model.js';
import YarnPurchaseOrder from '../../models/yarnReq/yarnPurchaseOrder.model.js';
import YarnCone from '../../models/yarnReq/yarnCone.model.js';
import YarnBox from '../../models/yarnReq/yarnBox.model.js';
import ApiError from '../../utils/ApiError.js';
import { activeYarnConeMatch } from './yarnStockActiveFilters.js';
import { syncInventoriesFromStorageForCatalogIds } from './yarnInventory.service.js';
import * as yarnPoReturnChallanService from './yarnPoReturnChallan.service.js';

/**
 * Standalone MongoDB instances do not support multi-document transactions.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isTransactionUnsupportedError(err) {
  const code = err && typeof err === 'object' && 'code' in err ? /** @type {any} */ (err).code : undefined;
  const msg = String(err && typeof err === 'object' && 'message' in err ? /** @type {any} */ (err).message : err);
  return code === 20 || /replica set|mongos|transaction numbers/i.test(msg);
}

/**
 * @param {{ userId?: string, username?: string }} u
 * @returns {{ user: import('mongoose').Types.ObjectId | null, username: string }}
 */
export function normaliseVendorReturnActor(u) {
  const username = String(u?.username || 'system').trim() || 'system';
  let user = null;
  if (u?.userId && mongoose.Types.ObjectId.isValid(String(u.userId))) {
    user = new mongoose.Types.ObjectId(String(u.userId));
  }
  return { user, username };
}

/**
 * @param {import('mongoose').Document | object} cone
 * @returns {boolean}
 */
export function coneHasShortTermStorage(cone) {
  return cone.coneStorageId != null && String(cone.coneStorageId).trim() !== '';
}

/**
 * Splits cones into pre-ST and in-ST buckets.
 *
 * @param {object[]} cones
 * @returns {{ preStorage: object[], inStorage: object[] }}
 */
export function partitionConesByStorage(cones) {
  const preStorage = [];
  const inStorage = [];
  for (const cone of cones) {
    if (coneHasShortTermStorage(cone)) {
      inStorage.push(cone);
    } else {
      preStorage.push(cone);
    }
  }
  return { preStorage, inStorage };
}

/**
 * Adjusts PO received lot subdocuments after vendor return (cone-level).
 *
 * @param {import('mongoose').Document} purchaseOrder
 * @param {Array<{ lotNumber?: string, yarnCatalogId?: import('mongoose').Types.ObjectId | null, grossWeight?: number }>} lines
 * @returns {void}
 */
export function applyVendorReturnToReceivedLots(purchaseOrder, lines) {
  const lots = purchaseOrder.receivedLotDetails;
  if (!Array.isArray(lots) || lots.length === 0) return;

  const poItems = purchaseOrder.poItems || [];

  for (const snap of lines) {
    const ln = String(snap.lotNumber || '').trim();
    if (!ln) continue;

    const lot = lots.find((l) => String(l.lotNumber || '').trim() === ln);
    if (!lot) continue;

    if (typeof lot.numberOfCones === 'number') {
      lot.numberOfCones = Math.max(0, lot.numberOfCones - 1);
    }
    const gw = Number(snap.grossWeight || 0);
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
    if (row && typeof row.receivedQuantity === 'number' && row.receivedQuantity > 0) {
      row.receivedQuantity = Math.max(0, row.receivedQuantity - 1);
    }
  }
}

/**
 * Builds vendor-return line payloads from cone documents.
 *
 * @param {Array<import('mongoose').Document>} cones
 * @param {string} poNumber
 * @returns {Promise<{ linePayloads: object[], catalogIdSet: Set<string> }>}
 */
export async function buildLinePayloadsFromCones(cones, poNumber) {
  /** @type {Array<object>} */
  const linePayloads = [];
  const catalogIdSet = new Set();

  for (const cone of cones) {
    if (String(cone.poNumber || '').trim() !== String(poNumber || '').trim()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Cone ${cone.barcode} belongs to PO ${cone.poNumber}, not ${poNumber}`
      );
    }

    const box = cone.boxId
      ? await YarnBox.findOne({ boxId: cone.boxId }).select('lotNumber').lean()
      : null;
    const gw = Number(cone.coneWeight || 0);
    const tw = Number(cone.tearWeight || 0);
    const net = Math.max(0, gw - tw);

    linePayloads.push({
      barcode: cone.barcode,
      coneId: cone._id,
      boxId: cone.boxId,
      lotNumber: box?.lotNumber ? String(box.lotNumber) : '',
      yarnCatalogId: cone.yarnCatalogId || undefined,
      coneWeight: gw,
      tearWeight: tw,
      netWeight: net,
      coneStorageIdBefore: cone.coneStorageId ? String(cone.coneStorageId) : '',
      grossWeight: gw,
    });

    if (cone.yarnCatalogId) catalogIdSet.add(String(cone.yarnCatalogId));
  }

  return { linePayloads, catalogIdSet };
}

/**
 * Archives cones, completes a vendor-return doc, patches PO, syncs inventory, issues challan.
 *
 * @param {{
 *   returnDocId: import('mongoose').Types.ObjectId,
 *   linePayloads: object[],
 *   poNumber: string,
 *   cancellationIntent: 'partial'|'full_po',
 *   remark: string,
 *   actor: { user: import('mongoose').Types.ObjectId | null, username: string },
 *   user?: { userId?: string, username?: string },
 *   idempotencyKey?: string,
 * }} params
 * @returns {Promise<{ vendorReturn: object, purchaseOrder: object|null, challan: object|null }>}
 */
export async function archiveConesAndCompleteReturn(params) {
  const {
    returnDocId,
    linePayloads,
    poNumber,
    cancellationIntent,
    remark,
    actor,
    user,
    idempotencyKey,
  } = params;

  if (!linePayloads.length) {
    return { vendorReturn: null, purchaseOrder: null, challan: null };
  }

  const now = new Date();
  const linesForDoc = linePayloads.map((l) => ({
    barcode: l.barcode,
    coneId: l.coneId,
    boxId: l.boxId,
    lotNumber: l.lotNumber,
    yarnCatalogId: l.yarnCatalogId,
    coneWeight: l.coneWeight,
    tearWeight: l.tearWeight,
    netWeight: l.netWeight,
    coneStorageIdBefore: l.coneStorageIdBefore,
  }));
  const totalNetWeight = linePayloads.reduce((s, l) => s + l.netWeight, 0);
  const catalogIdSet = new Set(
    linePayloads.filter((l) => l.yarnCatalogId).map((l) => String(l.yarnCatalogId))
  );

  const applyFinalizeMutations = async (mongoSession) => {
    const opts = mongoSession ? { session: mongoSession } : {};

    for (const line of linePayloads) {
      const updated = await YarnCone.findOneAndUpdate(
        { _id: line.coneId, ...activeYarnConeMatch },
        {
          $set: {
            returnedToVendorAt: now,
            vendorReturnId: returnDocId,
            issueStatus: 'returned_to_vendor',
          },
          $unset: { coneStorageId: '', orderId: '', articleId: '' },
        },
        { new: true, ...opts }
      ).exec();
      if (!updated) {
        throw new ApiError(
          httpStatus.CONFLICT,
          `Cone ${line.barcode} could not be archived — it may have been issued or already returned.`
        );
      }
    }

    const completedBy = { username: actor.username, user: actor.user };
    const setDoc = {
      status: 'completed',
      lines: linesForDoc,
      boxLines: [],
      pendingBarcodes: [],
      boxCount: 0,
      coneCount: linePayloads.length,
      totalNetWeight,
      completedAt: now,
      completedBy,
    };
    if (idempotencyKey) setDoc.idempotencyKey = idempotencyKey;

    await YarnPoVendorReturn.findByIdAndUpdate(returnDocId, { $set: setDoc }, opts);

    const purchaseOrder = mongoSession
      ? await YarnPurchaseOrder.findOne({ poNumber }).session(mongoSession)
      : await YarnPurchaseOrder.findOne({ poNumber });
    if (purchaseOrder) {
      applyVendorReturnToReceivedLots(purchaseOrder, linePayloads);
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
          notes: `Vendor return finalized: ${linePayloads.length} cone(s). ${remark} ERP: ${cancellationIntent}.`,
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
      // eslint-disable-next-line no-console -- dev DBs often run without replica set
      console.warn('[yarnPoVendorReturn] Mongo transaction unavailable; finalizing without transaction');
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
