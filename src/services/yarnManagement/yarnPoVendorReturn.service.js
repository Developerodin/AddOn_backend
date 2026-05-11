import mongoose from 'mongoose';
import httpStatus from 'http-status';
import YarnPoVendorReturn, { vendorReturnCancellationIntents } from '../../models/yarnReq/yarnPoVendorReturn.model.js';
import YarnPurchaseOrder from '../../models/yarnReq/yarnPurchaseOrder.model.js';
import YarnCone from '../../models/yarnReq/yarnCone.model.js';
import YarnBox from '../../models/yarnReq/yarnBox.model.js';
import ApiError from '../../utils/ApiError.js';
import { activeYarnConeMatch, activeYarnBoxMatch } from './yarnStockActiveFilters.js';
import { syncInventoriesFromStorageForCatalogIds } from './yarnInventory.service.js';

/**
 * Standalone MongoDB instances do not support multi-document transactions.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isTransactionUnsupportedError(err) {
  const code = err && typeof err === 'object' && 'code' in err ? /** @type {any} */ (err).code : undefined;
  const msg = String(err && typeof err === 'object' && 'message' in err ? /** @type {any} */ (err).message : err);
  return code === 20 || /replica set|mongos|transaction numbers/i.test(msg);
}

/**
 * @param {{ userId?: string, username?: string }} u
 * @returns {{ user: import('mongoose').Types.ObjectId | null, username: string }}
 */
function normaliseActor(u) {
  const username = String(u?.username || 'system').trim() || 'system';
  let user = null;
  if (u?.userId && mongoose.Types.ObjectId.isValid(String(u.userId))) {
    user = new mongoose.Types.ObjectId(String(u.userId));
  }
  return { user, username };
}

/**
 * Refreshes parent box LT/ST remaining weight after cone set changes (vendor return uses same rules as YarnCone post-save).
 *
 * @param {string} boxId
 * @returns {Promise<void>}
 */
async function refreshBoxRemainingAfterConeChange(boxId) {
  const trimmed = String(boxId || '').trim();
  if (!trimmed) return;

  const box = await YarnBox.findOne({ boxId: trimmed, ...activeYarnBoxMatch });
  if (!box) return;

  const conesInST = await YarnCone.find({
    boxId: trimmed,
    coneStorageId: { $exists: true, $nin: [null, ''] },
    ...activeYarnConeMatch,
  }).lean();

  const totalConeWeight = conesInST.reduce((sum, c) => sum + (c.coneWeight || 0), 0);
  const initial = box.initialBoxWeight != null ? Number(box.initialBoxWeight) : 0;
  const boxWeightNow = Number(box.boxWeight ?? 0);
  const inferredBase = boxWeightNow >= totalConeWeight ? boxWeightNow : boxWeightNow + totalConeWeight;
  const baseWeight = initial > 0 ? initial : inferredBase;
  const remaining = Math.max(0, baseWeight - (totalConeWeight || 0));
  const fullyTransferred = conesInST.length > 0 && remaining <= 0.001;

  if (box.initialBoxWeight == null || Number(box.initialBoxWeight) <= 0) {
    box.initialBoxWeight = baseWeight;
  }
  box.boxWeight = remaining;
  if (fullyTransferred) {
    box.storageLocation = undefined;
    box.storedStatus = false;
    if (!box.coneData) box.coneData = {};
    box.coneData.conesIssued = true;
    box.coneData.numberOfCones = conesInST.length;
    box.coneData.coneIssueDate = new Date();
  }
  await box.save();
}

/**
 * Adjusts PO received lot subdocuments after vendor return (cone-level).
 *
 * @param {import('mongoose').Document} purchaseOrder
 * @param {Array<{ lotNumber?: string, yarnCatalogId?: import('mongoose').Types.ObjectId | null, grossWeight?: number }>} lines
 * @returns {void}
 */
