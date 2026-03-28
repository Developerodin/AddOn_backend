import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { VendorManagement, Product, VendorProductionFlow } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/** Fields loaded when `populate=products` on vendor management */
const VENDOR_PRODUCT_POPULATE_SELECT =
  'name softwareCode internalCode vendorCode status category attributes';

/**
 * Ensure every id exists in Product collection.
 * @param {string[]|mongoose.Types.ObjectId[]} productIds
 */
async function assertProductIdsExist(productIds) {
  if (!productIds?.length) return;
  const ids = [...new Set(productIds.map((id) => String(id)))];
  const count = await Product.countDocuments({ _id: { $in: ids } });
  if (count !== ids.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'One or more product ids are invalid');
  }
}

function normalizeHeader(header) {
  if (!header) return header;
  const h = { ...header };
  if (h.vendorCode != null) h.vendorCode = String(h.vendorCode).trim().toUpperCase();
  if (h.status != null) h.status = String(h.status).toLowerCase();
  return h;
}

/**
 * @param {Object} body
 * @returns {Promise<import('mongoose').Document>}
 */
export const createVendorManagement = async (body) => {
  const header = normalizeHeader(body.header);
  if (header?.vendorCode && (await VendorManagement.isVendorCodeTaken(header.vendorCode))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor code already taken');
  }
  if (header?.gstin && (await VendorManagement.isGstinTaken(header.gstin))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'GSTIN already taken');
  }
  if (body.products?.length) {
    await assertProductIdsExist(body.products);
  }
  return VendorManagement.create({
    header,
    contactPersons: body.contactPersons,
    products: body.products || [],
  });
};

/**
 * @param {Object} filter
 * @param {Object} options
 * @param {string} [search]
 */
export const queryVendorManagements = async (filter, options, search) => {
  let mongoFilter = {};

  if (filter.vendorName) {
    mongoFilter['header.vendorName'] = { $regex: filter.vendorName, $options: 'i' };
  }
  if (filter.vendorCode) {
    mongoFilter['header.vendorCode'] = String(filter.vendorCode).trim().toUpperCase();
  }
  if (filter.status) {
    mongoFilter['header.status'] = String(filter.status).toLowerCase();
  }
  if (filter.city) {
    mongoFilter['header.city'] = { $regex: filter.city, $options: 'i' };
  }
  if (filter.state) {
    mongoFilter['header.state'] = { $regex: filter.state, $options: 'i' };
  }

  if (search && typeof search === 'string' && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    const searchFilter = {
      $or: [
        { 'header.vendorName': rx },
        { 'header.vendorCode': rx },
        { 'header.city': rx },
        { 'header.state': rx },
        { 'header.gstin': rx },
        { 'header.notes': rx },
        { 'header.address': rx },
      ],
    };
    mongoFilter = Object.keys(mongoFilter).length ? { $and: [mongoFilter, searchFilter] } : searchFilter;
  }

  const paginateOptions = { ...options };
  let populateProductsForList = false;
  if (paginateOptions.populate === 'products') {
    populateProductsForList = true;
    paginateOptions.populate = {
      path: 'products',
      select: VENDOR_PRODUCT_POPULATE_SELECT,
    };
  }

  const result = await VendorManagement.paginate(mongoFilter, paginateOptions);

  if (populateProductsForList && result.results?.length) {
    result.results = result.results.map((row) => {
      const json = row.toJSON();
      json.products = mergeProductAttributesFromSubdocs(row.products, json.products);
      return json;
    });
  }

  return result;
};

/**
 * Merge JSON product rows with raw `attributes` Map from populated subdocs (toJSON can mangle Maps).
 * @param {unknown[]|undefined} subdocs
 * @param {object[]} jsonProducts
 */
function mergeProductAttributesFromSubdocs(subdocs, jsonProducts) {
  if (!Array.isArray(jsonProducts) || !subdocs?.length) return jsonProducts;
  return jsonProducts.map((jp, i) => {
    const sub = subdocs[i];
    if (!sub) return jp;
    const attrs = sub.get ? sub.get('attributes') : sub.attributes;
    const obj =
      attrs instanceof Map
        ? Object.fromEntries(attrs)
        : attrs && typeof attrs === 'object'
          ? { ...attrs }
          : {};
    return { ...jp, attributes: obj };
  });
}

/**
 * @param {import('mongoose').Types.ObjectId|string} id
 * @param {{ populateProducts?: boolean }} [opts]
 */
