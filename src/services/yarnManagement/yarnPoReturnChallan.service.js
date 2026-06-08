import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnPoReturnChallan, YarnPurchaseOrder } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { buildReturnChallanSnapshot } from './yarnPoReturnChallanSnapshot.builder.js';

const CHALLAN_BASE_PATTERN = /^PRC-(\d{4})-(\d+)$/;

/**
 * @template T
 * @param {T | null} doc
 * @returns {T | null}
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
 * Generates the next sequential challan number for the current year.
 * @returns {Promise<string>}
 */
export const generateChallanNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `PRC-${year}-`;
  const last = await YarnPoReturnChallan.findOne({ challanNumber: { $regex: `^${prefix}\\d+$` } })
    .sort({ createdAt: -1 })
    .select('challanNumber')
    .lean();
  let seq = 1;
  if (last?.challanNumber) {
    const m = last.challanNumber.match(CHALLAN_BASE_PATTERN);
    seq = m ? parseInt(m[2], 10) + 1 : 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
};

/**
 * @param {object} reqUser
 * @returns {{ user: ?string, username: string, email: string }}
 */
const buildCreatedBy = (reqUser) => {
  const id = reqUser?.id || reqUser?._id?.toString?.() || reqUser?.userId?.toString?.() || null;
  return {
    user: id && mongoose.Types.ObjectId.isValid(id) ? id : null,
    username: reqUser?.username || reqUser?.email || 'system',
    email: reqUser?.email || '',
  };
};

/**
 * Appends challan id to PO returnChallanHistory[].
 * @param {string} purchaseOrderId
 * @param {mongoose.Types.ObjectId} challanId
 */
const linkChallanToPo = async (purchaseOrderId, challanId) => {
  if (!purchaseOrderId || !challanId) return;
  await YarnPurchaseOrder.updateOne(
    { _id: purchaseOrderId },
    { $push: { returnChallanHistory: challanId } }
  );
};

/**
 * @param {object} payload
 * @param {Function} numberFactory
 */
const insertWithRetry = async (payload, numberFactory) => {
  try {
    return await YarnPoReturnChallan.create(payload);
  } catch (err) {
    if (err?.code === 11000) {
      if (payload.vendorReturnId) {
        const existing = await YarnPoReturnChallan.findOne({ vendorReturnId: payload.vendorReturnId }).lean();
        if (existing) return existing;
      }
      payload.challanNumber = await numberFactory();
      return YarnPoReturnChallan.create(payload);
    }
    throw err;
  }
};

/**
 * Creates an immutable challan snapshot for a completed vendor return (idempotent).
 * @param {object} vendorReturn - completed YarnPoVendorReturn lean/doc
 * @param {object} purchaseOrder - YarnPurchaseOrder lean/doc
 * @param {object} [reqUser]
 * @param {{ isLegacy?: boolean, challanDate?: Date }} [options]
 * @returns {Promise<object>}
 */
export const createChallanFromVendorReturn = async (vendorReturn, purchaseOrder, reqUser, options = {}) => {
  if (!vendorReturn?._id) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'vendorReturn is required');
  }
  if (vendorReturn.status !== 'completed') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor return must be completed before issuing challan');
  }

  const vendorReturnId = vendorReturn._id;
  const existing = await YarnPoReturnChallan.findOne({ vendorReturnId }).lean();
  if (existing) return leanToClient(existing);

  const po = purchaseOrder || {};
  const poId = po._id || po.id || vendorReturn.purchaseOrder;
  if (!poId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'purchaseOrder is required for challan');
  }

  const snapshot = await buildReturnChallanSnapshot(vendorReturn, po);
  const challanNumber = await generateChallanNumber();

  const payload = {
    challanNumber,
    challanDate: options.challanDate ? new Date(options.challanDate) : vendorReturn.completedAt || new Date(),
    status: 'active',
    vendorReturnId,
    purchaseOrder: poId,
    poNumber: vendorReturn.poNumber || po.poNumber,
    poDate: po.createDate || po.createdAt || null,
    ...snapshot,
    transport: {},
    isLegacy: Boolean(options.isLegacy),
    createdBy: buildCreatedBy(reqUser),
  };

  const challan = await insertWithRetry(payload, generateChallanNumber);
  await linkChallanToPo(poId, challan._id);
  return leanToClient(challan.toObject ? challan.toObject() : challan);
};

/**
 * @param {object} filter
 * @param {object} options
 */
export const queryChallans = async (filter, options) => {
  return YarnPoReturnChallan.paginate(filter, { sortBy: 'createdAt:desc', ...options });
};

/**
 * @param {string} id
 */
export const getChallanById = async (id) => {
  const challan = await YarnPoReturnChallan.findById(id).lean();
  return leanToClient(challan);
};

/**
 * @param {string} challanNumber
 */
export const getChallanByNumber = async (challanNumber) => {
  const challan = await YarnPoReturnChallan.findOne({ challanNumber: String(challanNumber).trim() }).lean();
  return leanToClient(challan);
};

/**
 * @param {string} vendorReturnId
 */
export const getChallanByVendorReturnId = async (vendorReturnId) => {
  const challan = await YarnPoReturnChallan.findOne({ vendorReturnId }).lean();
  return leanToClient(challan);
};

/**
 * @param {string} purchaseOrderId
 */
export const getChallansByPurchaseOrder = async (purchaseOrderId) => {
  const list = await YarnPoReturnChallan.find({ purchaseOrder: purchaseOrderId, status: 'active' })
    .sort({ createdAt: -1 })
    .lean();
  return list.map(leanToClient);
};

/**
 * Patches transport metadata on an existing challan (no revision).
 * @param {string} challanId
 * @param {object} fields
 */
export const patchChallanTransport = async (challanId, fields = {}) => {
  if (!challanId) return null;
  const $set = {};
  if (typeof fields.vehicleNo === 'string') {
    $set['transport.vehicleNo'] = fields.vehicleNo.trim();
  }
  if (typeof fields.driverName === 'string') {
    $set['transport.driverName'] = fields.driverName.trim();
  }
  if (typeof fields.transportNotes === 'string') {
    $set['transport.transportNotes'] = fields.transportNotes;
  }
  if (fields.dispatchDate) {
    const d = new Date(fields.dispatchDate);
    if (!Number.isNaN(d.getTime())) $set['transport.dispatchDate'] = d;
  }

  const doc =
    Object.keys($set).length === 0
      ? await YarnPoReturnChallan.findById(challanId).lean()
      : await YarnPoReturnChallan.findByIdAndUpdate(challanId, { $set }, { new: true }).lean();
  return leanToClient(doc);
};
