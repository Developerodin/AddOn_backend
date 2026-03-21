import httpStatus from 'http-status';
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

export const getYarnRequisitionList = async ({ startDate, endDate, poSent }) => {
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

  if (typeof poSent === 'boolean') {
    filter.poSent = poSent;
  }

  const yarnRequisitions = await YarnRequisition.find(filter)
    .populate({
      path: 'yarnCatalogId',
      select: '_id yarnName yarnType status',
    })
    .sort({ created: -1 })
    .lean();

  // Recalculate each requisition from actual inventory to ensure accuracy
  const recalculatedRequisitions = await Promise.all(
    yarnRequisitions.map(async (req) => {
      try {
        const recalculated = await recalculateRequisitionFromInventory(req);
        return recalculated;
      } catch (error) {
        console.error(`Error recalculating requisition for ${req.yarnName}:`, error.message);
        return req; // Return original if recalculation fails
      }
    })
  );

  return recalculatedRequisitions;
};

export const createYarnRequisition = async (yarnRequisitionBody) => {
  const catalogId = pickYarnCatalogId(yarnRequisitionBody);
  const payload = {
    ...yarnRequisitionBody,
    poSent: yarnRequisitionBody.poSent ?? false,
  };
  if (catalogId) payload.yarnCatalogId = catalogId;

  payload.alertStatus = computeAlertStatus(payload.minQty, payload.availableQty, payload.blockedQty);

  const yarnRequisition = await YarnRequisition.create(payload);
  return yarnRequisition;
};

export const updateYarnRequisitionStatus = async (yarnRequisitionId, poSent) => {
  const yarnRequisition = await YarnRequisition.findById(yarnRequisitionId);

  if (!yarnRequisition) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn requisition not found');
  }

  yarnRequisition.poSent = poSent;
  await yarnRequisition.save();

  return yarnRequisition;
};


