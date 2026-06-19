import httpStatus from 'http-status';
import mongoose from 'mongoose';
import VendorPoVendorReturn, {
  vendorPoReturnCancellationIntents,
} from '../../models/vendorManagement/vendorPoVendorReturn.model.js';
import { VendorPurchaseOrder, VendorProductionFlow, VendorBox } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import {
  assertBoxEligibleForReturn,
  buildBoxPreview,
  finalizeVendorPoReturn,
  loadBoxForVendorReturn,
  normaliseReturnActor,
} from './vendorPoVendorReturnFinalize.lib.js';
import {
  buildArticleCandidateFromFlow,
  deductVerifiedQtyFromSc,
  getVerifiedBreakdown,
} from './vendorPoArticleReturn.lib.js';

/**
 * Start a vendor PO return scan session.
 * @param {Object} params
 */
export const createVendorReturnSession = async (params) => {
  const vpoNumber = String(params.vpoNumber || '').trim();
  if (!vpoNumber) throw new ApiError(httpStatus.BAD_REQUEST, 'vpoNumber is required');
  if (!vendorPoReturnCancellationIntents.includes(params.cancellationIntent)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'cancellationIntent must be partial or full_vpo');
  }
  const vpo = await VendorPurchaseOrder.findOne({ vpoNumber }).select('_id').lean();
  if (!vpo) throw new ApiError(httpStatus.NOT_FOUND, 'Vendor purchase order not found');
  const actor = normaliseReturnActor(params.user || {});

  const doc = await VendorPoVendorReturn.create({
    vpoNumber,
    vendorPurchaseOrder: vpo._id,
    status: 'pending_session',
    remark: params.remark != null ? String(params.remark) : '',
    cancellationIntent: params.cancellationIntent,
    pendingBarcodes: [],
    pendingM4Lines: [],
    pendingArticleQtyLines: [],
    createdBy: actor,
  });
  return doc.toJSON();
};

/**
 * @param {string} sessionId
 */
export const getVendorReturnSession = async (sessionId) => {
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid session id');
  }
  const session = await VendorPoVendorReturn.findById(sessionId).lean();
  if (!session) throw new ApiError(httpStatus.NOT_FOUND, 'Return session not found');
  const pendingRows = [];
  for (const bc of session.pendingBarcodes || []) {
    try {
      const box = await loadBoxForVendorReturn(bc);
      pendingRows.push(buildBoxPreview(box));
    } catch {
      pendingRows.push({ barcode: bc, boxId: bc, lotNumber: '', productName: '', numberOfUnits: 0 });
    }
  }
  return { session, pendingRows, pendingM4Lines: session.pendingM4Lines || [], pendingArticleQtyLines: await enrichPendingArticleQtyLines(session) };
};

/**
 * Enrich pending article qty lines with product metadata for UI.
 * @param {Object} session
 */
const enrichPendingArticleQtyLines = async (session) => {
  const lines = session.pendingArticleQtyLines || [];
  if (lines.length === 0) return [];

  const flowIds = lines.map((l) => l.vendorProductionFlowId).filter(Boolean);
  const flows = await VendorProductionFlow.find({ _id: { $in: flowIds } })
    .populate({ path: 'product', select: 'name vendorCode' })
    .lean();
  const flowMap = new Map(flows.map((f) => [String(f._id), f]));

  return lines.map((line) => {
    const flow = flowMap.get(String(line.vendorProductionFlowId));
    const product = flow?.product && typeof flow.product === 'object' ? flow.product : {};
    const breakdown = getVerifiedBreakdown(flow?.floorQuantities?.secondaryChecking || {});
    return {
      ...line,
      productName: product.name || '',
      vendorCode: product.vendorCode || '',
      referenceCode: flow?.referenceCode || '',
      verifiedAvailable: breakdown.verifiedAvailable,
      breakdown: { m1: breakdown.m1, m2: breakdown.m2, m3: breakdown.m3, vm4: breakdown.vm4, m4: breakdown.vm4 },
    };
  });
};

/**
 * Scan a box barcode into the return session.
 * @param {Object} params
 */
