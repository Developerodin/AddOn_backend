import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnType, CountSize } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Convert countSize ObjectIds to embedded objects
 * @param {Array} details - YarnType details array
 */
const convertCountSizeToEmbedded = async (details) => {
  if (!details || !Array.isArray(details)) return;
  
  for (const detail of details) {
    if (!detail.countSize || detail.countSize.length === 0) continue;
    
    const firstItem = detail.countSize[0];
    // Check if it's an ID (string or ObjectId) that needs conversion to embedded object
    // If it already has a 'name' property, it's already an embedded object
    const needsConversion = 
      (typeof firstItem === 'string' && mongoose.Types.ObjectId.isValid(firstItem)) ||
      mongoose.Types.ObjectId.isValid(firstItem) || 
      (firstItem && firstItem._bsontype === 'ObjectID') ||
      (firstItem && typeof firstItem === 'object' && !firstItem.name);
    
    if (needsConversion) {
      try {
        const countSizeIds = detail.countSize.map(cs => {
          // Handle ObjectId buffer format from MongoDB
          if (cs && cs._bsontype === 'ObjectID') {
            if (cs.id && cs.id.data) {
              return new mongoose.Types.ObjectId(Buffer.from(cs.id.data));
            }
            if (cs.id) {
              return new mongoose.Types.ObjectId(cs.id);
            }
          }
          if (mongoose.Types.ObjectId.isValid(cs)) return cs;
          if (typeof cs === 'string') return new mongoose.Types.ObjectId(cs);
          if (cs && typeof cs === 'object' && cs._id) {
            return mongoose.Types.ObjectId.isValid(cs._id) ? cs._id : new mongoose.Types.ObjectId(cs._id);
          }
          return cs;
        }).filter(id => id && mongoose.Types.ObjectId.isValid(id));
        
        if (countSizeIds.length > 0) {
          const countSizes = await CountSize.find({ _id: { $in: countSizeIds } });
          const countSizeMap = new Map();
          countSizes.forEach(cs => {
            countSizeMap.set(cs._id.toString(), {
              _id: cs._id,
              name: cs.name,
              status: cs.status,
            });
          });
          
          detail.countSize = countSizeIds.map((id) => {
            const idStr = id.toString();
            return countSizeMap.get(idStr) || {
              _id: id,
              name: 'Unknown',
              status: 'deleted',
            };
          });
        }
      } catch (error) {
        console.error('Error converting countSize to embedded objects:', error);
      }
    }
  }
};

/**
 * Create a yarn type
 * @param {Object} yarnTypeBody
 * @returns {Promise<YarnType>}
 */
export const createYarnType = async (yarnTypeBody) => {
  if (await YarnType.isNameTaken(yarnTypeBody.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Yarn type name already taken');
  }
  
  // Convert countSize IDs to embedded objects BEFORE creating (so Mongoose validation passes)
  if (yarnTypeBody.details && Array.isArray(yarnTypeBody.details)) {
    await convertCountSizeToEmbedded(yarnTypeBody.details);
  }
  
  return YarnType.create(yarnTypeBody);
};

/**
 * Query for yarn types
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
export const queryYarnTypes = async (filter, options) => {
  const yarnTypes = await YarnType.paginate(filter, options);
  
  // Convert ObjectIds to embedded objects for backward compatibility
  if (yarnTypes.results && Array.isArray(yarnTypes.results)) {
    for (const yarnType of yarnTypes.results) {
      if (yarnType.details) {
        await convertCountSizeToEmbedded(yarnType.details);
      }
    }
  }
  
  return yarnTypes;
};

/**
 * Get yarn type by id
 * @param {ObjectId} id
 * @returns {Promise<YarnType>}
 */
export const getYarnTypeById = async (id) => {
  const yarnType = await YarnType.findById(id);
  
  // Convert ObjectIds to embedded objects for backward compatibility
  if (yarnType && yarnType.details) {
    await convertCountSizeToEmbedded(yarnType.details);
  }
  
  return yarnType;
};

/**
 * Update yarn type by id
 * @param {ObjectId} yarnTypeId
 * @param {Object} updateBody
 * @returns {Promise<YarnType>}
 */
export const updateYarnTypeById = async (yarnTypeId, updateBody) => {
  const yarnType = await getYarnTypeById(yarnTypeId);
  if (!yarnType) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn type not found');
  }
  if (updateBody.name && (await YarnType.isNameTaken(updateBody.name, yarnTypeId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Yarn type name already taken');
  }
  
  // Convert countSize IDs to embedded objects BEFORE updating (so Mongoose validation passes)
  if (updateBody.details && Array.isArray(updateBody.details)) {
    await convertCountSizeToEmbedded(updateBody.details);
  }
  
  Object.assign(yarnType, updateBody);
  await yarnType.save();
  return yarnType;
};

/**
 * Delete yarn type by id
 * @param {ObjectId} yarnTypeId
 * @returns {Promise<YarnType>}
 */
export const deleteYarnTypeById = async (yarnTypeId) => {
  const yarnType = await getYarnTypeById(yarnTypeId);
  if (!yarnType) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn type not found');
  }
  await yarnType.deleteOne();
  return yarnType;
};

