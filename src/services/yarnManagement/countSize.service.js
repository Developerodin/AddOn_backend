import httpStatus from 'http-status';
import { CountSize } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Create a count size
 * @param {Object} countSizeBody
 * @returns {Promise<CountSize>}
 */
export const createCountSize = async (countSizeBody) => {
  if (await CountSize.isNameTaken(countSizeBody.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Count size name already taken');
  }
  return CountSize.create(countSizeBody);
};

/**
 * Query for count sizes
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
export const queryCountSizes = async (filter, options) => {
  const countSizes = await CountSize.paginate(filter, options);
  return countSizes;
};

/**
 * Get count size by id
 * @param {ObjectId} id
 * @returns {Promise<CountSize>}
 */
export const getCountSizeById = async (id) => {
  return CountSize.findById(id);
};

/**
 * Update count size by id
 * @param {ObjectId} countSizeId
 * @param {Object} updateBody
 * @returns {Promise<CountSize>}
 */
export const updateCountSizeById = async (countSizeId, updateBody) => {
  const countSize = await getCountSizeById(countSizeId);
  if (!countSize) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Count size not found');
  }
  if (updateBody.name && (await CountSize.isNameTaken(updateBody.name, countSizeId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Count size name already taken');
  }
  Object.assign(countSize, updateBody);
  await countSize.save();
  return countSize;
};

/**
 * Delete count size by id
 * @param {ObjectId} countSizeId
 * @returns {Promise<CountSize>}
 */
export const deleteCountSizeById = async (countSizeId) => {
  const countSize = await getCountSizeById(countSizeId);
  if (!countSize) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Count size not found');
  }
  await countSize.deleteOne();
  return countSize;
};

/**
 * Bulk import count sizes with batch processing
 * @param {Array} countSizes - Array of count size objects
 * @param {number} batchSize - Number of count sizes to process in each batch
 * @returns {Promise<Object>} - Results of the bulk import operation
 */
export const bulkImportCountSizes = async (countSizes, batchSize = 50) => {
  const results = {
    total: countSizes.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  try {
    // Validate input size
    if (countSizes.length > 1000) {
      throw new Error('Maximum 1000 count sizes allowed per request');
    }

    // Process count sizes in batches
    for (let i = 0; i < countSizes.length; i += batchSize) {
      const batch = countSizes.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      try {
        const batchPromises = batch.map(async (countSizeData, batchIndex) => {
          const globalIndex = i + batchIndex;
          
          try {
            const hasId = countSizeData.id && countSizeData.id.trim() !== '';
            
            // Validate required fields
            if (!countSizeData.name || countSizeData.name.trim() === '') {
              throw new Error('Count size name is required');
            }

            const processedData = {
              name: countSizeData.name.trim(),
              status: countSizeData.status || 'active',
            };

            if (hasId) {
              // Validate ObjectId format
              if (!/^[0-9a-fA-F]{24}$/.test(countSizeData.id.trim())) {
                throw new Error('Invalid count size ID format');
              }

              const existingCountSize = await CountSize.findById(countSizeData.id).lean();
              if (!existingCountSize) {
                throw new Error(`Count size with ID ${countSizeData.id} not found`);
              }
              
              // Check for name conflicts
              if (processedData.name !== existingCountSize.name) {
                if (await CountSize.isNameTaken(processedData.name, countSizeData.id)) {
                  throw new Error(`Count size name "${processedData.name}" already taken`);
                }
              }
              
              await CountSize.updateOne(
                { _id: countSizeData.id },
                { $set: processedData }
              );
              results.updated++;
            } else {
              // Check for name conflicts
              if (await CountSize.isNameTaken(processedData.name)) {
                throw new Error(`Count size name "${processedData.name}" already taken`);
              }
              
              await CountSize.create(processedData);
              results.created++;
            }
          } catch (error) {
            results.failed++;
            results.errors.push({
              index: globalIndex,
              name: countSizeData.name || 'N/A',
              error: error.message,
            });
          }
        });
        
        await Promise.all(batchPromises);
        
        const batchEndTime = Date.now();
        console.log(`CountSize batch ${Math.floor(i / batchSize) + 1} completed in ${batchEndTime - batchStartTime}ms`);
        
      } catch (error) {
        console.error(`Error processing countSize batch ${Math.floor(i / batchSize) + 1}:`, error);
        batch.forEach((countSizeData, batchIndex) => {
          const globalIndex = i + batchIndex;
          results.failed++;
          results.errors.push({
            index: globalIndex,
            name: countSizeData.name || 'N/A',
            error: `Batch processing error: ${error.message}`,
          });
        });
      }
    }
    
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    
    console.log(`Bulk import count sizes completed in ${results.processingTime}ms: ${results.created} created, ${results.updated} updated, ${results.failed} failed`);
    
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

