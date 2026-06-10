import httpStatus from 'http-status';
import YarnPoVendorReturn, { vendorReturnCancellationIntents } from '../../models/yarnReq/yarnPoVendorReturn.model.js';
import YarnPurchaseOrder from '../../models/yarnReq/yarnPurchaseOrder.model.js';
import ApiError from '../../utils/ApiError.js';
import * as yarnPurchaseOrderService from './yarnPurchaseOrder.service.js';
import {
  archiveConesAndCompleteReturn,
  buildLinePayloadsFromCones,
  normaliseVendorReturnActor,
  partitionConesByStorage,
} from './yarnPoVendorReturnFinalize.lib.js';
import {
  classifyLotBoxesForReturn,
  classifyPoBoxesForReturn,
} from './yarnPoVendorReturnBoxClassifier.js';
import { autoFinalizeLtBoxes } from './yarnPoVendorReturnBoxFinalize.lib.js';

/**
 * Creates a pending vendor-return session with ST barcodes pre-staged (QC hybrid path).
 *
 * @param {{
 *   poNumber: string,
 *   barcodes: string[],
 *   remark: string,
 *   cancellationIntent: 'partial'|'full_po',
 *   user?: { userId?: string, username?: string },
 * }} params
 * @returns {Promise<object|null>}
 */
export async function createPendingSessionForStCones(params) {
  const barcodes = [...new Set((params.barcodes || []).map((b) => String(b).trim()).filter(Boolean))];
  if (!barcodes.length) return null;

  const poNumber = String(params.poNumber || '').trim();
  const po = await YarnPurchaseOrder.findOne({ poNumber }).select('_id').lean();
  if (!po) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }
  if (!vendorReturnCancellationIntents.includes(params.cancellationIntent)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'cancellationIntent must be partial or full_po');
  }

  const actor = normaliseVendorReturnActor(params.user || {});
  const remark = String(params.remark || '').trim();

  const existing = await YarnPoVendorReturn.findOne({
    poNumber,
    status: 'pending_session',
    remark: /^QC return \(ST pending scan\)/,
  }).sort({ createdAt: -1 });

  if (existing) {
    const merged = [...new Set([...(existing.pendingBarcodes || []), ...barcodes])];
    existing.pendingBarcodes = merged;
    if (remark && !String(existing.remark || '').includes(remark)) {
      existing.remark = `${existing.remark} | ${remark}`;
    }
    await existing.save();
    return existing.toJSON();
  }

  const doc = await YarnPoVendorReturn.create({
    poNumber,
    purchaseOrder: po._id,
    status: 'pending_session',
    remark: remark ? `QC return (ST pending scan) — ${remark}` : 'QC return (ST pending scan)',
    cancellationIntent: params.cancellationIntent,
    pendingBarcodes: barcodes,
    createdBy: { username: actor.username, user: actor.user },
  });

  return doc.toJSON();
}

/**
 * Auto-finalizes pre-ST cones into a completed vendor return + challan.
 *
 * @param {{
 *   poNumber: string,
 *   cones: object[],
 *   remark: string,
 *   cancellationIntent: 'partial'|'full_po',
 *   user?: { userId?: string, username?: string },
 * }} params
 * @returns {Promise<{ vendorReturn: object|null, challan: object|null, autoReturnedCount: number }>}
 */
async function autoFinalizePreStorageCones(params) {
  const cones = params.cones || [];
  if (!cones.length) {
    return { vendorReturn: null, challan: null, autoReturnedCount: 0 };
  }

  const poNumber = String(params.poNumber || '').trim();
  const po = await YarnPurchaseOrder.findOne({ poNumber }).select('_id').lean();
  if (!po) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  const actor = normaliseVendorReturnActor(params.user || {});
  const remark = String(params.remark || '').trim();
  const qcRemark = remark ? `QC return — ${remark}` : 'QC return';

  const returnDoc = await YarnPoVendorReturn.create({
    poNumber,
    purchaseOrder: po._id,
    status: 'pending_session',
    remark: qcRemark,
    cancellationIntent: params.cancellationIntent,
    pendingBarcodes: [],
    createdBy: { username: actor.username, user: actor.user },
  });

  const { linePayloads } = await buildLinePayloadsFromCones(cones, poNumber);
  const result = await archiveConesAndCompleteReturn({
    returnDocId: returnDoc._id,
    linePayloads,
    poNumber,
    cancellationIntent: params.cancellationIntent,
    remark: qcRemark,
    actor,
    user: params.user,
  });

  return {
    vendorReturn: result.vendorReturn,
    challan: result.challan,
    autoReturnedCount: cones.length,
  };
}

/**
 * Builds a normalized API response for QC return actions.
 *
 * @param {object} parts
 * @returns {object}
 */
