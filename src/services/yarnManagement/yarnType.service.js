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
  
  // Handle details update separately to preserve existing IDs
  if (updateBody.details && Array.isArray(updateBody.details)) {
    // Convert countSize IDs to embedded objects BEFORE updating
    await convertCountSizeToEmbedded(updateBody.details);
    
    // Preserve existing detail IDs by matching
    const existingDetails = yarnType.details || [];
    const updatedDetails = [];
    
    for (const updateDetail of updateBody.details) {
      let existingDetail = null;
      
      // Try to match by _id if provided
      if (updateDetail._id || updateDetail.id) {
        const detailId = updateDetail._id || updateDetail.id;
        const idStr = detailId.toString();
        existingDetail = existingDetails.find(d => d._id && d._id.toString() === idStr);
      }
      
      // If not found by ID, try to match by subtype name
      if (!existingDetail && updateDetail.subtype) {
        existingDetail = existingDetails.find(d => d.subtype === updateDetail.subtype);
      }
      
      if (existingDetail) {
        // Update existing detail - preserve the _id
        existingDetail.subtype = updateDetail.subtype;
        existingDetail.countSize = updateDetail.countSize || [];
        updatedDetails.push(existingDetail);
      } else {
        // New detail - will get a new _id from MongoDB
        updatedDetails.push({
          subtype: updateDetail.subtype,
          countSize: updateDetail.countSize || [],
        });
      }
    }
    
    // Replace the details array with merged details
    yarnType.details = updatedDetails;
    
    // Remove details from updateBody so we don't overwrite with Object.assign
    const { details, ...restUpdateBody } = updateBody;
    Object.assign(yarnType, restUpdateBody);
  } else {
    // No details update, proceed normally
    Object.assign(yarnType, updateBody);
  }
  
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

/**
 * Bulk import yarn types with batch processing
 * @param {Array} yarnTypes - Array of yarn type objects
 * @param {number} batchSize - Number of yarn types to process in each batch
 * @returns {Promise<Object>} - Results of the bulk import operation
 */
export const bulkImportYarnTypes = async (yarnTypes, batchSize = 50) => {
  const results = {
    total: yarnTypes.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  try {
    // Validate input size
    if (yarnTypes.length > 1000) {
      throw new Error('Maximum 1000 yarn types allowed per request');
    }

    // Process yarn types in batches
    for (let i = 0; i < yarnTypes.length; i += batchSize) {
      const batch = yarnTypes.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      try {
        const batchPromises = batch.map(async (yarnTypeData, batchIndex) => {
          const globalIndex = i + batchIndex;
          
          try {
            const hasId = yarnTypeData.id && yarnTypeData.id.trim() !== '';
            
            // Validate required fields
            if (!yarnTypeData.name || yarnTypeData.name.trim() === '') {
              throw new Error('Yarn type name is required');
            }

            const processedData = {
              name: yarnTypeData.name.trim(),
              details: yarnTypeData.details || [],
              status: yarnTypeData.status || 'active',
            };

            // Convert countSize IDs to embedded objects if provided
            if (processedData.details && Array.isArray(processedData.details)) {
              await convertCountSizeToEmbedded(processedData.details);
            }

            if (hasId) {
              // Validate ObjectId format
              if (!/^[0-9a-fA-F]{24}$/.test(yarnTypeData.id.trim())) {
                throw new Error('Invalid yarn type ID format');
              }

              const existingYarnType = await YarnType.findById(yarnTypeData.id);
              if (!existingYarnType) {
                throw new Error(`Yarn type with ID ${yarnTypeData.id} not found`);
              }
              
              // Check for name conflicts
              if (processedData.name !== existingYarnType.name) {
                if (await YarnType.isNameTaken(processedData.name, yarnTypeData.id)) {
                  throw new Error(`Yarn type name "${processedData.name}" already taken`);
                }
              }
              
              // Handle details update separately to preserve existing IDs
              if (processedData.details && Array.isArray(processedData.details)) {
                const existingDetails = existingYarnType.details || [];
                const updatedDetails = [];
                
                for (const updateDetail of processedData.details) {
                  let existingDetail = null;
                  
                  // Try to match by _id if provided
                  if (updateDetail._id || updateDetail.id) {
                    const detailId = updateDetail._id || updateDetail.id;
                    const idStr = detailId.toString();
                    existingDetail = existingDetails.find(d => d._id && d._id.toString() === idStr);
                  }
                  
                  // If not found by ID, try to match by subtype name
                  if (!existingDetail && updateDetail.subtype) {
                    existingDetail = existingDetails.find(d => d.subtype === updateDetail.subtype);
                  }
                  
                  if (existingDetail) {
                    // Update existing detail - preserve the _id
                    existingDetail.subtype = updateDetail.subtype;
                    existingDetail.countSize = updateDetail.countSize || [];
                    updatedDetails.push(existingDetail);
                  } else {
                    // New detail - will get a new _id from MongoDB
                    updatedDetails.push({
                      subtype: updateDetail.subtype,
                      countSize: updateDetail.countSize || [],
                    });
                  }
                }
                
                existingYarnType.details = updatedDetails;
              }
              
              // Update other fields
              if (processedData.name) existingYarnType.name = processedData.name;
              if (processedData.status) existingYarnType.status = processedData.status;
              
              await existingYarnType.save();
              results.updated++;
            } else {
              // Check for name conflicts
              if (await YarnType.isNameTaken(processedData.name)) {
                throw new Error(`Yarn type name "${processedData.name}" already taken`);
              }
              
              await YarnType.create(processedData);
              results.created++;
            }
          } catch (error) {
            results.failed++;
            results.errors.push({
              index: globalIndex,
              name: yarnTypeData.name || 'N/A',
              error: error.message,
            });
          }
        });
        
        await Promise.all(batchPromises);
        
        const batchEndTime = Date.now();
        console.log(`YarnType batch ${Math.floor(i / batchSize) + 1} completed in ${batchEndTime - batchStartTime}ms`);
        
      } catch (error) {
        console.error(`Error processing yarnType batch ${Math.floor(i / batchSize) + 1}:`, error);
        batch.forEach((yarnTypeData, batchIndex) => {
          const globalIndex = i + batchIndex;
          results.failed++;
          results.errors.push({
            index: globalIndex,
            name: yarnTypeData.name || 'N/A',
            error: `Batch processing error: ${error.message}`,
          });
        });
      }
    }
    
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    
    console.log(`Bulk import yarn types completed in ${results.processingTime}ms: ${results.created} created, ${results.updated} updated, ${results.failed} failed`);
    
    return results;
    
  } catch (error) {
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    results.errors.push({
      index: -1,
      name: 'N/A',
      error: `Bulk import failed: ${error.message}`,
    });
    throw error;
  }
};

