import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnRequisition, YarnCatalog } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import * as yarnInventoryService from './yarnInventory.service.js';
import { pickYarnCatalogId } from '../../utils/yarnCatalogRef.js';

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

/**
 * @param {Object} params
 * @param {string} params.startDate
 * @param {string} params.endDate
 * @param {boolean|string} [params.poSent]
 * @param {boolean|string} [params.draftForPo]
 * @param {string} [params.alertStatus] - filter by alert status: 'below_minimum', 'overbooked', or 'has_alert' (either)
 * @param {number} [params.page] - 1-based page number (default 1)
 * @param {number} [params.limit] - results per page (default 50, max 200)
 * @param {boolean} [params.skipRecalculation] - skip expensive per-row recalculation (for summary/count calls)
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

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(Math.max(1, Number(limit) || 50), 200);
  const skip = (pageNum - 1) * limitNum;

  const [yarnRequisitions, totalResults] = await Promise.all([
    YarnRequisition.find(filter)
      .populate({ path: 'yarnCatalogId', select: '_id yarnName yarnType status' })
      .sort({ created: -1 })
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

/**
 * @param {string} yarnRequisitionId
 * @param {{ poSent: boolean; draftForPo?: boolean }} updates
 */
export const updateYarnRequisitionStatus = async (yarnRequisitionId, updates) => {
  const $set = { poSent: updates.poSent };
  if (typeof updates.draftForPo === 'boolean') {
    $set.draftForPo = updates.draftForPo;
  }

  const yarnRequisition = await YarnRequisition.findOneAndUpdate(
    { _id: yarnRequisitionId },
    { $set },
    { new: true, runValidators: true }
  ).lean();

  if (!yarnRequisition) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn requisition not found');
  }

  return yarnRequisition;
};

/**
 * Clears draft-queue flag after a PO is raised or discarded from draft.
 * @param {string[]} requisitionIds Mongo ids
 */
export const clearRequisitionDraftFlags = async (requisitionIds) => {
  if (!Array.isArray(requisitionIds) || requisitionIds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'requisitionIds must be a non-empty array');
  }
  const objectIds = requisitionIds.map((id) => new mongoose.Types.ObjectId(id));
  await YarnRequisition.updateMany({ _id: { $in: objectIds } }, { $set: { draftForPo: false } });
  return { cleared: objectIds.length };
};