export const scanVendorReturnBarcode = async (params) => {
  const sessionId = String(params.sessionId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid session id');
  }
  const session = await VendorPoVendorReturn.findById(sessionId);
  if (!session || session.status !== 'pending_session') {
    throw new ApiError(httpStatus.NOT_FOUND, 'Return session not found or already closed');
  }
  const box = await loadBoxForVendorReturn(params.barcode);
  assertBoxEligibleForReturn(box, session.vpoNumber);
  const bc = String(box.barcode || box.boxId).trim();
  const pending = session.pendingBarcodes || [];
  if (!pending.includes(bc)) {
    pending.push(bc);
    session.pendingBarcodes = pending;
    await session.save();
  }
  return { session: session.toJSON(), boxPreview: buildBoxPreview(box) };
};

/**
 * Remove a scanned barcode from pending list.
 * @param {Object} params
 */
export const removePendingVendorReturnBarcode = async (params) => {
  const sessionId = String(params.sessionId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid session id');
  }
  const session = await VendorPoVendorReturn.findById(sessionId);
  if (!session || session.status !== 'pending_session') {
    throw new ApiError(httpStatus.NOT_FOUND, 'Return session not found or already closed');
  }
  const bc = String(params.barcode || '').trim();
  session.pendingBarcodes = (session.pendingBarcodes || []).filter((b) => b !== bc);
  await session.save();
  return session.toJSON();
};

/**
 * Stage article verified quantity return against a production flow.
 * @param {Object} params
 */
export const addArticleQtyLineToSession = async (params) => {
  const sessionId = String(params.sessionId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid session id');
  }
  const session = await VendorPoVendorReturn.findById(sessionId);
  if (!session || session.status !== 'pending_session') {
    throw new ApiError(httpStatus.NOT_FOUND, 'Return session not found or already closed');
  }
  const flowId = String(params.vendorProductionFlowId || '').trim();
  const qty = Math.round(Number(params.quantity));
  if (!mongoose.Types.ObjectId.isValid(flowId) || !Number.isFinite(qty) || qty <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Valid flow id and quantity > 0 required');
  }
  const flow = await VendorProductionFlow.findById(flowId)
    .populate({ path: 'vendorPurchaseOrder', select: 'vpoNumber' })
    .lean();
  if (!flow) throw new ApiError(httpStatus.NOT_FOUND, 'Production flow not found');
  const vpoNum =
    typeof flow.vendorPurchaseOrder === 'object' ? flow.vendorPurchaseOrder?.vpoNumber : null;
  if (vpoNum && vpoNum !== session.vpoNumber) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Flow does not belong to selected VPO');
  }
  const breakdown = getVerifiedBreakdown(flow.floorQuantities?.secondaryChecking || {});
  if (qty > breakdown.verifiedAvailable) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Only ${breakdown.verifiedAvailable} verified units available on this article`
    );
  }
  const lotNumber = String(params.lotNumber || flow.referenceCode || '').trim();
  const pending = session.pendingArticleQtyLines || [];
  const idx = pending.findIndex((r) => String(r.vendorProductionFlowId) === flowId);
  const entry = { vendorProductionFlowId: flowId, lotNumber, quantity: qty };
  if (idx >= 0) pending[idx] = entry;
  else pending.push(entry);
  session.pendingArticleQtyLines = pending;
  await session.save();
  return session.toJSON();
};

/**
 * Remove a staged article qty line from the return session.
 * @param {Object} params
 */
export const removePendingArticleQtyLine = async (params) => {
  const sessionId = String(params.sessionId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid session id');
  }
  const session = await VendorPoVendorReturn.findById(sessionId);
  if (!session || session.status !== 'pending_session') {
    throw new ApiError(httpStatus.NOT_FOUND, 'Return session not found or already closed');
  }
  const flowId = String(params.vendorProductionFlowId || '').trim();
  session.pendingArticleQtyLines = (session.pendingArticleQtyLines || []).filter(
    (r) => String(r.vendorProductionFlowId) !== flowId
  );
  await session.save();
  return session.toJSON();
};

/**
 * Stage M4 quantity return against a production flow.
 * @param {Object} params
 */
export const addM4LineToSession = async (params) => {
  const sessionId = String(params.sessionId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid session id');
  }
  const session = await VendorPoVendorReturn.findById(sessionId);
  if (!session || session.status !== 'pending_session') {
    throw new ApiError(httpStatus.NOT_FOUND, 'Return session not found or already closed');
  }
  const flowId = String(params.vendorProductionFlowId || '').trim();
  const qty = Number(params.m4Quantity);
  if (!mongoose.Types.ObjectId.isValid(flowId) || !Number.isFinite(qty) || qty <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Valid flow id and m4Quantity > 0 required');
  }
  const flow = await VendorProductionFlow.findById(flowId)
    .populate({ path: 'vendorPurchaseOrder', select: 'vpoNumber' })
    .lean();
  if (!flow) throw new ApiError(httpStatus.NOT_FOUND, 'Production flow not found');
  const vpoNum =
    typeof flow.vendorPurchaseOrder === 'object'
      ? flow.vendorPurchaseOrder?.vpoNumber
      : null;
  if (vpoNum && vpoNum !== session.vpoNumber) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Flow does not belong to selected VPO');
  }
  const available = Number(flow.floorQuantities?.secondaryChecking?.vm4Quantity
    ?? flow.floorQuantities?.secondaryChecking?.m4Quantity) || 0;
  if (qty > available) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Only ${available} VM4 units available on this article`);
  }
  const lotNumber = String(params.lotNumber || flow.referenceCode || '').trim();
  const pending = session.pendingM4Lines || [];
  const idx = pending.findIndex((r) => String(r.vendorProductionFlowId) === flowId);
  const entry = { vendorProductionFlowId: flowId, lotNumber, m4Quantity: Math.round(qty) };
  if (idx >= 0) pending[idx] = entry;
  else pending.push(entry);
  session.pendingM4Lines = pending;
  await session.save();
  return session.toJSON();
};

