import httpStatus from 'http-status';
import mongoose from 'mongoose';
import {
  VendorGrn,
  VendorProductionFlow,
  VendorPurchaseOrder,
  VendorBox,
} from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import {
  buildSnapshotFromFlow,
  buildGrnHeaderFromFlow,
  collectLotNumbers,
  computeSnapshotDiff,
} from './vendorGrnSnapshot.builder.js';
import { isScReadyForGrn } from './vendorGrnScComplete.util.js';

export { isScReadyForGrn };

const GRN_BASE_PATTERN = /^VGRN-(\d{4})-(\d+)$/;

/**
 * Apply mongoose toJSON id transform on lean docs.
 * @template T
 * @param {T|null} doc
 * @returns {T|null}
 */
const leanToClient = (doc) => {
  if (!doc) return doc;
  if (Array.isArray(doc)) return doc.map(leanToClient);
  const { _id, __v, ...rest } = doc;
  if (_id != null && rest.id == null) {
    rest.id = typeof _id.toString === 'function' ? _id.toString() : String(_id);
  }
  return rest;
};

/**
 * Resolve the {user,username,email} block stored on every GRN.
 * @param {Object} reqUser
 */
const buildCreatedBy = (reqUser) => {
  const id = reqUser?.id || reqUser?._id?.toString?.() || null;
  return {
    user: id && mongoose.Types.ObjectId.isValid(id) ? id : null,
    username: reqUser?.username || reqUser?.email || 'system',
    email: reqUser?.email || '',
  };
};

/**
 * Generate the next sequential vendor GRN number (`VGRN-YYYY-####`).
 * @returns {Promise<string>}
 */
export const generateVendorGrnNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `VGRN-${year}-`;
  const last = await VendorGrn.findOne({ grnNumber: { $regex: `^${prefix}\\d+$` } })
    .sort({ createdAt: -1 })
    .select('grnNumber')
    .lean();
  let seq = 1;
  if (last?.grnNumber) {
    const m = last.grnNumber.match(GRN_BASE_PATTERN);
    seq = m ? parseInt(m[2], 10) + 1 : 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
};

/**
 * Append GRN id to VPO grnHistory[].
 * @param {string} vpoId
 * @param {mongoose.Types.ObjectId} grnId
 */
const linkGrnToVpo = async (vpoId, grnId) => {
  await VendorPurchaseOrder.updateOne({ _id: vpoId }, { $push: { grnHistory: grnId } });
};

/**
 * Load flow + VPO + accepted boxes for snapshot building.
 * @param {string} flowId
 */
const loadFlowContext = async (flowId) => {
  const flow = await VendorProductionFlow.findById(flowId)
    .populate({ path: 'vendor', select: 'header' })
    .populate({ path: 'vendorPurchaseOrder' })
    .populate({ path: 'product', select: 'name vendorCode' })
    .lean();
  if (!flow) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
  }
  const vpoId = flow.vendorPurchaseOrder?._id || flow.vendorPurchaseOrder;
  const vpo =
    flow.vendorPurchaseOrder && typeof flow.vendorPurchaseOrder === 'object'
      ? flow.vendorPurchaseOrder
      : await VendorPurchaseOrder.findById(vpoId).lean();
  if (!vpo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor purchase order not found');
  }
  const boxes = await VendorBox.find({
    vendorPurchaseOrderId: vpoId,
    productId: flow.product?._id || flow.product,
    secondaryCheckingAccepted: true,
  }).lean();
  return { flow, vpo, boxes };
};

/**
 * Find active GRN for a VPO + invoice/lot number (grouping key).
 * @param {string|import('mongoose').Types.ObjectId} vpoId
 * @param {string} lotNumber
 */
