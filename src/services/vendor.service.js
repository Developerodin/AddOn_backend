import httpStatus from 'http-status';
import { Vendor } from '../models/index.js';
import ApiError from '../utils/ApiError.js';

/**
 * Create a vendor
 * @param {Object} vendorBody
 * @returns {Promise<Vendor>}
 */
export const createVendor = async (vendorBody) => {
  if (vendorBody.vendorCode && (await Vendor.isVendorCodeTaken(vendorBody.vendorCode))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor code already taken');
  }
  if (vendorBody.email && (await Vendor.isEmailTaken(vendorBody.email))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  return Vendor.create(vendorBody);
};

/**
 * Query for vendors
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [search] - Search term for multi-field search
 * @returns {Promise<QueryResult>}
 */
export const queryVendors = async (filter, options, search) => {
  if (filter.vendorName) {
    filter.vendorName = { $regex: filter.vendorName, $options: 'i' };
  }
  if (filter.vendorCode) {
    filter.vendorCode = filter.vendorCode.toUpperCase();
  }
  if (filter.email) {
    filter.email = filter.email.toLowerCase();
  }
  if (filter.status) {
    filter.status = String(filter.status).toLowerCase();
  }

  if (search && typeof search === 'string' && search.trim()) {
    const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedSearch, 'i');
    const searchFilter = {
      $or: [{ vendorName: searchRegex }, { vendorCode: searchRegex }, { contactPerson: searchRegex }, { phone: searchRegex }, { email: searchRegex }, { gstin: searchRegex }],
    };

    if (Object.keys(filter).length > 0) {
      filter = { $and: [filter, searchFilter] };
    } else {
      filter = searchFilter;
    }
  }

  return Vendor.paginate(filter, options);
};

/**
 * Get vendor by id
 * @param {ObjectId} id
 * @returns {Promise<Vendor>}
 */
export const getVendorById = async (id) => {
  return Vendor.findById(id);
};

/**
 * Update vendor by id
 * @param {ObjectId} vendorId
 * @param {Object} updateBody
 * @returns {Promise<Vendor>}
 */
export const updateVendorById = async (vendorId, updateBody) => {
  const vendor = await getVendorById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor not found');
  }

  if (updateBody.vendorCode && (await Vendor.isVendorCodeTaken(updateBody.vendorCode, vendorId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor code already taken');
  }
  if (updateBody.email && (await Vendor.isEmailTaken(updateBody.email, vendorId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }

  Object.assign(vendor, updateBody);
  await vendor.save();
  return vendor;
};

/**
 * Delete vendor by id
 * @param {ObjectId} vendorId
 * @returns {Promise<Vendor>}
 */
export const deleteVendorById = async (vendorId) => {
  const vendor = await getVendorById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor not found');
  }
  await vendor.deleteOne();
  return vendor;
};
