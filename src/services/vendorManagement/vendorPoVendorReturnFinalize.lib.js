import httpStatus from 'http-status';
import mongoose from 'mongoose';
import {
  VendorBox,
  VendorProductionFlow,
  VendorPurchaseOrder,
} from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { computeDerivedForFloor } from './vendorProductionFlowFloorPatch.js';
import * as vendorPoReturnChallanService from './vendorPoReturnChallan.service.js';
import { deductVerifiedQtyFromSc, getVerifiedBreakdown } from './vendorPoArticleReturn.lib.js';

/**
 * @param {Object} user
 */
export const normaliseReturnActor = (user = {}) => {
  const id = user?.userId || user?.id || user?._id || user?.user;
  return {
    user: id && mongoose.Types.ObjectId.isValid(String(id)) ? id : null,
    username: user?.username || user?.email || 'system',
  };
};

/**
 * Load box eligible for vendor return scan.
 * @param {string} barcode
 */
export const loadBoxForVendorReturn = async (barcode) => {
  const trimmed = String(barcode || '').trim();
  if (!trimmed) throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode is required');
  const box = await VendorBox.findOne({
    $or: [{ barcode: trimmed }, { boxId: trimmed }],
  }).populate({ path: 'productId', select: 'name vendorCode' });
  if (!box) throw new ApiError(httpStatus.NOT_FOUND, 'Box not found');
  if (box.returnedToVendor) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Box already returned to vendor');
  }
  return box;
};

/**
 * @param {Object} box
 * @param {string} expectedVpoNumber
 */