const findActiveGrnForInvoice = async (vpoId, lotNumber) => {
  const lot = String(lotNumber || '').trim();
  if (!vpoId || !lot) return null;
  return VendorGrn.findOne({
    status: 'active',
    vendorPurchaseOrder: vpoId,
    'lots.lotNumber': lot,
  })
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Merge per-flow lot snapshots into one invoice-level GRN snapshot.
 * @param {Array<{ lots: Array<Object>, totals: Object }>} snapshots
 * @returns {{ lots: Array<Object>, totals: Object }}
 */
const mergeInvoiceSnapshots = (snapshots) => {
  const lotMap = new Map();
  const totals = { expected: 0, verified: 0, variance: 0, m1: 0, m2: 0, m3: 0, m4: 0 };

  snapshots.forEach((snap) => {
    (snap.lots || []).forEach((lot) => {
      const key = String(lot.lotNumber || '').trim();
      if (!key) return;
      const existing = lotMap.get(key);
      if (!existing) {
        lotMap.set(key, {
          lotNumber: key,
          numberOfBoxes: Number(lot.numberOfBoxes) || 0,
          totalUnits: Number(lot.totalUnits) || 0,
          items: [...(lot.items || [])],
        });
        return;
      }
      existing.numberOfBoxes = Math.max(existing.numberOfBoxes, Number(lot.numberOfBoxes) || 0);
      existing.totalUnits += Number(lot.totalUnits) || 0;
      (lot.items || []).forEach((item) => {
        const flowId = String(item.vendorProductionFlowId || '');
        const idx = existing.items.findIndex(
          (it) => String(it.vendorProductionFlowId || '') === flowId
        );
        if (idx >= 0) existing.items[idx] = item;
        else existing.items.push(item);
      });
    });
    totals.expected += Number(snap.totals?.expected) || 0;
    totals.verified += Number(snap.totals?.verified) || 0;
    totals.variance += Number(snap.totals?.variance) || 0;
    totals.m1 += Number(snap.totals?.m1) || 0;
    totals.m2 += Number(snap.totals?.m2) || 0;
    totals.m3 += Number(snap.totals?.m3) || 0;
    totals.m4 += Number(snap.totals?.m4) || 0;
  });

  return { lots: [...lotMap.values()], totals };
};

/**
 * Build merged GRN snapshot for all classified flows sharing an invoice on a VPO.
 * @param {string|import('mongoose').Types.ObjectId} vpoId
 * @param {string} lotNumber
 */
const buildInvoiceGrnSnapshot = async (vpoId, lotNumber) => {
  const lot = String(lotNumber || '').trim();
  if (!vpoId || !lot) return null;

  const vpo = await VendorPurchaseOrder.findById(vpoId).lean();
  if (!vpo) return null;

  const boxes = await VendorBox.find({
    vendorPurchaseOrderId: vpoId,
    lotNumber: lot,
    secondaryCheckingAccepted: true,
  }).lean();

  const productIds = [...new Set(boxes.map((b) => String(b.productId)).filter(Boolean))];
  const flowQuery = productIds.length
    ? {
        vendorPurchaseOrder: vpoId,
        $or: [
          { product: { $in: productIds } },
          { 'floorQuantities.secondaryChecking.receivedData.lotNumber': lot },
        ],
      }
    : {
        vendorPurchaseOrder: vpoId,
        'floorQuantities.secondaryChecking.receivedData.lotNumber': lot,
      };

  const flows = await VendorProductionFlow.find(flowQuery)
    .populate({ path: 'product', select: 'name vendorCode' })
    .lean();

  const snapshots = [];
  for (const flow of flows) {
    const sc = flow.floorQuantities?.secondaryChecking || {};
    const classified =
      Number(sc.m1Quantity || 0) +
      Number(sc.m2Quantity || 0) +
      Number(sc.m3Quantity || 0) +
      Number(sc.vm4Quantity ?? sc.m4Quantity ?? 0);
    if (classified <= 0) continue;

    const flowProductId = String(flow.product?._id || flow.product || '');
    const flowBoxes = boxes.filter((b) => String(b.productId) === flowProductId);
    const snap = buildSnapshotFromFlow({
      flow,
      vpo,
      boxes: flowBoxes,
      lotNumberFilter: lot,
    });
    if ((snap.lots || []).length > 0 && (snap.totals?.verified || 0) > 0) {
      snapshots.push(snap);
    }
  }

  if (snapshots.length === 0) return null;
  return mergeInvoiceSnapshots(snapshots);
};

/**
 * Whether every flow with scan-accepted boxes on this invoice is SC-complete.
 * @param {string|import('mongoose').Types.ObjectId} vpoId
 * @param {string} lotNumber
 */
const evaluateInvoiceGrnCompleteness = async (vpoId, lotNumber) => {
  const lot = String(lotNumber || '').trim();
  if (!vpoId || !lot) return { incomplete: true };

  const boxes = await VendorBox.find({
    vendorPurchaseOrderId: vpoId,
    lotNumber: lot,
    secondaryCheckingAccepted: true,
  })
    .select('productId')
    .lean();

  const productIds = [...new Set(boxes.map((b) => b.productId).filter(Boolean))];
  if (productIds.length === 0) return { incomplete: true };

  const flows = await VendorProductionFlow.find({
    vendorPurchaseOrder: vpoId,
    product: { $in: productIds },
  })
    .select('floorQuantities.secondaryChecking')
    .lean();

  const incomplete = flows.some((flow) => !isScReadyForGrn(flow.floorQuantities?.secondaryChecking));
  return { incomplete };
};

/**
 * Insert GRN with E11000 retry on grnNumber collision.
 * @param {Object} payload
 */
const insertWithRetry = async (payload) => {
  try {
    return await VendorGrn.create(payload);
  } catch (err) {
    if (err?.code === 11000) {
      payload.grnNumber = await generateVendorGrnNumber();
      payload.baseGrnNumber = payload.revisionOf ? payload.baseGrnNumber : payload.grnNumber;
      return VendorGrn.create(payload);
    }
    throw err;
  }
};

/**
 * Persist a new active GRN from a pre-built snapshot.
 * @param {Object} params
 */
const createGrnFromSnapshot = async ({
  snapshot,
  flow,
  vpo,
  reqUser,
  opts = {},
  incomplete = false,
}) => {
  const grnNumber = await generateVendorGrnNumber();
  const variance = snapshot.totals?.variance || 0;
  const payload = {
    grnNumber,
    baseGrnNumber: grnNumber,
    grnDate: new Date(),
    status: 'active',
    revisionOf: null,
    revisionNo: 0,
    ...buildGrnHeaderFromFlow(flow, vpo),
    lots: snapshot.lots,
    totals: snapshot.totals,
    secondaryCheckingCompletedAt: incomplete ? null : new Date(),
    incompleteClassification: incomplete,
    discrepancyDetails: variance !== 0 ? (opts.discrepancyDetails || '') : '',
    notes: opts.notes || '',
    createdBy: buildCreatedBy(reqUser),
  };

  const grn = await insertWithRetry(payload);
  await linkGrnToVpo(vpo._id, grn._id);
  return leanToClient(grn.toObject());
};

/**
 * Issue or update GRN(s) for the invoice number(s) on a production flow.
 * @param {string} flowId
 * @param {Object} reqUser
 * @param {Object} [opts]
 */
export const issueGrnFromFlow = async (flowId, reqUser, opts = {}) => {
  const { flow, vpo, boxes } = await loadFlowContext(flowId);
  const sc = flow.floorQuantities?.secondaryChecking || {};
  const classified = Number(sc.m1Quantity || 0) + Number(sc.m2Quantity || 0)
    + Number(sc.m3Quantity || 0) + Number(sc.vm4Quantity ?? sc.m4Quantity ?? 0);

  if (classified <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot issue GRN — no classified quantity on secondary checking');
  }

  const incomplete = !isScReadyForGrn(sc);
  if (incomplete && !opts.allowIncomplete) {
    const pending = Number(sc.pendingFromBoxes || 0);
    const msg =
      pending > 0
        ? 'Secondary checking has unscanned boxes — scan all boxes and complete M1+M2+M3+VM4 before GRN'
        : 'Secondary checking classification is incomplete — confirm manual issue or complete M1+M2+M3+VM4';
    throw new ApiError(httpStatus.BAD_REQUEST, msg);
  }

  const invoiceLots = collectLotNumbers(flow, boxes);
  if (invoiceLots.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot issue GRN — invoice number is missing on this flow');
  }

  let resultGrn = null;
  for (const lotNumber of invoiceLots) {
    const snapshot = await buildInvoiceGrnSnapshot(vpo._id, lotNumber);
    if (!snapshot || (snapshot.totals?.verified || 0) <= 0) continue;

    const { incomplete: invoiceIncomplete } = await evaluateInvoiceGrnCompleteness(vpo._id, lotNumber);
    const existing = await findActiveGrnForInvoice(vpo._id, lotNumber);
    if (existing) {
      const sameTotals = JSON.stringify(existing.totals) === JSON.stringify(snapshot.totals);
      if (sameTotals) {
        resultGrn = leanToClient(existing);
        continue;
      }
      resultGrn = await reviseGrn(
        existing,
        flow,
        vpo,
        snapshot,
        reqUser,
        opts.revisionReason || 'Secondary checking quantities updated',
        invoiceIncomplete
      );
      continue;
    }

    resultGrn = await createGrnFromSnapshot({
      snapshot,
      flow,
      vpo,
      reqUser,
      opts,
      incomplete: invoiceIncomplete,
    });
  }

  if (!resultGrn) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot issue GRN — no verified quantity for invoice on this VPO');
  }
  return resultGrn;
};

