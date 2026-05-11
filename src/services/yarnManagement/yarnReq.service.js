import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnRequisition, YarnCatalog, Supplier } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import * as yarnInventoryService from './yarnInventory.service.js';
import { pickYarnCatalogId } from '../../utils/yarnCatalogRef.js';
import {
  createDraftPurchaseOrderForRequisition,
  findLatestDraftPurchaseOrderForSupplier,
  mergeRequisitionLineIntoDraftPo,
} from './yarnRequisitionDraftMerge.helper.js';

const computeAlertStatus = (minQty, availableQty, blockedQty) => {
  if (availableQty < minQty) {
    return 'below_minimum';
  }
  if (blockedQty > availableQty) {
    return 'overbooked';
  }
  return null;
};

/**
 * Recalculate requisition values from actual inventory (boxes + cones)
 * Uses computeInventoryFromStorage for accurate data, not stale YarnInventory
 */
const recalculateRequisitionFromInventory = async (requisition) => {
  const toNumber = (value) => Math.max(0, Number(value ?? 0));
  const yarnId = requisition.yarnCatalogId?._id || requisition.yarnCatalogId;

  const { totalNetWeight, blockedNetWeight } = await yarnInventoryService.computeInventoryFromStorage(yarnId);
  const availableNet = Math.max(totalNetWeight - blockedNetWeight, 0);

  const yarnCatalog = await YarnCatalog.findById(yarnId).lean();
  const minQty = toNumber(yarnCatalog?.minQuantity || requisition.minQty || 0);
  const alertStatus = computeAlertStatus(minQty, availableNet, blockedNetWeight);

  await YarnRequisition.findByIdAndUpdate(requisition._id, {
    minQty,
    availableQty: availableNet,
    blockedQty: blockedNetWeight,
    alertStatus,
  });

  return {
    ...requisition,
    minQty,
    availableQty: availableNet,
    blockedQty: blockedNetWeight,
    alertStatus,
  };
};

/**
 * Parses optional booleans from query strings or primitives.
 * @param {unknown} v
 * @returns {boolean | undefined}
 */
const parseOptionalBoolean = (v) => {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
};

/** @param {string} s */
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @returns {mongoose.Types.ObjectId | null} */
const toObjectId = (id) => {
  if (!id || typeof id !== 'string') return null;
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
};

/**
 * Applies client workflow-stage filter (mutates `filter`). Call after base `created` bounds.
 * @param {Record<string, unknown>} filter Mongo match object
 * @param {string} [workflowStage] in_requisition | sent_to_draft | order_placed | dismissed
 */
const mergeWorkflowIntoFilter = (filter, workflowStage) => {
  if (!workflowStage || typeof workflowStage !== 'string') return;
  const stage = workflowStage.trim();
  if (stage === 'dismissed') return;

  if (stage === 'in_requisition') {
    filter.linkedPurchaseOrderId = { $exists: false };
    filter.poSent = false;
    filter.draftForPo = false;
    filter.attachedDraftPoId = { $exists: false };
    return;
  }
  if (stage === 'sent_to_draft') {
    filter.linkedPurchaseOrderId = { $exists: false };
    filter.$or = [{ draftForPo: true }, { attachedDraftPoId: { $exists: true } }];
    return;
  }
  if (stage === 'order_placed') {
    filter.linkedPurchaseOrderId = { $exists: true, $ne: null };
  }
};

const SORT_FIELDS = {
  yarnName: 'yarnName',
  created: 'created',
  lastUpdated: 'lastUpdated',
  minQty: 'minQty',
  availableQty: 'availableQty',
  blockedQty: 'blockedQty',
};

