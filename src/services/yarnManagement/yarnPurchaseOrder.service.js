import httpStatus from 'http-status';
import { YarnPurchaseOrder } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { yarnPurchaseOrderStatuses } from '../../models/yarnReq/yarnPurchaseOrder.model.js';

export const getPurchaseOrders = async ({ startDate, endDate, statusCode }) => {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const filter = {
    createDate: {
      $gte: start,
      $lte: end,
    },
  };

  if (statusCode) {
    filter.currentStatus = statusCode;
  }

  const purchaseOrders = await YarnPurchaseOrder.find(filter)
    .populate({
      path: 'supplier',
      select: '_id brandName contactPersonName contactNumber email',
    })
    .populate({
      path: 'poItems.yarn',
      select: '_id yarnName yarnType status',
    })
    .sort({ createDate: -1 })
    .lean();

  return purchaseOrders;
};

export const getPurchaseOrderById = async (purchaseOrderId) => {
  const purchaseOrder = await YarnPurchaseOrder.findById(purchaseOrderId)
    .populate({
      path: 'supplier',
      select: '_id brandName contactPersonName contactNumber email address city state',
    })
    .populate({
      path: 'poItems.yarn',
      select: '_id yarnName yarnType status',
    });

  return purchaseOrder;
};

export const createPurchaseOrder = async (purchaseOrderBody) => {
  const existing = await YarnPurchaseOrder.findOne({ poNumber: purchaseOrderBody.poNumber });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'PO number already exists');
  }

  const statusLogs = purchaseOrderBody.statusLogs || [];
  const currentStatus = purchaseOrderBody.currentStatus || yarnPurchaseOrderStatuses[0];

  const payload = {
    ...purchaseOrderBody,
    currentStatus,
    statusLogs,
  };

  const purchaseOrder = await YarnPurchaseOrder.create(payload);
  return purchaseOrder;
};

export const updatePurchaseOrderById = async (purchaseOrderId, updateBody) => {
  const purchaseOrder = await YarnPurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  if (updateBody.poNumber && updateBody.poNumber !== purchaseOrder.poNumber) {
    const poExists = await YarnPurchaseOrder.findOne({ poNumber: updateBody.poNumber, _id: { $ne: purchaseOrderId } });
    if (poExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'PO number already exists');
    }
  }

  Object.assign(purchaseOrder, updateBody);
  await purchaseOrder.save();
  return purchaseOrder;
};

export const deletePurchaseOrderById = async (purchaseOrderId) => {
  const purchaseOrder = await YarnPurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  await purchaseOrder.deleteOne();
  return purchaseOrder;
};

export const updatePurchaseOrderStatus = async (purchaseOrderId, statusCode, updatedBy, notes = null) => {
  const purchaseOrder = await YarnPurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  if (!yarnPurchaseOrderStatuses.includes(statusCode)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid status code');
  }

  purchaseOrder.currentStatus = statusCode;
  purchaseOrder.statusLogs.push({
    statusCode,
    updatedBy: {
      username: updatedBy.username,
      user: updatedBy.user_id,
    },
    notes: notes || undefined,
  });

  if (statusCode === 'goods_received' || statusCode === 'goods_partially_received') {
    if (!purchaseOrder.goodsReceivedDate) {
      purchaseOrder.goodsReceivedDate = new Date();
    }
  }

  await purchaseOrder.save();
  return purchaseOrder;
};


