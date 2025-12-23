import httpStatus from 'http-status';
import { Blend } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Create a blend
 * @param {Object} blendBody
 * @returns {Promise<Blend>}
 */
export const createBlend = async (blendBody) => {
  if (await Blend.isNameTaken(blendBody.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Blend name already taken');
  }
  return Blend.create(blendBody);
};

/**
 * Query for blends
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
export const queryBlends = async (filter, options) => {
  // Convert name to case-insensitive regex for partial matching
  if (filter.name) {
    filter.name = { $regex: filter.name, $options: 'i' };
  }
  
  const blends = await Blend.paginate(filter, options);
  return blends;
};

/**
 * Get blend by id
 * @param {ObjectId} id
 * @returns {Promise<Blend>}
 */
export const getBlendById = async (id) => {
  return Blend.findById(id);
};

/**
 * Update blend by id
 * @param {ObjectId} blendId
 * @param {Object} updateBody
 * @returns {Promise<Blend>}
 */
export const updateBlendById = async (blendId, updateBody) => {
  const blend = await getBlendById(blendId);
  if (!blend) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Blend not found');
  }
  if (updateBody.name && (await Blend.isNameTaken(updateBody.name, blendId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Blend name already taken');
  }
  Object.assign(blend, updateBody);
  await blend.save();
  return blend;
};

/**
 * Delete blend by id
 * @param {ObjectId} blendId
 * @returns {Promise<Blend>}
 */
export const deleteBlendById = async (blendId) => {
  const blend = await getBlendById(blendId);
  if (!blend) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Blend not found');
  }
  await blend.deleteOne();
  return blend;
};

/**
 * Bulk import blends with batch processing
 * @param {Array} blends - Array of blend objects
 * @param {number} batchSize - Number of blends to process in each batch
 * @returns {Promise<Object>} - Results of the bulk import operation
 */
export const bulkImportBlends = async (blends, batchSize = 50) => {
  const results = {
    total: blends.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  try {
    // Validate input size
    if (blends.length > 1000) {
      throw new Error('Maximum 1000 blends allowed per request');
    }

    // Process blends in batches
    for (let i = 0; i < blends.length; i += batchSize) {
      const batch = blends.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      try {
        const batchPromises = batch.map(async (blendData, batchIndex) => {
          const globalIndex = i + batchIndex;
          
          try {
            const hasId = blendData.id && blendData.id.trim() !== '';
            
            // Validate required fields
            if (!blendData.name || blendData.name.trim() === '') {
              throw new Error('Blend name is required');
            }

            const processedData = {
              name: blendData.name.trim(),
              status: blendData.status || 'active',
            };

            if (hasId) {
              // Validate ObjectId format
              if (!/^[0-9a-fA-F]{24}$/.test(blendData.id.trim())) {
                throw new Error('Invalid blend ID format');
              }

              const existingBlend = await Blend.findById(blendData.id).lean();
              if (!existingBlend) {
                throw new Error(`Blend with ID ${blendData.id} not found`);
              }
              
              // Check for name conflicts
              if (processedData.name !== existingBlend.name) {
                if (await Blend.isNameTaken(processedData.name, blendData.id)) {
                  throw new Error(`Blend name "${processedData.name}" already taken`);
                }
              }
              
              await Blend.updateOne(
                { _id: blendData.id },
                { $set: processedData }
              );
              results.updated++;
            } else {
              // Check for name conflicts
              if (await Blend.isNameTaken(processedData.name)) {
                throw new Error(`Blend name "${processedData.name}" already taken`);
              }
              
              await Blend.create(processedData);
              results.created++;
            }
          } catch (error) {
            results.failed++;
            results.errors.push({
              index: globalIndex,
              name: blendData.name || 'N/A',
              error: error.message,
            });
          }
        });
        
        await Promise.all(batchPromises);
        
        const batchEndTime = Date.now();
        console.log(`Blend batch ${Math.floor(i / batchSize) + 1} completed in ${batchEndTime - batchStartTime}ms`);
        
      } catch (error) {
        console.error(`Error processing blend batch ${Math.floor(i / batchSize) + 1}:`, error);
        batch.forEach((blendData, batchIndex) => {
          const globalIndex = i + batchIndex;
          results.failed++;
          results.errors.push({
            index: globalIndex,
            name: blendData.name || 'N/A',
            error: `Batch processing error: ${error.message}`,
          });
        });
      }
    }
    
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    
    console.log(`Bulk import blends completed in ${results.processingTime}ms: ${results.created} created, ${results.updated} updated, ${results.failed} failed`);
    
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