/**
 * @param {Object} params
 * @param {string} params.startDate
 * @param {string} params.endDate
 * @param {boolean|string} [params.poSent]
 * @param {boolean|string} [params.draftForPo]
 * @param {string} [params.alertStatus] - filter by alert status: 'below_minimum', 'overbooked', or 'has_alert' (either)
 * @param {number} [params.page] - 1-based page number (default 1)
 * @param {number} [params.limit] - results per page (default 50, max 200)
 * @param {string} [params.yarnName] - case-insensitive substring match on yarnName
 * @param {string} [params.lastUpdatedFrom] - ISO lower bound on lastUpdated (inclusive)
 * @param {string} [params.lastUpdatedTo] - ISO upper bound on lastUpdated (end of local day)
 * @param {string} [params.sortBy] - one of yarnName, created, lastUpdated, minQty, availableQty, blockedQty
 * @param {string} [params.sortOrder] - asc | desc (default desc except yarnName asc tie-break friendly)
 * @param {boolean} [params.skipRecalculation] - skip expensive per-row recalculation (for summary/count calls)
 * @param {string} [params.workflowStage] - in_requisition | sent_to_draft | order_placed | dismissed
 * @param {boolean|string} [params.includeDismissed] - when true keep dismissed rows in results
 * @param {string} [params.preferredSupplierId] - ObjectId hex for supplier equality
 * @param {string} [params.supplierName] - case-insensitive substring on preferredSupplierName
 * @returns {Promise<Object>} paginated response with results, page, limit, totalPages, totalResults, alertSummary
 */
export const getYarnRequisitionList = async ({
  startDate,
  endDate,
  poSent,
  draftForPo,
  alertStatus,
  page,
  limit,
  skipRecalculation,
  yarnName,
  lastUpdatedFrom,
  lastUpdatedTo,
  sortBy,
  sortOrder,
  workflowStage,
  includeDismissed,
  preferredSupplierId,
  supplierName,
}) => {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const filter = {
    created: {
      $gte: start,
      $lte: end,
    },
  };

  const workflow = typeof workflowStage === 'string' ? workflowStage.trim() : '';
  if (workflow === 'dismissed') {
    filter.dismissed = true;
  } else {
    const inclDismissed = parseOptionalBoolean(includeDismissed);
    if (!inclDismissed) {
      filter.dismissed = { $ne: true };
    }
    mergeWorkflowIntoFilter(filter, workflow);
  }

  const supplierOid = preferredSupplierId ? toObjectId(String(preferredSupplierId).trim()) : null;
  if (supplierOid) {
    filter.preferredSupplierId = supplierOid;
  }

  const trimmedSupplierSearch = typeof supplierName === 'string' ? supplierName.trim() : '';
  if (trimmedSupplierSearch) {
    filter.preferredSupplierName = {
      $regex: escapeRegex(trimmedSupplierSearch),
      $options: 'i',
    };
  }

  const parsedPoSent = parseOptionalBoolean(poSent);
  if (typeof parsedPoSent === 'boolean') {
    filter.poSent = parsedPoSent;
  }

  const parsedDraft = parseOptionalBoolean(draftForPo);
  if (typeof parsedDraft === 'boolean') {
    filter.draftForPo = parsedDraft;
  }

  if (alertStatus) {
    if (alertStatus === 'has_alert') {
      filter.alertStatus = { $in: ['below_minimum', 'overbooked'] };
    } else {
      filter.alertStatus = alertStatus;
    }
  }

  const trimmedYarn = typeof yarnName === 'string' ? yarnName.trim() : '';
  if (trimmedYarn) {
    filter.yarnName = { $regex: escapeRegex(trimmedYarn), $options: 'i' };
  }

  const luFrom = lastUpdatedFrom ? new Date(lastUpdatedFrom) : null;
  const luToRaw = lastUpdatedTo ? new Date(lastUpdatedTo) : null;
  const luFromOk = luFrom && !Number.isNaN(luFrom.getTime());
  const luToOk = luToRaw && !Number.isNaN(luToRaw.getTime());
  if (luFromOk || luToOk) {
    filter.lastUpdated = {};
    if (luFromOk) {
      filter.lastUpdated.$gte = luFrom;
    }
    if (luToOk) {
      const luToEnd = new Date(luToRaw);
      luToEnd.setHours(23, 59, 59, 999);
      filter.lastUpdated.$lte = luToEnd;
    }
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(Math.max(1, Number(limit) || 50), 200);
  const skip = (pageNum - 1) * limitNum;

  const sortField = SORT_FIELDS[sortBy] || 'lastUpdated';
  const direction = sortOrder === 'asc' ? 1 : -1;

  const [yarnRequisitions, totalResults] = await Promise.all([
    YarnRequisition.find(filter)
      .populate({ path: 'yarnCatalogId', select: '_id yarnName yarnType status' })
      .populate({ path: 'preferredSupplierId', select: '_id brandName' })
      .sort({ [sortField]: direction })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    YarnRequisition.countDocuments(filter),
  ]);

  let results;
  if (skipRecalculation) {
    results = yarnRequisitions;
  } else {
    results = await Promise.all(
      yarnRequisitions.map(async (req) => {
        try {
          return await recalculateRequisitionFromInventory(req);
        } catch (error) {
          console.error(`Error recalculating requisition for ${req.yarnName}:`, error.message);
          return req;
        }
      })
    );
  }

  const alertSummary = await YarnRequisition.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        pendingCount: { $sum: { $cond: [{ $eq: ['$poSent', false] }, 1, 0] } },
        belowMinimumCount: { $sum: { $cond: [{ $eq: ['$alertStatus', 'below_minimum'] }, 1, 0] } },
        overbookedCount: { $sum: { $cond: [{ $eq: ['$alertStatus', 'overbooked'] }, 1, 0] } },
      },
    },
  ]);

  const summary = alertSummary[0] || { total: 0, pendingCount: 0, belowMinimumCount: 0, overbookedCount: 0 };

  return {
    results,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(totalResults / limitNum) || 1,
    totalResults,
    alertSummary: {
      total: summary.total,
      pendingDeliveries: summary.pendingCount,
      alertCount: summary.belowMinimumCount + summary.overbookedCount,
      belowMinimumCount: summary.belowMinimumCount,
      overbookedCount: summary.overbookedCount,
    },
  };
};

