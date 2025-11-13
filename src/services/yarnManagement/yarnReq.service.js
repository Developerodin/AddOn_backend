import httpStatus from 'http-status';
import { YarnRequisition } from '../../models/index.js';
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

  return yarnRequisitions;
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


