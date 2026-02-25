import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { ConsolidationBatch, WhmsOrder } from '../../models/whms/index.js';

const generateBatchCode = async () => {
  const last = await ConsolidationBatch.findOne().sort({ createdAt: -1 }).select('batchCode');
  const seq = last?.batchCode ? parseInt(last.batchCode.replace(/\D/g, ''), 10) + 1 : 1;
  return `BATCH-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
};

export const createBatch = async (body) => {
  const orderIds = body.orderIds || [];
  if (!body.batchCode) body.batchCode = await generateBatchCode();
  let totalItems = 0;
  if (orderIds.length) {
    const orders = await WhmsOrder.find({ _id: { $in: orderIds } }).select('items');
    totalItems = orders.reduce((s, o) => s + (o.items?.reduce((si, i) => si + (i.quantity || 0), 0) || 0), 0);
  }
  const batch = await ConsolidationBatch.create({
    ...body,
    orderIds,
    orderCount: orderIds.length,
    totalItems,
  });
  return batch;
};

export const queryBatches = async (filter, options) => {
  return ConsolidationBatch.paginate(filter, { ...options, populate: 'orderIds' });
};

export const getBatchById = async (id) => {
  return ConsolidationBatch.findById(id).populate('orderIds');
};

export const updateBatchById = async (id, updateBody) => {
  const batch = await ConsolidationBatch.findById(id);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Consolidation batch not found');
  if (updateBody.orderIds) {
    const orders = await WhmsOrder.find({ _id: { $in: updateBody.orderIds } }).select('items');
    batch.totalItems = orders.reduce((s, o) => s + (o.items?.reduce((si, i) => si + (i.quantity || 0), 0) || 0), 0);
    batch.orderCount = updateBody.orderIds.length;
  }
  Object.assign(batch, updateBody);
  await batch.save();
  return getBatchById(id);
};

export const setBatchStatus = async (id, status) => {
  const batch = await ConsolidationBatch.findById(id);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Consolidation batch not found');
  batch.status = status;
  await batch.save();
  return batch;
};
