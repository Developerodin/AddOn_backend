import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { VendorPoReturnChallan, VendorPurchaseOrder } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { buildVendorReturnChallanSnapshot } from './vendorPoReturnChallanSnapshot.builder.js';

const CHALLAN_BASE_PATTERN = /^VPRC-(\d{4})-(\d+)$/;

/**
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
 * Generates the next sequential vendor return challan number.
 * @returns {Promise<string>}
 */
export const generateChallanNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `VPRC-${year}-`;
  const last = await VendorPoReturnChallan.findOne({ challanNumber: { $regex: `^${prefix}\\d+$` } })
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
 * Append challan id to VPO returnChallanHistory[].
 * @param {string} vpoId
 * @param {mongoose.Types.ObjectId} challanId
 */
const linkChallanToVpo = async (vpoId, challanId) => {
  if (!vpoId || !challanId) return;
  await VendorPurchaseOrder.updateOne({ _id: vpoId }, { $push: { returnChallanHistory: challanId } });
};

/**
 * @param {Object} payload
 * @param {Function} numberFactory
 */
const insertWithRetry = async (payload, numberFactory) => {
  try {
    return await VendorPoReturnChallan.create(payload);
  } catch (err) {
    if (err?.code === 11000) {
      if (payload.vendorReturnId) {
        const existing = await VendorPoReturnChallan.findOne({ vendorReturnId: payload.vendorReturnId }).lean();
        if (existing) return existing;
      }
      payload.challanNumber = await numberFactory();
      return VendorPoReturnChallan.create(payload);
    }
    throw err;
  }
};

/**
 * Issue challan snapshot from a completed vendor return session.
 * @param {Object} vendorReturn - completed return doc (mongoose or lean)
 * @param {Object} reqUser
 * @returns {Promise<Object>}
 */
export const createChallanFromVendorReturn = async (vendorReturn, reqUser) => {
  if (!vendorReturn?._id && !vendorReturn?.id) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor return required');
  }
  const returnId = vendorReturn._id || vendorReturn.id;
  const existing = await VendorPoReturnChallan.findOne({ vendorReturnId: returnId }).lean();
  if (existing) return leanToClient(existing);

  const vpo = await VendorPurchaseOrder.findById(vendorReturn.vendorPurchaseOrder)
    .populate({ path: 'vendor', select: 'header' })
    .lean();
  if (!vpo) throw new ApiError(httpStatus.NOT_FOUND, 'Vendor purchase order not found');

  const snapshot = buildVendorReturnChallanSnapshot(vendorReturn, vpo);
  const challanNumber = await generateChallanNumber();
  const payload = {
    challanNumber,
    challanDate: new Date(),
    status: 'active',
    vendorReturnId: returnId,
    ...snapshot,
    createdBy: buildCreatedBy(reqUser),
  };

  const challan = await insertWithRetry(payload, generateChallanNumber);
  await linkChallanToVpo(vpo._id, challan._id);
  return leanToClient(challan.toObject ? challan.toObject() : challan);
};

/**
 * @param {Object} filter
 * @param {Object} options
 */
export const queryChallans = async (filter, options) =>
  VendorPoReturnChallan.paginate(filter, { sortBy: 'createdAt:desc', ...options });

/**
 * @param {string} id
 */
export const getChallanById = async (id) => leanToClient(await VendorPoReturnChallan.findById(id).lean());

/**
 * @param {string} challanNumber
 */
export const getChallanByNumber = async (challanNumber) =>
  leanToClient(await VendorPoReturnChallan.findOne({ challanNumber }).lean());

/**
 * @param {string} vpoId
 */
export const getChallansByVpo = async (vpoId) => {
  const rows = await VendorPoReturnChallan.find({ vendorPurchaseOrder: vpoId })
    .sort({ createdAt: -1 })
    .lean();
  return rows.map(leanToClient);
};

/**
 * Patch transport fields only (no revision).
 * @param {string} challanId
 * @param {Object} fields
 */
export const patchChallanTransport = async (challanId, fields) => {
  const challan = await VendorPoReturnChallan.findById(challanId);
  if (!challan) throw new ApiError(httpStatus.NOT_FOUND, 'Challan not found');
  challan.transport = challan.transport || {};
  if (fields.vehicleNo !== undefined) challan.transport.vehicleNo = fields.vehicleNo || '';
  if (fields.driverName !== undefined) challan.transport.driverName = fields.driverName || '';
  if (fields.dispatchDate !== undefined) {
    challan.transport.dispatchDate = fields.dispatchDate ? new Date(fields.dispatchDate) : null;
  }
  if (fields.transportNotes !== undefined) challan.transport.transportNotes = fields.transportNotes || '';
  await challan.save();
  return leanToClient(challan.toObject());
};