export const getVendorManagementById = async (id, opts = {}) => {
  let q = VendorManagement.findById(id);
  if (opts.populateProducts) {
    q = q.populate({
      path: 'products',
      select: VENDOR_PRODUCT_POPULATE_SELECT,
    });
  }
  const doc = await q.exec();
  if (!doc) return null;
  if (opts.populateProducts) {
    const json = doc.toJSON();
    json.products = mergeProductAttributesFromSubdocs(doc.products, json.products);
    return json;
  }
  return doc;
};

/**
 * @param {import('mongoose').Types.ObjectId|string} vendorId
 * @param {Object} updateBody
 */
export const updateVendorManagementById = async (vendorId, updateBody) => {
  const vendor = await VendorManagement.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor management record not found');
  }

  if (updateBody.header) {
    const nextHeader = normalizeHeader({ ...vendor.get('header'), ...updateBody.header });
    if (nextHeader.vendorCode && (await VendorManagement.isVendorCodeTaken(nextHeader.vendorCode, vendorId))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor code already taken');
    }
    if (nextHeader.gstin && (await VendorManagement.isGstinTaken(nextHeader.gstin, vendorId))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'GSTIN already taken');
    }
    vendor.set('header', nextHeader);
  }

  if (updateBody.contactPersons !== undefined) {
    vendor.contactPersons = updateBody.contactPersons;
  }

  if (updateBody.products !== undefined) {
    await assertProductIdsExist(updateBody.products);
    vendor.products = updateBody.products;
  }

  await vendor.save();
  return vendor;
};

/**
 * @param {import('mongoose').Types.ObjectId|string} vendorId
 */
export const deleteVendorManagementById = async (vendorId) => {
  const vendor = await VendorManagement.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor management record not found');
  }
  await vendor.deleteOne();
  return vendor;
};

/**
 * Add product ids to vendor (deduped via $addToSet).
 * @param {import('mongoose').Types.ObjectId|string} vendorId
 * @param {string[]} productIds
 */
export const addProductsToVendor = async (vendorId, productIds) => {
  const vendor = await VendorManagement.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor management record not found');
  }
  await assertProductIdsExist(productIds);
  const oidList = productIds.map((id) => new mongoose.Types.ObjectId(id));
  await VendorManagement.updateOne({ _id: vendorId }, { $addToSet: { products: { $each: oidList } } });
  return getVendorManagementById(vendorId, { populateProducts: true });
};

/**
 * Remove product ids from vendor.
 * @param {import('mongoose').Types.ObjectId|string} vendorId
 * @param {string[]} productIds
 */
export const removeProductsFromVendor = async (vendorId, productIds) => {
  const vendor = await VendorManagement.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor management record not found');
  }
  const oidList = productIds.map((id) => new mongoose.Types.ObjectId(id));
  await VendorManagement.updateOne({ _id: vendorId }, { $pull: { products: { $in: oidList } } });
  return getVendorManagementById(vendorId, { populateProducts: true });
};

/**
 * Query vendor production flow rows.
 * @param {Object} filter
 * @param {Object} options
 * @param {string} [search]
 */
export const queryVendorProductionFlows = async (filter, options, search) => {
  const mongoFilter = {};

  if (filter.vendor) mongoFilter.vendor = new mongoose.Types.ObjectId(filter.vendor);
  if (filter.vendorPurchaseOrder) mongoFilter.vendorPurchaseOrder = new mongoose.Types.ObjectId(filter.vendorPurchaseOrder);
  if (filter.product) mongoFilter.product = new mongoose.Types.ObjectId(filter.product);
  if (filter.currentFloorKey) mongoFilter.currentFloorKey = String(filter.currentFloorKey);

  if (search && typeof search === 'string' && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    mongoFilter.referenceCode = rx;
  }

  const paginateOptions = {
    ...options,
    populate: [
      { path: 'vendor', select: 'header.vendorName header.vendorCode' },
      { path: 'vendorPurchaseOrder', select: 'vpoNumber vendorName currentStatus' },
      { path: 'product', select: 'name softwareCode internalCode status' },
    ],
  };

  return VendorProductionFlow.paginate(mongoFilter, paginateOptions);
};

/**
 * Single vendor production flow by id (same populate shape as list rows).
 * @param {import('mongoose').Types.ObjectId|string} flowId
 */
export const getVendorProductionFlowById = async (flowId) => {
  const doc = await VendorProductionFlow.findById(flowId)
    .populate('vendor', 'header.vendorName header.vendorCode')
    .populate('vendorPurchaseOrder', 'vpoNumber vendorName currentStatus')
    .populate('product', 'name softwareCode internalCode status');
  if (!doc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
  }
  return doc;
};