function buildQcReturnResponse(parts) {
  const pendingStBarcodes = parts.pendingStBarcodes || [];
  const boxChallan = parts.boxChallan || null;
  const coneChallan = parts.coneChallan || parts.challan || null;
  const challan = boxChallan || coneChallan;
  return {
    autoReturnedBoxCount: parts.autoReturnedBoxCount ?? 0,
    autoReturnedCount: parts.autoReturnedCount ?? 0,
    excludedConeCount: parts.excludedConeCount ?? 0,
    pendingStCount: pendingStBarcodes.length,
    pendingStBarcodes,
    sessionId: parts.session?.id ?? parts.session?._id?.toString?.() ?? parts.sessionId ?? null,
    session: parts.session ?? null,
    vendorReturn: parts.vendorReturn ?? parts.boxVendorReturn ?? parts.coneVendorReturn ?? null,
    boxVendorReturn: parts.boxVendorReturn ?? null,
    coneVendorReturn: parts.coneVendorReturn ?? null,
    boxChallan,
    coneChallan,
    challan,
    challanId: challan?.id ?? challan?._id?.toString?.() ?? null,
    challanNumber: challan?.challanNumber ?? null,
    purchaseOrder: parts.purchaseOrder ?? null,
  };
}

/**
 * Hybrid QC lot return: mark lot returned, auto-return closed LT boxes + pre-ST cones, stage ST cones for PO Return scan.
 *
 * @param {{
 *   poNumber: string,
 *   lotNumber: string,
 *   remark: string,
 *   user?: { userId?: string, username?: string },
 * }} params
 * @returns {Promise<object>}
 */
export async function finalizeQcLotReturn(params) {
  const poNumber = String(params.poNumber || '').trim();
  const lotNumber = String(params.lotNumber || '').trim();
  const remark = String(params.remark || '').trim();
  if (!poNumber || !lotNumber) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'poNumber and lotNumber are required');
  }
  if (!remark) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'remark is required');
  }

  const actor = normaliseVendorReturnActor(params.user || {});
  const userId = params.user?.userId != null ? String(params.user.userId) : '';
  const username = actor.username;

  const { ltBoxes, stCones, excludedCones } = await classifyLotBoxesForReturn(poNumber, lotNumber);
  const { preStorage, inStorage } = partitionConesByStorage(stCones);

  const boxResult = await autoFinalizeLtBoxes({
    poNumber,
    boxLinePayloads: ltBoxes,
    remark,
    cancellationIntent: 'partial',
    user: params.user,
  });

  const coneResult = await autoFinalizePreStorageCones({
    poNumber,
    cones: preStorage,
    remark,
    cancellationIntent: 'partial',
    user: params.user,
  });

  const pendingStBarcodes = inStorage.map((c) => String(c.barcode || '').trim()).filter(Boolean);
  const session = await createPendingSessionForStCones({
    poNumber,
    barcodes: pendingStBarcodes,
    remark,
    cancellationIntent: 'partial',
    user: params.user,
  });

  await yarnPurchaseOrderService.updateLotStatusAndQcApprove(
    poNumber,
    lotNumber,
    'lot_returned_to_vendor',
    { username, user_id: userId },
    `Lot ${lotNumber} return to vendor (QC) — ${remark} — by ${username}`,
    { remarks: `Return to vendor: ${remark}` }
  );

  const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber }).lean();

  return buildQcReturnResponse({
    autoReturnedBoxCount: boxResult.autoReturnedBoxCount,
    autoReturnedCount: coneResult.autoReturnedCount,
    excludedConeCount: excludedCones.length,
    pendingStBarcodes,
    session,
    boxVendorReturn: boxResult.vendorReturn,
    coneVendorReturn: coneResult.vendorReturn,
    boxChallan: boxResult.challan,
    coneChallan: coneResult.challan,
    purchaseOrder,
  });
}

/**
 * Hybrid QC full-PO return: mark PO + lots, auto-return LT boxes + pre-ST cones, stage ST cones for scan.
 *
 * @param {{
 *   poNumber: string,
 *   remark: string,
 *   user?: { userId?: string, username?: string },
 * }} params
 * @returns {Promise<object>}
 */
