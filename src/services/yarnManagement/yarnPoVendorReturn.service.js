import mongoose from 'mongoose';
import httpStatus from 'http-status';
import YarnPoVendorReturn, { vendorReturnCancellationIntents } from '../../models/yarnReq/yarnPoVendorReturn.model.js';
import YarnPurchaseOrder from '../../models/yarnReq/yarnPurchaseOrder.model.js';
import YarnCone from '../../models/yarnReq/yarnCone.model.js';
import YarnBox from '../../models/yarnReq/yarnBox.model.js';
import ApiError from '../../utils/ApiError.js';
import { activeYarnConeMatch } from './yarnStockActiveFilters.js';
import * as yarnPoReturnChallanService from './yarnPoReturnChallan.service.js';
import {
  archiveConesAndCompleteReturn,
  buildLinePayloadsFromCones,
  normaliseVendorReturnActor,
} from './yarnPoVendorReturnFinalize.lib.js';

export {
  finalizeQcLotReturn,
  finalizeQcPoReturn,
  getQcPendingVendorReturns,
} from './yarnPoVendorReturnQc.service.js';

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
 * @param {{ skipStorageCheck?: boolean }} [options]
 */
function assertConeEligibleForVendorReturn(cone, expectedPoNumber, options = {}) {
  const po = String(expectedPoNumber || '').trim();
  if (String(cone.poNumber || '').trim() !== po) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cone ${cone.barcode} belongs to PO ${cone.poNumber}, not ${po}`
    );
  }
  if (!options.skipStorageCheck) {
    const st = cone.coneStorageId != null && String(cone.coneStorageId).trim() !== '';
    if (!st) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Cone ${cone.barcode} is not in short-term storage (no slot).`);
    }
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
  const actor = normaliseVendorReturnActor(params.user || {});

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

  const isQcStSession = String(session.remark || '').startsWith('QC return (ST pending scan)');
  const cone = await loadActiveConeForVendorReturn(params.barcode);
  assertConeEligibleForVendorReturn(cone, session.poNumber, { skipStorageCheck: isQcStSession });

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
      const challan = await yarnPoReturnChallanService.getChallanByVendorReturnId(existing._id);
      return { vendorReturn: existing, purchaseOrder: po, challan, idempotent: true };
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

  const isQcStSession = String(session.remark || '').startsWith('QC return (ST pending scan)');
  /** @type {import('mongoose').Document[]} */
  const coneDocs = [];
  for (const barcode of pending) {
    const cone = await loadActiveConeForVendorReturn(barcode);
    assertConeEligibleForVendorReturn(cone, session.poNumber, { skipStorageCheck: isQcStSession });
    coneDocs.push(cone);
  }

  const { linePayloads } = await buildLinePayloadsFromCones(coneDocs, session.poNumber);
  const actor = normaliseVendorReturnActor(params.user || {});

  const result = await archiveConesAndCompleteReturn({
    returnDocId: session._id,
    linePayloads,
    poNumber: session.poNumber,
    cancellationIntent: session.cancellationIntent,
    remark: session.remark || '',
    actor,
    user: params.user,
    idempotencyKey: idem || undefined,
  });

  return {
    vendorReturn: result.vendorReturn,
    purchaseOrder: result.purchaseOrder,
    challan: result.challan,
  };
};

/**
 * Loads a pending vendor-return session with cone preview rows for staged barcodes.
 *
 * @param {{ sessionId: string }} params
 * @returns {Promise<{ session: object, pendingRows: object[] }>}
 */
export const getVendorReturnSessionWithPreviews = async (params) => {
  const sessionId = String(params.sessionId || '').trim();
  if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid session id');
  }

  const session = await YarnPoVendorReturn.findById(sessionId);
  if (!session || session.status !== 'pending_session') {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor return session not found or already closed');
  }

  const pendingRows = [];
  for (const bc of session.pendingBarcodes || []) {
    try {
      const cone = await loadActiveConeForVendorReturn(bc);
      const box = cone.boxId
        ? await YarnBox.findOne({ boxId: cone.boxId }).select('lotNumber').lean()
        : null;
      pendingRows.push({
        barcode: String(cone.barcode || bc),
        yarnName: String(cone.yarnName || '—'),
        lotNumber: String(box?.lotNumber || '—'),
        boxId: String(cone.boxId || '—'),
        coneWeight: Number(cone.coneWeight ?? 0),
        tearWeight: Number(cone.tearWeight ?? 0),
      });
    } catch {
      pendingRows.push({
        barcode: bc,
        yarnName: '—',
        lotNumber: '—',
        boxId: '—',
        coneWeight: 0,
        tearWeight: 0,
      });
    }
  }

  return { session: session.toJSON(), pendingRows };
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