/**
 * Revise an active GRN when verified totals change.
 * @param {Object} parentGrn
 * @param {Object} flow
 * @param {Object} vpo
 * @param {Object} snapshot - merged invoice snapshot
 * @param {Object} reqUser
 * @param {string} reason
 */
export const reviseGrn = async (
  parentGrn,
  flow,
  vpo,
  snapshot,
  reqUser,
  reason,
  incomplete = null
) => {
  const diff = computeSnapshotDiff(parentGrn, snapshot);
  const baseNumber = parentGrn.baseGrnNumber || parentGrn.grnNumber.replace(/-R\d+$/, '');
  const nextRevisionNo = (parentGrn.revisionNo || 0) + 1;
  const revisionNumber = `${baseNumber}-R${nextRevisionNo}`;
  const invoiceIncomplete =
    incomplete == null ? !isScReadyForGrn(flow.floorQuantities?.secondaryChecking) : incomplete;

  const payload = {
    grnNumber: revisionNumber,
    baseGrnNumber: baseNumber,
    grnDate: new Date(),
    status: 'active',
    revisionOf: parentGrn._id,
    revisionNo: nextRevisionNo,
    revisionReason: reason || 'Secondary checking quantities updated',
    revisionDiff: diff,
    ...buildGrnHeaderFromFlow(flow, vpo),
    lots: snapshot.lots,
    totals: snapshot.totals,
    secondaryCheckingCompletedAt: invoiceIncomplete ? null : new Date(),
    incompleteClassification: invoiceIncomplete,
    discrepancyDetails: parentGrn.discrepancyDetails || '',
    notes: parentGrn.notes || '',
    createdBy: buildCreatedBy(reqUser),
  };

  const newGrn = await insertWithRetry(payload);
  await VendorGrn.updateOne(
    { _id: parentGrn._id, status: 'active' },
    { $set: { status: 'superseded', supersededAt: new Date(), supersededByGrn: newGrn._id } }
  );
  await linkGrnToVpo(vpo._id, newGrn._id);
  return leanToClient(newGrn.toObject());
};

