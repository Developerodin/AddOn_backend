import httpStatus from 'http-status';
import { Color } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Create a color
 * @param {Object} colorBody
 * @returns {Promise<Color>}
 */
export const createColor = async (colorBody) => {
  return Color.create(colorBody);
};

/**
 * Query for colors
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
export const queryColors = async (filter, options) => {
  const query = {};

  // Universal search: use `search` if provided, otherwise fall back to `name`
  // This will search across name, colorCode, and pantoneName (case-insensitive, partial match)
  const searchValue = filter.search || filter.name;
  if (searchValue) {
    const regex = { $regex: searchValue, $options: 'i' };
    query.$or = [
      { name: regex },
      { colorCode: regex },
      { pantoneName: regex },
    ];
  } else {
    // Legacy field-specific filters when no universal search is used
    if (filter.name) {
      query.name = { $regex: filter.name, $options: 'i' };
    }
    if (filter.colorCode) {
      query.colorCode = { $regex: filter.colorCode, $options: 'i' };
    }
    if (filter.pantoneName) {
      query.pantoneName = { $regex: filter.pantoneName, $options: 'i' };
    }
  }

  // Status filter still applies alongside any search
  if (filter.status) {
    query.status = filter.status;
  }

  const colors = await Color.paginate(query, options);
  return colors;
};

/**
 * Get color by id
 * @param {ObjectId} id
 * @returns {Promise<Color>}
 */
export const getColorById = async (id) => {
  return Color.findById(id);
};

/**
 * Update color by id
 * @param {ObjectId} colorId
 * @param {Object} updateBody
 * @returns {Promise<Color>}
 */
export const updateColorById = async (colorId, updateBody) => {
  const color = await getColorById(colorId);
  if (!color) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Color not found');
  }
  Object.assign(color, updateBody);
  await color.save();
  return color;
};

/**
 * Delete color by id
 * @param {ObjectId} colorId
 * @returns {Promise<Color>}
 */
export const deleteColorById = async (colorId) => {
  const color = await getColorById(colorId);
  if (!color) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Color not found');
  }
  await color.deleteOne();
  return color;
};

/**
 * Bulk import colors with batch processing
 * @param {Array} colors - Array of color objects
 * @param {number} batchSize - Number of colors to process in each batch
 * @returns {Promise<Object>} - Results of the bulk import operation
 */
export const bulkImportColors = async (colors, batchSize = 50) => {
  const results = {
    total: colors.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  try {
    // Validate input size
    if (colors.length > 1000) {
      throw new Error('Maximum 1000 colors allowed per request');
    }

    // Process colors in batches
    for (let i = 0; i < colors.length; i += batchSize) {
      const batch = colors.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      try {
        const batchPromises = batch.map(async (colorData, batchIndex) => {
          const globalIndex = i + batchIndex;
          
          try {
            const hasId = colorData.id && colorData.id.trim() !== '';
            
            // Validate required fields
            if (!colorData.name || colorData.name.trim() === '') {
              throw new Error('Color name is required');
            }
            if (!colorData.colorCode || colorData.colorCode.trim() === '') {
              throw new Error('Color code is required');
            }

            const processedData = {
              name: colorData.name.trim(),
              colorCode: colorData.colorCode.trim().toUpperCase(),
              status: colorData.status || 'active',
            };
            
            if (colorData.pantoneName && colorData.pantoneName.trim() !== '') {
              processedData.pantoneName = colorData.pantoneName.trim();
            }

            if (hasId) {
              // Validate ObjectId format
              if (!/^[0-9a-fA-F]{24}$/.test(colorData.id.trim())) {
                throw new Error('Invalid color ID format');
              }

              const existingColor = await Color.findById(colorData.id).lean();
              if (!existingColor) {
                throw new Error(`Color with ID ${colorData.id} not found`);
              }
              
              await Color.updateOne(
                { _id: colorData.id },
                { $set: processedData }
              );
              results.updated++;
            } else {
              await Color.create(processedData);
              results.created++;
            }
          } catch (error) {
            results.failed++;
            results.errors.push({
              index: globalIndex,
              name: colorData.name || 'N/A',
              colorCode: colorData.colorCode || 'N/A',
              error: error.message,
            });
          }
        });
        
        await Promise.all(batchPromises);
        
        const batchEndTime = Date.now();
        console.log(`Color batch ${Math.floor(i / batchSize) + 1} completed in ${batchEndTime - batchStartTime}ms`);
        
      } catch (error) {
        console.error(`Error processing color batch ${Math.floor(i / batchSize) + 1}:`, error);
        batch.forEach((colorData, batchIndex) => {
          const globalIndex = i + batchIndex;
          results.failed++;
          results.errors.push({
            index: globalIndex,
            name: colorData.name || 'N/A',
            colorCode: colorData.colorCode || 'N/A',
            error: `Batch processing error: ${error.message}`,
          });
        });
      }
    }
    
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    
    console.log(`Bulk import colors completed in ${results.processingTime}ms: ${results.created} created, ${results.updated} updated, ${results.failed} failed`);
    
    return results;
    
  } catch (error) {
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    results.errors.push({
      index: -1,
      name: 'N/A',
      colorCode: 'N/A',
      error: `Bulk import failed: ${error.message}`,
    });
    throw error;
  }
};