/**
 * Remove a staged M4 line from the return session.
 * @param {Object} params
 */
export const removePendingM4Line = async (params) => {
  const sessionId = String(params.sessionId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid session id');
  }
  const session = await VendorPoVendorReturn.findById(sessionId);
  if (!session || session.status !== 'pending_session') {
    throw new ApiError(httpStatus.NOT_FOUND, 'Return session not found or already closed');
  }
  const flowId = String(params.vendorProductionFlowId || '').trim();
  session.pendingM4Lines = (session.pendingM4Lines || []).filter(
    (r) => String(r.vendorProductionFlowId) !== flowId
  );
  await session.save();
  return session.toJSON();
};

/**
 * Finalize return session and issue challan.
 * @param {Object} params
 */
export const finalizeVendorReturnSession = async (params) => {
  const sessionId = String(params.sessionId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid session id');
  }
  if (params.idempotencyKey) {
    const prior = await VendorPoVendorReturn.findOne({
      idempotencyKey: String(params.idempotencyKey).trim(),
      status: 'completed',
    }).lean();
    if (prior) {
      return { vendorReturn: prior, idempotent: true };
    }
  }
  const session = await VendorPoVendorReturn.findById(sessionId);
  if (!session || session.status !== 'pending_session') {
    throw new ApiError(httpStatus.NOT_FOUND, 'Return session not found or already closed');
  }
  if (params.idempotencyKey) {
    session.idempotencyKey = String(params.idempotencyKey).trim();
  }
  const actor = normaliseReturnActor(params.user || {});
  return finalizeVendorPoReturn(session, actor, params.user || {});
};

/**
 * List completed returns for a VPO.
 * @param {Object} params
 */
export const listVendorReturnHistory = async (params) => {
  const filter = { status: 'completed' };
  if (params.vpoNumber) filter.vpoNumber = String(params.vpoNumber).trim();
  const limit = Math.min(Number(params.limit) || 20, 100);
  const rows = await VendorPoVendorReturn.find(filter).sort({ completedAt: -1 }).limit(limit).lean();
  return rows;
};