export const createYarnRequisition = async (yarnRequisitionBody) => {
  const catalogId = pickYarnCatalogId(yarnRequisitionBody);
  const payload = {
    ...yarnRequisitionBody,
    poSent: yarnRequisitionBody.poSent ?? false,
    draftForPo: yarnRequisitionBody.draftForPo ?? false,
  };
  if (catalogId) payload.yarnCatalogId = catalogId;

  payload.alertStatus = computeAlertStatus(payload.minQty, payload.availableQty, payload.blockedQty);

  const yarnRequisition = await YarnRequisition.create(payload);
  return yarnRequisition;
};

async function populateRequisitionResponse(id) {
  return YarnRequisition.findById(id)
    .populate({ path: 'yarnCatalogId', select: '_id yarnName yarnType status' })
    .populate({ path: 'preferredSupplierId', select: '_id brandName' })
    .lean();
}

/**
 * PATCH requisition vendor and/or workflow (optional merge into supplier’s newest draft PO).
 * @param {string} yarnRequisitionId
 * @param {Object} updates
 */
export const patchYarnRequisition = async (yarnRequisitionId, updates = {}) => {
  const doc = await YarnRequisition.findById(yarnRequisitionId);
  if (!doc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn requisition not found');
  }
  if (doc.dismissed) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Dismissed requisition cannot be edited');
  }

  const wantsStaging = updates.poSent === true && updates.draftForPo === true;

  if (updates.preferredSupplierId !== undefined) {
    if (!updates.preferredSupplierId) {
      doc.preferredSupplierId = undefined;
      doc.preferredSupplierName = '';
    } else {
      const oid = toObjectId(String(updates.preferredSupplierId));
      if (!oid) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid preferredSupplierId');
      }
      doc.preferredSupplierId = oid;
    }
  }

  if (typeof updates.preferredSupplierName === 'string') {
    doc.preferredSupplierName = updates.preferredSupplierName.trim();
  }

  const idWasSetToSupplier =
    updates.preferredSupplierId &&
    String(updates.preferredSupplierId).trim() !== '' &&
    mongoose.Types.ObjectId.isValid(String(updates.preferredSupplierId).trim());
  if (
    doc.preferredSupplierId &&
    idWasSetToSupplier &&
    typeof updates.preferredSupplierName !== 'string'
  ) {
    const sup = await Supplier.findById(doc.preferredSupplierId).select('brandName').lean();
    if (sup?.brandName) {
      doc.preferredSupplierName = sup.brandName;
    }
  }

  if (wantsStaging) {
    if (!doc.preferredSupplierId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Preferred supplier is required to send to draft PO');
    }
    const draftPo = await findLatestDraftPurchaseOrderForSupplier(doc.preferredSupplierId);
    if (draftPo) {
      await mergeRequisitionLineIntoDraftPo(draftPo, doc);
      doc.poSent = true;
      doc.draftForPo = false;
      doc.attachedDraftPoId = draftPo._id;
    } else {
      const newDraftPo = await createDraftPurchaseOrderForRequisition(doc);
      doc.poSent = true;
      doc.draftForPo = false;
      doc.attachedDraftPoId = newDraftPo._id;
    }
  } else if (typeof updates.poSent === 'boolean' || typeof updates.draftForPo === 'boolean') {
    if (typeof updates.poSent === 'boolean') doc.poSent = updates.poSent;
    if (typeof updates.draftForPo === 'boolean') doc.draftForPo = updates.draftForPo;
  }

  const vendorOnlyPatch =
    !wantsStaging &&
    updates.poSent === undefined &&
    updates.draftForPo === undefined &&
    (updates.preferredSupplierId !== undefined || typeof updates.preferredSupplierName === 'string');

  await doc.save(vendorOnlyPatch ? { timestamps: false } : {});
  return populateRequisitionResponse(doc._id);
};