/**
 * Auto-issue GRN when secondary checking is fully classified.
 * @param {string} flowId
 * @param {Object} reqUser
 */
export const tryAutoIssueFromFlow = async (flowId, reqUser) => {
  const flow = await VendorProductionFlow.findById(flowId).lean();
  if (!flow) return null;
  const sc = flow.floorQuantities?.secondaryChecking;
  if (!isScReadyForGrn(sc)) return null;
  try {
    return await issueGrnFromFlow(flowId, reqUser, { allowIncomplete: false });
  } catch (err) {
    if (err?.statusCode === httpStatus.BAD_REQUEST) return null;
    throw err;
  }
};

/**
 * Idempotent ensure GRNs for all completed flows on a VPO.
 * @param {string} vpoId
 * @param {Object} reqUser
 */
export const ensureGrnsForVpo = async (vpoId, reqUser) => {
  const flows = await VendorProductionFlow.find({ vendorPurchaseOrder: vpoId }).lean();
  const issued = [];
  for (const flow of flows) {
    const sc = flow.floorQuantities?.secondaryChecking;
    if (!isScReadyForGrn(sc)) continue;
    const grn = await tryAutoIssueFromFlow(String(flow._id), reqUser);
    if (grn) issued.push(grn);
  }
  return issued;
};

