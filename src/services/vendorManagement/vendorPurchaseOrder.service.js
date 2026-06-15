import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { VendorPurchaseOrder, VendorManagement, VendorBox, VendorProductionFlow } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { vendorPurchaseOrderStatuses } from '../../models/vendorManagement/vendorPurchaseOrder.model.js';
import getNextVendorPoNumberForYear from '../../utils/vendorPoNumber.util.js';
import {
  applyVendorPoCreateRoleRules,
  applyVendorPoUpdateRoleRules,
  resolveUserRole,
} from '../../utils/vendorPurchaseOrderRoleAccess.js';

async function assertVendorExists(vendorId) {
  const v = await VendorManagement.findById(vendorId).select('_id').lean();
  if (!v) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor management record not found');
  }
}

function normalizePurchaseOrderUpdateBody(updateBody = {}) {
  const wrapper = updateBody.payload || updateBody.paylode || updateBody.data;
  if (wrapper && typeof wrapper === 'object') {
    return wrapper;
  }
  return updateBody;
}

/**
 * @param {number} [year]
 */
export const createVendorPurchaseOrder = async (purchaseOrderBody, year = new Date().getFullYear(), user) => {
  const role = resolveUserRole(user);
  const scopedBody = applyVendorPoCreateRoleRules(purchaseOrderBody, role);
  await assertVendorExists(scopedBody.vendor);
  const vpoNumber = await getNextVendorPoNumberForYear(year);
  const existing = await VendorPurchaseOrder.findOne({ vpoNumber });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'VPO number already exists');
  }

  const statusLogs = scopedBody.statusLogs || [];
  const currentStatus = scopedBody.currentStatus || vendorPurchaseOrderStatuses[0];

  const payload = {
    ...scopedBody,
    vpoNumber,
    currentStatus,
    statusLogs,
  };

  const doc = await VendorPurchaseOrder.create(payload);
  return doc;
};

/**
 * Creates multiple POs in order; each receives the next VPO number for the given year.
 * @param {{ orders: object[], year?: number }} bulk
 */
export const bulkCreateVendorPurchaseOrders = async (bulk) => {
  const { orders, year: bulkYear } = bulk;
  if (!Array.isArray(orders) || orders.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'orders array is required');
  }
  const created = [];
  /* eslint-disable no-await-in-loop, no-restricted-syntax -- sequential VPO numbers must be strictly ordered */
  for (const raw of orders) {
    const { year: rowYear, ...body } = raw;
    const y = bulkYear ?? rowYear ?? new Date().getFullYear();
    const doc = await createVendorPurchaseOrder(body, y);
    created.push(doc);
  }
  /* eslint-enable no-await-in-loop, no-restricted-syntax */
  return { created, count: created.length, year: bulkYear ?? new Date().getFullYear() };
};

export const queryVendorPurchaseOrders = async (filter, options, search) => {
  let mongoFilter = {};

  if (filter.vendor) mongoFilter.vendor = new mongoose.Types.ObjectId(filter.vendor);
  if (filter.vendorName) mongoFilter.vendorName = { $regex: filter.vendorName, $options: 'i' };
  if (filter.vpoNumber) mongoFilter.vpoNumber = String(filter.vpoNumber).trim();
  if (filter.currentStatus) mongoFilter.currentStatus = filter.currentStatus;

  if (search && typeof search === 'string' && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    const searchFilter = {
      $or: [{ vpoNumber: rx }, { vendorName: rx }, { notes: rx }],
    };
    mongoFilter = Object.keys(mongoFilter).length ? { $and: [mongoFilter, searchFilter] } : searchFilter;
  }

  return VendorPurchaseOrder.paginate(mongoFilter, options);
};

export const getVendorPurchaseOrderById = async (id) =>
  VendorPurchaseOrder.findById(id)
    .populate({ path: 'vendor', select: 'header.vendorName header.vendorCode products' })
    .populate({ path: 'poItems.productId', select: 'name softwareCode internalCode vendorCode status category' })
    .exec();

export const getVendorPurchaseOrderByVpoNumber = async (vpoNumber) =>
  VendorPurchaseOrder.findOne({ vpoNumber: String(vpoNumber).trim() })
    .populate({ path: 'vendor', select: 'header.vendorName header.vendorCode products' })
    .populate({ path: 'poItems.productId', select: 'name softwareCode internalCode vendorCode status category' })
    .exec();

export const updateVendorPurchaseOrderById = async (purchaseOrderId, updateBody, user) => {
  const normalizedBody = normalizePurchaseOrderUpdateBody(updateBody);
  const purchaseOrder = await VendorPurchaseOrder.findById(purchaseOrderId);
  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor purchase order not found');
  }

  const role = resolveUserRole(user);
  const scopedBody = applyVendorPoUpdateRoleRules(normalizedBody, role, purchaseOrder);

  if (scopedBody.vpoNumber && scopedBody.vpoNumber !== purchaseOrder.vpoNumber) {
    const exists = await VendorPurchaseOrder.findOne({
      vpoNumber: scopedBody.vpoNumber,
      _id: { $ne: purchaseOrderId },
    });
    if (exists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'VPO number already exists');
    }
  }

  const safeUpdate = Object.fromEntries(Object.entries(scopedBody).filter(([, value]) => value !== undefined));

  if (scopedBody.vendor) {
    await assertVendorExists(scopedBody.vendor);
  }

  Object.assign(purchaseOrder, safeUpdate);
  await purchaseOrder.save();
  return getVendorPurchaseOrderById(purchaseOrderId);
};

export const deleteVendorPurchaseOrderById = async (purchaseOrderId) => {
  const purchaseOrder = await VendorPurchaseOrder.findById(purchaseOrderId);
  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor purchase order not found');
  }
  await VendorBox.deleteMany({ vendorPurchaseOrderId: purchaseOrderId });
  await VendorProductionFlow.deleteMany({ vendorPurchaseOrder: purchaseOrderId });
  await purchaseOrder.deleteOne();
  return purchaseOrder;
};
