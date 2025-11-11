import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { Supplier, YarnType, Color } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Convert yarnDetails IDs to embedded objects
 * @param {Array} yarnDetails - Supplier yarnDetails array
 */
const convertYarnDetailsToEmbedded = async (yarnDetails) => {
  if (!yarnDetails || !Array.isArray(yarnDetails)) return;
  
  for (const detail of yarnDetails) {
    // Convert yarnType ID to embedded object
    if (detail.yarnType) {
      const isObjectId = mongoose.Types.ObjectId.isValid(detail.yarnType) || 
                        (typeof detail.yarnType === 'string' && mongoose.Types.ObjectId.isValid(detail.yarnType)) ||
                        (detail.yarnType && typeof detail.yarnType === 'object' && !detail.yarnType.name);
      
      if (isObjectId) {
        try {
          const yarnTypeId = mongoose.Types.ObjectId.isValid(detail.yarnType) 
            ? detail.yarnType 
            : new mongoose.Types.ObjectId(detail.yarnType);
          const yarnType = await YarnType.findById(yarnTypeId);
          
          if (yarnType) {
            detail.yarnType = {
              _id: yarnType._id,
              name: yarnType.name,
              status: yarnType.status,
            };
          } else {
            detail.yarnType = {
              _id: yarnTypeId,
              name: 'Unknown',
              status: 'deleted',
            };
          }
        } catch (error) {
          console.error('Error converting yarnType to embedded object:', error);
        }
      }
    }
    
    // Convert color ID to embedded object
    if (detail.color) {
      const isObjectId = mongoose.Types.ObjectId.isValid(detail.color) || 
                        (typeof detail.color === 'string' && mongoose.Types.ObjectId.isValid(detail.color)) ||
                        (detail.color && typeof detail.color === 'object' && !detail.color.name);
      
      if (isObjectId) {
        try {
          const colorId = mongoose.Types.ObjectId.isValid(detail.color) 
            ? detail.color 
            : new mongoose.Types.ObjectId(detail.color);
          const color = await Color.findById(colorId);
          
          if (color) {
            detail.color = {
              _id: color._id,
              name: color.name,
              colorCode: color.colorCode,
              status: color.status,
            };
          } else {
            detail.color = {
              _id: colorId,
              name: 'Unknown',
              colorCode: '#000000',
              status: 'deleted',
            };
          }
        } catch (error) {
          console.error('Error converting color to embedded object:', error);
        }
      }
    }
    
    // Convert yarnsubtype ID to embedded object (from YarnType details)
    if (detail.yarnsubtype && detail.yarnType) {
      const isObjectId = mongoose.Types.ObjectId.isValid(detail.yarnsubtype) || 
                        (typeof detail.yarnsubtype === 'string' && mongoose.Types.ObjectId.isValid(detail.yarnsubtype)) ||
                        (detail.yarnsubtype && typeof detail.yarnsubtype === 'object' && !detail.yarnsubtype.subtype);
      
      if (isObjectId) {
        try {
          const yarnTypeId = detail.yarnType._id || detail.yarnType;
          const yarnType = await YarnType.findById(yarnTypeId);
          
          if (yarnType && yarnType.details) {
            const subtypeId = mongoose.Types.ObjectId.isValid(detail.yarnsubtype) 
              ? detail.yarnsubtype 
              : new mongoose.Types.ObjectId(detail.yarnsubtype);
            
            const subtypeDetail = yarnType.details.find(d => d._id.toString() === subtypeId.toString());
            
            if (subtypeDetail) {
              detail.yarnsubtype = {
                _id: subtypeDetail._id,
                subtype: subtypeDetail.subtype,
                countSize: subtypeDetail.countSize || [],
                tearWeight: subtypeDetail.tearWeight || '',
              };
            } else {
              detail.yarnsubtype = {
                _id: subtypeId,
                subtype: 'Unknown',
                countSize: [],
                tearWeight: '',
              };
            }
          }
        } catch (error) {
          console.error('Error converting yarnsubtype to embedded object:', error);
        }
      }
    }
  }
};

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
  
  // Convert IDs to embedded objects BEFORE creating (so Mongoose validation passes)
  if (supplierBody.yarnDetails && Array.isArray(supplierBody.yarnDetails)) {
    await convertYarnDetailsToEmbedded(supplierBody.yarnDetails);
    
    // Validate yarnsubtype if provided (after conversion, we can check the embedded object)
    for (const detail of supplierBody.yarnDetails) {
      if (detail.yarnsubtype && detail.yarnType) {
        // If yarnsubtype is still an ID, validate it exists
        if (mongoose.Types.ObjectId.isValid(detail.yarnsubtype) || typeof detail.yarnsubtype === 'string') {
          const isValid = await validateYarnSubtype(detail.yarnType._id || detail.yarnType, detail.yarnsubtype);
          if (!isValid) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid yarnsubtype - does not exist in YarnType details');
          }
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
  // No need to populate - yarnDetails are now embedded objects
  const suppliers = await Supplier.paginate(filter, options);
  return suppliers;
};

/**
 * Get supplier by id
 * @param {ObjectId} id
 * @returns {Promise<Supplier>}
 */
export const getSupplierById = async (id) => {
  // No need to populate - yarnDetails are now embedded objects
  return Supplier.findById(id);
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
  
  // Convert IDs to embedded objects BEFORE updating (so Mongoose validation passes)
  if (updateBody.yarnDetails && Array.isArray(updateBody.yarnDetails)) {
    await convertYarnDetailsToEmbedded(updateBody.yarnDetails);
    
    // Validate yarnsubtype if provided
    for (const detail of updateBody.yarnDetails) {
      if (detail.yarnsubtype && detail.yarnType) {
        // If yarnsubtype is still an ID, validate it exists
        if (mongoose.Types.ObjectId.isValid(detail.yarnsubtype) || typeof detail.yarnsubtype === 'string') {
          const isValid = await validateYarnSubtype(detail.yarnType._id || detail.yarnType, detail.yarnsubtype);
          if (!isValid) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid yarnsubtype - does not exist in YarnType details');
          }
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