export async function finalizeQcPoReturn(params) {
  const poNumber = String(params.poNumber || '').trim();
  const remark = String(params.remark || '').trim();
  if (!poNumber) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'poNumber is required');
  }
  if (!remark) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'remark is required');
  }

  const purchaseOrderDoc = await YarnPurchaseOrder.findOne({ poNumber });
  if (!purchaseOrderDoc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  const actor = normaliseVendorReturnActor(params.user || {});
  const userId = params.user?.userId != null ? String(params.user.userId) : '';
  const username = actor.username;

  const lots = purchaseOrderDoc.receivedLotDetails || [];
  for (const lot of lots) {
    const ln = String(lot.lotNumber || '').trim();
    if (!ln || lot.status === 'lot_returned_to_vendor') continue;

    await yarnPurchaseOrderService.updateLotStatusAndQcApprove(
      poNumber,
      ln,
      'lot_returned_to_vendor',
      { username, user_id: userId },
      `QC full PO return — ${remark} — lot ${ln} — by ${username}`,
      { remarks: `Return to vendor: ${remark}` }
    );
  }

  await yarnPurchaseOrderService.updatePurchaseOrderStatus(
    purchaseOrderDoc._id,
    'returned_to_vendor',
    { username, user_id: userId },
    `QC return to vendor — ${remark} — by ${username}`
  );

  const { ltBoxes, stCones, excludedCones } = await classifyPoBoxesForReturn(poNumber);
  const { preStorage, inStorage } = partitionConesByStorage(stCones);
  const hasStPending = inStorage.length > 0;
  const cancellationIntent = hasStPending ? 'partial' : 'full_po';

  const boxResult = await autoFinalizeLtBoxes({
    poNumber,
    boxLinePayloads: ltBoxes,
    remark,
    cancellationIntent,
    user: params.user,
  });

  const coneResult = await autoFinalizePreStorageCones({
    poNumber,
    cones: preStorage,
    remark,
    cancellationIntent,
    user: params.user,
  });

  const pendingStBarcodes = inStorage.map((c) => String(c.barcode || '').trim()).filter(Boolean);
  const session = await createPendingSessionForStCones({
    poNumber,
    barcodes: pendingStBarcodes,
    remark,
    cancellationIntent: hasStPending ? 'partial' : 'full_po',
    user: params.user,
  });

  const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber }).lean();

  return buildQcReturnResponse({
    autoReturnedBoxCount: boxResult.autoReturnedBoxCount,
    autoReturnedCount: coneResult.autoReturnedCount,
    excludedConeCount: excludedCones.length,
    pendingStBarcodes,
    session,
    boxVendorReturn: boxResult.vendorReturn,
    coneVendorReturn: coneResult.vendorReturn,
    boxChallan: boxResult.challan,
    coneChallan: coneResult.challan,
    purchaseOrder,
  });
}

/**
 * Lists QC-return lots that still have active in-ST cones pending vendor-return finalize.
 *
 * @param {{ poNumber: string }} filters
 * @returns {Promise<object>}
 */
export async function getQcPendingVendorReturns(filters = {}) {
  const poNumber = String(filters.poNumber || '').trim();
  if (!poNumber) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'poNumber is required');
  }

  const po = await YarnPurchaseOrder.findOne({ poNumber }).lean();
  if (!po) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  const openSession = await YarnPoVendorReturn.findOne({
    poNumber,
    status: 'pending_session',
    remark: /^QC return \(ST pending scan\)/,
  })
    .sort({ createdAt: -1 })
    .lean();

  const lots = [];
  let totalPendingStCount = 0;

  for (const lot of po.receivedLotDetails || []) {
    if (lot.status !== 'lot_returned_to_vendor') continue;
    const ln = String(lot.lotNumber || '').trim();
    if (!ln) continue;

    const { stCones } = await classifyLotBoxesForReturn(poNumber, ln);
    const { inStorage } = partitionConesByStorage(stCones);
    if (!inStorage.length) continue;

    const pendingStBarcodes = inStorage.map((c) => String(c.barcode || '').trim()).filter(Boolean);
    totalPendingStCount += pendingStBarcodes.length;
    lots.push({
      lotNumber: ln,
      pendingStCount: pendingStBarcodes.length,
      pendingStBarcodes,
      sessionId:
        openSession && openSession.pendingBarcodes?.length
          ? String(openSession._id)
          : null,
    });
  }

  return {
    poNumber,
    lots,
    totalPendingStCount,
    sessionId: openSession ? String(openSession._id) : null,
    pendingStBarcodes: openSession?.pendingBarcodes || [],
  };
}

/** @deprecated Use classifyLotBoxesForReturn for box-aware QC returns. */
export async function loadActiveConesForLot(poNumber, lotNumber) {
  const { stCones, excludedCones } = await classifyLotBoxesForReturn(poNumber, lotNumber);
  return { eligible: stCones, excluded: excludedCones };
}

/** @deprecated Use classifyPoBoxesForReturn for box-aware QC returns. */
export async function loadActiveConesForPo(poNumber) {
  const { stCones, excludedCones } = await classifyPoBoxesForReturn(poNumber);
  return { eligible: stCones, excluded: excludedCones };
}

/** Re-export for callers that import partitionConesByStorage from this module. */
export { partitionConesByStorage };
