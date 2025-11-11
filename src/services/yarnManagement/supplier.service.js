import httpStatus from 'http-status';
import { Supplier, YarnType } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Validate yarnsubtype exists in the YarnType's details array
 * @param {ObjectId} yarnTypeId - The YarnType ID
 * @param {ObjectId} yarnsubtypeId - The detail item ID
 * @returns {Promise<boolean>}
 */
const validateYarnSubtype = async (yarnTypeId, yarnsubtypeId) => {
  if (!yarnsubtypeId) return true; // Optional field
  
  const yarnType = await YarnType.findById(yarnTypeId);
  if (!yarnType) return false;
  
  // Check if the detail ID exists in the details array
  return yarnType.details.some(detail => detail._id.toString() === yarnsubtypeId.toString());
};

/**
 * Create a supplier
 * @param {Object} supplierBody
 * @returns {Promise<Supplier>}
 */
export const createSupplier = async (supplierBody) => {
  if (await Supplier.isEmailTaken(supplierBody.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (supplierBody.gstNo && (await Supplier.isGstNoTaken(supplierBody.gstNo))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'GST number already taken');
  }
  
  // Validate yarnsubtype if provided
  if (supplierBody.yarnDetails && Array.isArray(supplierBody.yarnDetails)) {
    for (const detail of supplierBody.yarnDetails) {
      if (detail.yarnsubtype && detail.yarnType) {
        const isValid = await validateYarnSubtype(detail.yarnType, detail.yarnsubtype);
        if (!isValid) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid yarnsubtype - does not exist in YarnType details');
        }
      }
    }
  }
  
  return Supplier.create(supplierBody);
};

/**
 * Query for suppliers
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
export const querySuppliers = async (filter, options) => {
  const suppliers = await Supplier.paginate(filter, options);
  if (suppliers.results && suppliers.results.length > 0) {
    await Supplier.populate(suppliers.results, {
      path: 'yarnDetails.yarnType',
      select: 'name status',
    });
    await Supplier.populate(suppliers.results, {
      path: 'yarnDetails.color',
      select: 'name colorCode status',
    });
  }
  return suppliers;
};

/**
 * Get supplier by id
 * @param {ObjectId} id
 * @returns {Promise<Supplier>}
 */
export const getSupplierById = async (id) => {
  return Supplier.findById(id)
    .populate('yarnDetails.yarnType', 'name status')
    .populate('yarnDetails.color', 'name colorCode status');
};

/**
 * Update supplier by id
 * @param {ObjectId} supplierId
 * @param {Object} updateBody
 * @returns {Promise<Supplier>}
 */
export const updateSupplierById = async (supplierId, updateBody) => {
  const supplier = await getSupplierById(supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');
  }
  if (updateBody.email && (await Supplier.isEmailTaken(updateBody.email, supplierId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (updateBody.gstNo && (await Supplier.isGstNoTaken(updateBody.gstNo, supplierId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'GST number already taken');
  }
  
  // Validate yarnsubtype if provided
  if (updateBody.yarnDetails && Array.isArray(updateBody.yarnDetails)) {
    for (const detail of updateBody.yarnDetails) {
      if (detail.yarnsubtype && detail.yarnType) {
        const isValid = await validateYarnSubtype(detail.yarnType, detail.yarnsubtype);
        if (!isValid) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid yarnsubtype - does not exist in YarnType details');
        }
      }
    }
  }
  
  Object.assign(supplier, updateBody);
  await supplier.save();
  return supplier;
};

/**
 * Delete supplier by id
 * @param {ObjectId} supplierId
 * @returns {Promise<Supplier>}
 */
export const deleteSupplierById = async (supplierId) => {
  const supplier = await getSupplierById(supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');
  }
  await supplier.deleteOne();
  return supplier;
};