/**
 * List production flows with verified SC qty available for article return on a VPO.
 * @param {string} vpoNumber
 */
export const getArticleReturnCandidates = async (vpoNumber) => {
  const vpo = await VendorPurchaseOrder.findOne({ vpoNumber: String(vpoNumber).trim() }).lean();
  if (!vpo) throw new ApiError(httpStatus.NOT_FOUND, 'VPO not found');
  const flows = await VendorProductionFlow.find({ vendorPurchaseOrder: vpo._id })
    .populate({ path: 'product', select: 'name vendorCode' })
    .lean();
  return flows.map((f) => buildArticleCandidateFromFlow(f)).filter(Boolean);
};

/**
 * List boxes available for return for a given article (production flow) on a VPO.
 * Supports article-wise box selection: each box exposes box number, weight and quantity.
 * @param {string} vpoNumber
 * @param {string} flowId - vendor production flow id (identifies the article)
 * @returns {Promise<Array<{ boxId: string, barcode: string, lotNumber: string, productName: string, vendorCode: string, boxWeight: number, numberOfUnits: number }>>}
 */
export const getArticleReturnBoxes = async (vpoNumber, flowId) => {
  const vpoNum = String(vpoNumber || '').trim();
  if (!vpoNum) throw new ApiError(httpStatus.BAD_REQUEST, 'vpoNumber is required');
  if (!mongoose.Types.ObjectId.isValid(String(flowId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid flow id');
  }
  const vpo = await VendorPurchaseOrder.findOne({ vpoNumber: vpoNum }).select('_id').lean();
  if (!vpo) throw new ApiError(httpStatus.NOT_FOUND, 'VPO not found');
  const flow = await VendorProductionFlow.findById(flowId)
    .select('product referenceCode vendorPurchaseOrder')
    .lean();
  if (!flow) throw new ApiError(httpStatus.NOT_FOUND, 'Production flow not found');
  if (flow.vendorPurchaseOrder && String(flow.vendorPurchaseOrder) !== String(vpo._id)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Flow does not belong to selected VPO');
  }

  /** Only boxes not yet physically returned; scoped to this article's product on the VPO. */
  const boxFilter = {
    vendorPurchaseOrderId: vpo._id,
    returnedToVendor: { $ne: true },
  };
  if (flow.product) boxFilter.productId = flow.product;

  const boxes = await VendorBox.find(boxFilter)
    .populate({ path: 'productId', select: 'vendorCode name' })
    .sort({ lotNumber: 1, boxId: 1 })
    .lean();

  return boxes.map((b) => {
    const product = b.productId && typeof b.productId === 'object' ? b.productId : {};
    return {
      boxId: b.boxId,
      barcode: b.barcode || b.boxId,
      lotNumber: b.lotNumber || '',
      productName: b.productName || product.name || '',
      vendorCode: product.vendorCode || '',
      boxWeight: Number(b.boxWeight) || 0,
      numberOfUnits: Number(b.numberOfUnits) || 0,
    };
  });
};

/**
 * List production flows with M4 qty available for return on a VPO.
 * @param {string} vpoNumber
 */
export const getM4ReturnCandidates = async (vpoNumber) => {
  const vpo = await VendorPurchaseOrder.findOne({ vpoNumber: String(vpoNumber).trim() }).lean();
  if (!vpo) throw new ApiError(httpStatus.NOT_FOUND, 'VPO not found');
  const flows = await VendorProductionFlow.find({ vendorPurchaseOrder: vpo._id })
    .populate({ path: 'product', select: 'name vendorCode' })
    .lean();
  return flows
    .map((f) => ({
      flowId: String(f._id),
      referenceCode: f.referenceCode || '',
      productName: f.product?.name || '',
      vendorCode: f.product?.vendorCode || '',
      m4Available: Number(f.floorQuantities?.secondaryChecking?.vm4Quantity
        ?? f.floorQuantities?.secondaryChecking?.m4Quantity) || 0,
    }))
    .filter((r) => r.m4Available > 0);
};
