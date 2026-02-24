import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { InwardRecord } from '../../models/whms/index.js';
import { enrichItemsWithProduct } from './productResolution.service.js';

const generateGrnNumber = async () => {
  const last = await InwardRecord.findOne().sort({ createdAt: -1 }).select('grnNumber');
  const seq = last?.grnNumber ? parseInt(last.grnNumber.replace(/\D/g, ''), 10) + 1 : 1;
  return `GRN-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
};

export const createInward = async (body) => {
  if (!body.grnNumber) body.grnNumber = await generateGrnNumber();
  if (body.items?.length) body.totalItems = body.items.reduce((s, i) => s + (i.orderedQty || 0), 0);
  const record = await InwardRecord.create(body);
  return record;
};

export const queryInward = async (filter, options) => {
  return InwardRecord.paginate(filter, options);
};

export const getInwardById = async (id) => {
  const record = await InwardRecord.findById(id).populate('items.productId', 'name image softwareCode');
  if (!record) return null;
  const doc = record.toObject ? record.toObject() : record;
  if (doc.items?.length) doc.items = await enrichItemsWithProduct(doc.items);
  return doc;
};

export const updateInwardById = async (id, updateBody) => {
  const record = await InwardRecord.findById(id);
  if (!record) throw new ApiError(httpStatus.NOT_FOUND, 'GRN not found');
  if (updateBody.items) {
    updateBody.totalItems = updateBody.items.reduce((s, i) => s + (i.orderedQty || 0), 0);
    const allReceived = updateBody.items.every(
      (i) => (i.receivedQty ?? 0) + (i.acceptedQty ?? 0) + (i.rejectedQty ?? 0) >= (i.orderedQty ?? 0)
    );
    if (allReceived && !updateBody.status) updateBody.status = 'received';
  }
  Object.assign(record, updateBody);
  await record.save();
  return getInwardById(id);
};