export const assertBoxEligibleForReturn = (box, expectedVpoNumber) => {
  if (String(box.vpoNumber || '').trim() !== String(expectedVpoNumber || '').trim()) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Box ${box.boxId} belongs to VPO ${box.vpoNumber}, not ${expectedVpoNumber}`
    );
  }
  const units = Number(box.numberOfUnits) || 0;
  if (units <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Box has no units to return');
};

/**
 * Build preview row for a scanned box.
 * @param {Object} box
 */
export const buildBoxPreview = (box) => {
  const product = box.productId && typeof box.productId === 'object' ? box.productId : null;
  return {
    barcode: box.barcode || box.boxId,
    boxId: box.boxId,
    lotNumber: box.lotNumber || '',
    productName: box.productName || product?.name || '',
    vendorCode: product?.vendorCode || '',
    numberOfUnits: Number(box.numberOfUnits) || 0,
  };
};

/**
 * Resolve PO line item _id for a product on the VPO.
 * @param {Object} vpo
 * @param {Object|string} productId
 * @returns {mongoose.Types.ObjectId|null}
 */
const resolvePoItemId = (vpo, productId) => {
  const pid = productId?._id?.toString?.() || (typeof productId === 'string' ? productId : null);
  if (!pid || !Array.isArray(vpo?.poItems)) return null;
  const match = vpo.poItems.find((it) => String(it.productId) === String(pid));
  return match?._id || null;
};

/**
 * Finalize vendor return: mark boxes returned, adjust verified qty on flows, issue challan.
 * @param {Object} session - mongoose VendorPoVendorReturn doc
 * @param {Object} actor
 * @param {Object} reqUser - for challan createdBy
 */
export const finalizeVendorPoReturn = async (session, actor, reqUser) => {
  const pendingBarcodes = session.pendingBarcodes || [];
  const pendingM4 = session.pendingM4Lines || [];
  const pendingArticleQty = session.pendingArticleQtyLines || [];
  if (
    pendingBarcodes.length === 0 &&
    pendingM4.length === 0 &&
    pendingArticleQty.length === 0
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Scan at least one box or add article quantity to return'
    );
  }

  const vpo = await VendorPurchaseOrder.findById(session.vendorPurchaseOrder).lean();

  const boxLines = [];
  for (const bc of pendingBarcodes) {
    const box = await loadBoxForVendorReturn(bc);
    assertBoxEligibleForReturn(box, session.vpoNumber);
    const preview = buildBoxPreview(box);
    boxLines.push({
      ...preview,
      productId: box.productId?._id || box.productId,
    });
    box.returnedToVendor = true;
    box.returnedToVendorAt = new Date();
    box.vendorReturnId = session._id;
    await box.save();
  }

  const m4Lines = [];
  for (const row of pendingM4) {
    const flow = await VendorProductionFlow.findById(row.vendorProductionFlowId)
      .populate({ path: 'product', select: 'name vendorCode' })
      .populate({ path: 'vendorPurchaseOrder', select: 'vpoNumber' });
    if (!flow) throw new ApiError(httpStatus.NOT_FOUND, 'Production flow not found for M4 return');
    const vpoRef = flow.vendorPurchaseOrder;
    const vpoNum = typeof vpoRef === 'object' ? vpoRef?.vpoNumber : null;
    if (vpoNum && vpoNum !== session.vpoNumber) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'M4 return flow does not belong to this VPO');
    }
    const sc = flow.floorQuantities?.secondaryChecking || {};
    const availableM4 = Number(sc.m4Quantity) || 0;
    const qty = Number(row.m4Quantity) || 0;
    if (qty <= 0 || qty > availableM4) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `M4 return qty ${qty} exceeds available M4 (${availableM4}) on flow`
      );
    }
    sc.m4Quantity = availableM4 - qty;
    const derived = computeDerivedForFloor('secondaryChecking', {
      ...sc,
      received: Number(sc.received) || 0,
      m1Quantity: Number(sc.m1Quantity) || 0,
      m2Quantity: Number(sc.m2Quantity) || 0,
      m3Quantity: Number(sc.m3Quantity) || 0,
      m4Quantity: sc.m4Quantity,
    });
    flow.floorQuantities.secondaryChecking = { ...sc, ...derived };
    await flow.save();

    const product = flow.product && typeof flow.product === 'object' ? flow.product : {};
    m4Lines.push({
      vendorProductionFlowId: flow._id,
      lotNumber: row.lotNumber || flow.referenceCode || '',
      productId: product._id || flow.product,
      productName: product.name || '',
      vendorCode: product.vendorCode || '',
      m4Quantity: qty,
    });
  }

  const articleQtyLines = [];
  for (const row of pendingArticleQty) {
    const flow = await VendorProductionFlow.findById(row.vendorProductionFlowId)
      .populate({ path: 'product', select: 'name vendorCode' })
      .populate({ path: 'vendorPurchaseOrder', select: 'vpoNumber' });
    if (!flow) throw new ApiError(httpStatus.NOT_FOUND, 'Production flow not found for article return');
    const vpoRef = flow.vendorPurchaseOrder;
    const vpoNum = typeof vpoRef === 'object' ? vpoRef?.vpoNumber : null;
    if (vpoNum && vpoNum !== session.vpoNumber) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Article return flow does not belong to this VPO');
    }
    const sc = flow.floorQuantities?.secondaryChecking || {};
    const qty = Number(row.quantity) || 0;
    const breakdown = getVerifiedBreakdown(sc);
    if (qty <= 0 || qty > breakdown.verifiedAvailable) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Article return qty ${qty} exceeds verified available (${breakdown.verifiedAvailable}) on flow`
      );
    }
    flow.floorQuantities.secondaryChecking = deductVerifiedQtyFromSc(sc, qty);
    await flow.save();

    const product = flow.product && typeof flow.product === 'object' ? flow.product : {};
    const productId = product._id || flow.product;
    articleQtyLines.push({
      vendorProductionFlowId: flow._id,
      lotNumber: row.lotNumber || flow.referenceCode || '',
      vendorPoItemId: resolvePoItemId(vpo, productId),
      productId,
      productName: product.name || '',
      vendorCode: product.vendorCode || '',
      quantity: qty,
    });
  }

  const articleQtyCount = articleQtyLines.reduce((s, l) => s + (l.quantity || 0), 0);

  session.status = 'completed';
  session.boxLines = boxLines;
  session.m4Lines = m4Lines;
  session.articleQtyLines = articleQtyLines;
  session.boxCount = boxLines.length;
  session.m4UnitCount = m4Lines.reduce((s, l) => s + (l.m4Quantity || 0), 0);
  session.articleQtyCount = articleQtyCount;
  session.totalUnits =
    boxLines.reduce((s, l) => s + (l.numberOfUnits || 0), 0) +
    session.m4UnitCount +
    articleQtyCount;
  session.completedAt = new Date();
  session.completedBy = actor;
  session.pendingBarcodes = [];
  session.pendingM4Lines = [];
  session.pendingArticleQtyLines = [];
  await session.save();

  const challan = await vendorPoReturnChallanService.createChallanFromVendorReturn(session, reqUser);
  return { vendorReturn: session.toJSON(), vendorPurchaseOrder: vpo, challan };
};