/**
 * @deprecated Use patchYarnRequisition (same behavior for legacy callers).
 */
export const updateYarnRequisitionStatus = patchYarnRequisition;

/**
 * Soft-dismiss — removes row from operational lists unless explicitly filtered by dismissed workflow.
 * @param {string} yarnRequisitionId
 */
export const dismissYarnRequisition = async (yarnRequisitionId) => {
  const doc = await YarnRequisition.findById(yarnRequisitionId);
  if (!doc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn requisition not found');
  }
  doc.dismissed = true;
  doc.dismissedAt = new Date();
  doc.draftForPo = false;
  await doc.save();
  return populateRequisitionResponse(doc._id);
};

/**
 * Clears draft-queue flag after a PO is raised or discarded from draft.
 * @param {string[]} requisitionIds Mongo ids
 * @param {string} [linkedPurchaseOrderId] when submit finalizes an order tied to staged lines
 */
export const clearRequisitionDraftFlags = async (requisitionIds, linkedPurchaseOrderId = null) => {
  if (!Array.isArray(requisitionIds) || requisitionIds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'requisitionIds must be a non-empty array');
  }
  const objectIds = requisitionIds.map((id) => new mongoose.Types.ObjectId(id));

  /** @type {{ $set: Record<string, unknown>; $unset?: Record<string, string> }} */
  const op = {
    $set: { draftForPo: false },
    $unset: { attachedDraftPoId: '' },
  };

  const linkedOid =
    typeof linkedPurchaseOrderId === 'string' && linkedPurchaseOrderId.trim()
      ? toObjectId(linkedPurchaseOrderId.trim())
      : null;
  if (linkedOid) {
    op.$set.linkedPurchaseOrderId = linkedOid;
  }

  await YarnRequisition.updateMany({ _id: { $in: objectIds } }, op);
  return { cleared: objectIds.length };
};