/**
 * Paginated GRN list.
 * @param {Object} filter
 * @param {Object} options
 */
export const queryGrns = async (filter, options) =>
  VendorGrn.paginate(filter, { sortBy: 'createdAt:desc', ...options });

/**
 * @param {string} id
 */
export const getGrnById = async (id) => {
  const grn = await VendorGrn.findById(id).lean();
  if (!grn) return null;
  if (grn.revisionOf) {
    const parent = await VendorGrn.findById(grn.revisionOf)
      .select('grnNumber baseGrnNumber revisionNo status')
      .lean();
    grn.parent = parent ? leanToClient(parent) : null;
  }
  return leanToClient(grn);
};

/**
 * @param {string} grnNumber
 */
export const getGrnByNumber = async (grnNumber) => {
  const grn = await VendorGrn.findOne({ grnNumber }).lean();
  return leanToClient(grn);
};

/**
 * @param {string} vpoId
 * @param {Object} [opts]
 */
export const getGrnsByVpo = async (vpoId, opts = {}) => {
  const filter = { vendorPurchaseOrder: vpoId };
  if (!opts.includeSuperseded) filter.status = 'active';
  const grns = await VendorGrn.find(filter).sort({ createdAt: -1 }).lean();
  return grns.map(leanToClient);
};

/**
 * @param {string} lotNumber
 * @param {Object} [opts]
 */
export const getGrnsByLot = async (lotNumber, opts = {}) => {
  const filter = { 'lots.lotNumber': lotNumber };
  if (!opts.includeSuperseded) filter.status = 'active';
  const grns = await VendorGrn.find(filter).sort({ createdAt: -1 }).lean();
  return grns.map(leanToClient);
};

/**
 * Active GRN for a flow (if any) — resolved via invoice/lot grouping key.
 * @param {string} flowId
 */
export const getActiveGrnForFlow = async (flowId) => {
  const { flow, vpo, boxes } = await loadFlowContext(flowId);
  const invoiceLots = collectLotNumbers(flow, boxes);
  for (const lotNumber of invoiceLots) {
    const grn = await findActiveGrnForInvoice(vpo._id, lotNumber);
    if (grn) return leanToClient(grn);
  }
  return null;
};

/**
 * @param {string} grnId
 */
export const getRevisionsOf = async (grnId) => {
  const root = await VendorGrn.findById(grnId).select('baseGrnNumber grnNumber').lean();
  if (!root) return [];
  const base = root.baseGrnNumber || root.grnNumber.replace(/-R\d+$/, '');
  const revisions = await VendorGrn.find({
    $or: [{ baseGrnNumber: base }, { grnNumber: base }],
  })
    .sort({ revisionNo: 1, createdAt: 1 })
    .lean();
  return revisions.map(leanToClient);
};

/**
 * Patch non-snapshot header fields (notes, discrepancy).
 * @param {string} grnId
 * @param {Object} fields
 */
export const updateGrnHeader = async (grnId, fields) => {
  const grn = await VendorGrn.findById(grnId);
  if (!grn) throw new ApiError(httpStatus.NOT_FOUND, 'GRN not found');
  if (grn.status !== 'active') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only active GRNs can be updated');
  }
  if (fields.notes !== undefined) grn.notes = fields.notes || '';
  if (fields.discrepancyDetails !== undefined) {
    grn.discrepancyDetails = fields.discrepancyDetails || '';
  }
  await grn.save();
  return leanToClient(grn.toObject());
};
