import httpStatus from 'http-status';
import { YarnRequisition, YarnInventory, YarnCatalog } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

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
 * Recalculate requisition values from actual inventory
 * This ensures requisitions always show accurate data
 */
const recalculateRequisitionFromInventory = async (requisition) => {
  const toNumber = (value) => Math.max(0, Number(value ?? 0));

  // Get current inventory for this yarn
  const inventory = await YarnInventory.findOne({ yarn: requisition.yarn }).lean();
  if (!inventory) {
    // No inventory exists, set to zero
    return {
      ...requisition,
      availableQty: 0,
      blockedQty: 0,
      alertStatus: 'below_minimum',
    };
  }

  // Get yarn catalog for minQty
  const yarnCatalog = await YarnCatalog.findById(requisition.yarn).lean();
  const minQty = toNumber(yarnCatalog?.minQuantity || requisition.minQty || 0);

  // Calculate from actual inventory
  const totalNet = toNumber(inventory.totalInventory?.totalNetWeight || 0);
  const blockedNet = Math.max(0, toNumber(inventory.blockedNetWeight || 0));
  const availableNet = Math.max(totalNet - blockedNet, 0);

  // Calculate alert status
  const alertStatus = computeAlertStatus(minQty, availableNet, blockedNet);

  // Update requisition in database
  await YarnRequisition.findByIdAndUpdate(requisition._id, {
    minQty,
    availableQty: availableNet,
    blockedQty: blockedNet,
    alertStatus,
  });

  // Return updated requisition data
  return {
    ...requisition,
    minQty,
    availableQty: availableNet,
    blockedQty: blockedNet,
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
      path: 'yarn',
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
  const payload = {
    ...yarnRequisitionBody,
    poSent: yarnRequisitionBody.poSent ?? false,
  };

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