function applyVendorReturnToReceivedLots(purchaseOrder, lines) {
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
 * Loads a cone that is eligible for vendor return scanning.
 *
 * @param {string} barcode
 * @returns {Promise<import('mongoose').Document>}
 */
async function loadActiveConeForVendorReturn(barcode) {
  const trimmed = String(barcode || '').trim();
  if (!trimmed) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode is required');
  }
  const cone = await YarnCone.findOne({ barcode: trimmed, ...activeYarnConeMatch });
  if (!cone) {
    throw new ApiError(httpStatus.NOT_FOUND, `Cone ${trimmed} not found or already returned to vendor`);
  }
  return cone;
}

/**
 * Ensures a scanned cone matches session PO and ST / issue rules.
 *
 * @param {import('mongoose').Document} cone
 * @param {string} expectedPoNumber
 */
function assertConeEligibleForVendorReturn(cone, expectedPoNumber) {
  const po = String(expectedPoNumber || '').trim();
  if (String(cone.poNumber || '').trim() !== po) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cone ${cone.barcode} belongs to PO ${cone.poNumber}, not ${po}`
    );
  }
  const st = cone.coneStorageId != null && String(cone.coneStorageId).trim() !== '';
  if (!st) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Cone ${cone.barcode} is not in short-term storage (no slot).`);
  }
  if (String(cone.issueStatus) !== 'not_issued') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cone ${cone.barcode} cannot be returned (issue status: ${cone.issueStatus}).`
    );
  }
}

/**
 * Starts a scan session for vendor return.
 *
 * @param {{ poNumber: string, remark?: string, cancellationIntent: 'partial'|'full_po', idempotencyKey?: string, user?: { userId?: string, username?: string } }} params
 * @returns {Promise<Object>}
 */
export const createVendorReturnSession = async (params) => {
  const poNumber = String(params.poNumber || '').trim();
  if (!poNumber) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'poNumber is required');
  }
  if (!vendorReturnCancellationIntents.includes(params.cancellationIntent)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'cancellationIntent must be partial or full_po');
  }
  const po = await YarnPurchaseOrder.findOne({ poNumber }).select('_id').lean();
  if (!po) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }
  const actor = normaliseActor(params.user || {});

  const doc = await YarnPoVendorReturn.create({
    poNumber,
    purchaseOrder: po._id,
    status: 'pending_session',
    remark: params.remark != null ? String(params.remark) : '',
    cancellationIntent: params.cancellationIntent,
    pendingBarcodes: [],
    createdBy: { username: actor.username, user: actor.user },
  });

  return doc.toJSON();
};

/**
 * Append a barcode to the pending list after validation.
 *
 * @param {{ sessionId: string, barcode: string }} params
 * @returns {Promise<{ session: object, conePreview: object }>}
 */
export const scanVendorReturnBarcode = async (params) => {
  const sessionId = String(params.sessionId || '').trim();
  if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid session id');
  }

  const session = await YarnPoVendorReturn.findById(sessionId);
  if (!session || session.status !== 'pending_session') {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor return session not found or already closed');
  }

  const cone = await loadActiveConeForVendorReturn(params.barcode);
  assertConeEligibleForVendorReturn(cone, session.poNumber);

  const bc = String(cone.barcode || '').trim();
  const pending = session.pendingBarcodes || [];
  if (!pending.includes(bc)) {
    pending.push(bc);
    session.pendingBarcodes = pending;
    await session.save();
  }

  const box = cone.boxId ? await YarnBox.findOne({ boxId: cone.boxId }).select('lotNumber').lean() : null;

  return {
    session: session.toJSON(),
    conePreview: {
      barcode: cone.barcode,
      boxId: cone.boxId,
      lotNumber: box?.lotNumber || '',
      yarnName: cone.yarnName,
      coneWeight: cone.coneWeight,
      tearWeight: cone.tearWeight,
      coneStorageId: cone.coneStorageId,
    },
  };
};

/**
 * Removes a barcode from the pending list.
 *
 * @param {{ sessionId: string, barcode: string }} params
 * @returns {Promise<Object>}
 */
export const removePendingVendorReturnBarcode = async (params) => {
  const sessionId = String(params.sessionId || '').trim();
  if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid session id');
  }
  const session = await YarnPoVendorReturn.findById(sessionId);
  if (!session || session.status !== 'pending_session') {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor return session not found or already closed');
  }
  const bc = String(params.barcode || '').trim();
  session.pendingBarcodes = (session.pendingBarcodes || []).filter((b) => b !== bc);
  await session.save();
  return session.toJSON();
};

/**
 * Finalizes vendor return: archives cones, updates PO, syncs inventory.
 *
 * @param {{ sessionId: string, user?: { userId?: string, username?: string }, idempotencyKey?: string }} params
 * @returns {Promise<{ vendorReturn: object, purchaseOrder: object, idempotent?: boolean }>}
 */
export const finalizeVendorReturnSession = async (params) => {
  const sessionId = String(params.sessionId || '').trim();
  if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid session id');
  }

  const idem = params.idempotencyKey ? String(params.idempotencyKey).trim() : '';
  if (idem) {
    const existing = await YarnPoVendorReturn.findOne({ idempotencyKey: idem, status: 'completed' }).lean();
    if (existing) {
      const po = await YarnPurchaseOrder.findOne({ poNumber: existing.poNumber }).lean();
      return { vendorReturn: existing, purchaseOrder: po, idempotent: true };
    }
  }

  const session = await YarnPoVendorReturn.findById(sessionId);
  if (!session) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor return session not found');
  }
  if (session.status !== 'pending_session') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Session is not open for finalize');
  }

  const pending = [...new Set(session.pendingBarcodes || [])];
  if (pending.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No cones scanned — add at least one barcode before finalize');
  }

  /** @type {Array<object>} */
  const linePayloads = [];
  const catalogIdSet = new Set();
  const boxIdSet = new Set();

  for (const barcode of pending) {
    const cone = await loadActiveConeForVendorReturn(barcode);
    assertConeEligibleForVendorReturn(cone, session.poNumber);

    const box = cone.boxId ? await YarnBox.findOne({ boxId: cone.boxId }).select('lotNumber').lean() : null;
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
    if (cone.boxId) boxIdSet.add(String(cone.boxId));
  }

  const now = new Date();
  const actor = normaliseActor(params.user || {});
  const returnDocId = session._id;
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
  const vrSessionId = session._id;
  const poNumber = session.poNumber;
  const cancellationIntent = session.cancellationIntent;
  const remark = session.remark || '';

  /**
   * Archives cones, completes YarnPoVendorReturn, patches PO — optionally in a Mongo transaction.
   *
   * @param {import('mongoose').ClientSession | null} mongoSession
   */
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
      pendingBarcodes: [],
      coneCount: linePayloads.length,
      totalNetWeight,
      completedAt: now,
      completedBy,
    };
    if (idem) setDoc.idempotencyKey = idem;

    await YarnPoVendorReturn.findByIdAndUpdate(vrSessionId, { $set: setDoc }, opts);

    const purchaseOrder = mongoSession
      ? await YarnPurchaseOrder.findOne({ poNumber }).session(mongoSession)
      : await YarnPurchaseOrder.findOne({ poNumber });
    if (purchaseOrder) {
      applyVendorReturnToReceivedLots(purchaseOrder, linePayloads);
      purchaseOrder.vendorReturnRequiresErpCancellation = true;
      purchaseOrder.lastVendorReturnCancellationIntent = cancellationIntent;
      purchaseOrder.lastVendorReturnId = vrSessionId;

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

  for (const bid of boxIdSet) {
    await refreshBoxRemainingAfterConeChange(bid);
  }

  const populated = await YarnPoVendorReturn.findById(session._id).lean();
  const purchaseOrderAfter = await YarnPurchaseOrder.findOne({ poNumber });
  const poOut = purchaseOrderAfter ? purchaseOrderAfter.toJSON() : null;

  return { vendorReturn: populated, purchaseOrder: poOut };
};

/**
 * Lists vendor return documents (newest first).
 *
 * @param {{ poNumber?: string, limit?: number }} filters
 * @returns {Promise<Array>}
 */
export const listVendorReturns = async (filters = {}) => {
  const q = { status: 'completed' };
  if (filters.poNumber) q.poNumber = String(filters.poNumber).trim();
  const lim = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);

  const rows = await YarnPoVendorReturn.find(q).sort({ createdAt: -1 }).limit(lim).lean();
  return rows;
};
