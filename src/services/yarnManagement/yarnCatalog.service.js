import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnCatalog, YarnType, CountSize, Color, Blend } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Convert IDs to embedded objects for yarn catalog
 * @param {Object} yarnCatalogBody
 * @returns {Promise<Object>}
 */
const convertIdsToEmbedded = async (yarnCatalogBody) => {
  const processedBody = { ...yarnCatalogBody };
  
  // Convert yarnType ID to embedded object
  if (processedBody.yarnType) {
    const isObjectId = mongoose.Types.ObjectId.isValid(processedBody.yarnType) || 
                      (typeof processedBody.yarnType === 'string' && mongoose.Types.ObjectId.isValid(processedBody.yarnType)) ||
                      (processedBody.yarnType && typeof processedBody.yarnType === 'object' && !processedBody.yarnType.name);
    
    if (isObjectId) {
      try {
        const yarnTypeId = mongoose.Types.ObjectId.isValid(processedBody.yarnType) 
          ? processedBody.yarnType 
          : new mongoose.Types.ObjectId(processedBody.yarnType);
        const yarnType = await YarnType.findById(yarnTypeId);
        
        if (yarnType) {
          processedBody.yarnType = {
            _id: yarnType._id,
            name: yarnType.name,
            status: yarnType.status,
          };
        } else {
          throw new ApiError(httpStatus.BAD_REQUEST, `Yarn type with ID ${yarnTypeId} not found`);
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(httpStatus.BAD_REQUEST, `Invalid yarn type ID: ${processedBody.yarnType}`);
      }
    }
  }
  
  // Convert countSize ID to embedded object
  if (processedBody.countSize) {
    const isObjectId = mongoose.Types.ObjectId.isValid(processedBody.countSize) || 
                      (typeof processedBody.countSize === 'string' && mongoose.Types.ObjectId.isValid(processedBody.countSize)) ||
                      (processedBody.countSize && typeof processedBody.countSize === 'object' && !processedBody.countSize.name);
    
    if (isObjectId) {
      try {
        const countSizeId = mongoose.Types.ObjectId.isValid(processedBody.countSize) 
          ? processedBody.countSize 
          : new mongoose.Types.ObjectId(processedBody.countSize);
        const countSize = await CountSize.findById(countSizeId);
        
        if (countSize) {
          processedBody.countSize = {
            _id: countSize._id,
            name: countSize.name,
            status: countSize.status,
          };
        } else {
          throw new ApiError(httpStatus.BAD_REQUEST, `Count size with ID ${countSizeId} not found`);
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(httpStatus.BAD_REQUEST, `Invalid count size ID: ${processedBody.countSize}`);
      }
    }
  }
  
  // Convert blend ID to embedded object
  if (processedBody.blend) {
    const isObjectId = mongoose.Types.ObjectId.isValid(processedBody.blend) || 
                      (typeof processedBody.blend === 'string' && mongoose.Types.ObjectId.isValid(processedBody.blend)) ||
                      (processedBody.blend && typeof processedBody.blend === 'object' && !processedBody.blend.name);
    
    if (isObjectId) {
      try {
        const blendId = mongoose.Types.ObjectId.isValid(processedBody.blend) 
          ? processedBody.blend 
          : new mongoose.Types.ObjectId(processedBody.blend);
        const blend = await Blend.findById(blendId);
        
        if (blend) {
          processedBody.blend = {
            _id: blend._id,
            name: blend.name,
            status: blend.status,
          };
        } else {
          throw new ApiError(httpStatus.BAD_REQUEST, `Blend with ID ${blendId} not found`);
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(httpStatus.BAD_REQUEST, `Invalid blend ID: ${processedBody.blend}`);
      }
    }
  }
  
  // Convert colorFamily ID to embedded object
  // IMPORTANT: Preserve original colorFamily name if provided as object (don't overwrite with DB value)
  if (processedBody.colorFamily) {
    const originalColorFamilyName = (processedBody.colorFamily && typeof processedBody.colorFamily === 'object' && processedBody.colorFamily.name) 
      ? String(processedBody.colorFamily.name).trim() 
      : null;
    
    const isObjectId = mongoose.Types.ObjectId.isValid(processedBody.colorFamily) || 
                      (typeof processedBody.colorFamily === 'string' && mongoose.Types.ObjectId.isValid(processedBody.colorFamily)) ||
                      (processedBody.colorFamily && typeof processedBody.colorFamily === 'object' && !processedBody.colorFamily.name);
    
    if (isObjectId) {
      try {
        const colorId = mongoose.Types.ObjectId.isValid(processedBody.colorFamily) 
          ? processedBody.colorFamily 
          : new mongoose.Types.ObjectId(processedBody.colorFamily);
        const color = await Color.findById(colorId);
        
        if (color) {
          // Use original colorFamily name if provided, otherwise use DB value
          const colorNameToUse = originalColorFamilyName || color.name;
          processedBody.colorFamily = {
            _id: color._id,
            name: colorNameToUse, // Preserve original name if provided
            colorCode: color.colorCode,
            status: color.status,
          };
        } else {
          throw new ApiError(httpStatus.BAD_REQUEST, `Color with ID ${colorId} not found`);
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(httpStatus.BAD_REQUEST, `Invalid color ID: ${processedBody.colorFamily}`);
      }
    } else if (originalColorFamilyName && processedBody.colorFamily && typeof processedBody.colorFamily === 'object') {
      // If colorFamily is already an object with a name, preserve it exactly
      processedBody.colorFamily.name = originalColorFamilyName;
    }
  }
  
  // Convert yarnSubtype ID to embedded object (from YarnType details)
  // Note: yarnType must be converted first (above)
  if (processedBody.yarnSubtype && processedBody.yarnType) {
    const isObjectId = mongoose.Types.ObjectId.isValid(processedBody.yarnSubtype) || 
                      (typeof processedBody.yarnSubtype === 'string' && mongoose.Types.ObjectId.isValid(processedBody.yarnSubtype)) ||
                      (processedBody.yarnSubtype && typeof processedBody.yarnSubtype === 'object' && !processedBody.yarnSubtype.subtype);
    
    if (isObjectId) {
      try {
        // Get yarnType ID - it should already be converted to embedded object above
        let yarnTypeId;
        if (processedBody.yarnType._id) {
          yarnTypeId = processedBody.yarnType._id;
        } else if (mongoose.Types.ObjectId.isValid(processedBody.yarnType)) {
          yarnTypeId = processedBody.yarnType;
        } else if (typeof processedBody.yarnType === 'string' && mongoose.Types.ObjectId.isValid(processedBody.yarnType)) {
          yarnTypeId = new mongoose.Types.ObjectId(processedBody.yarnType);
        } else {
          throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid yarn type for yarn subtype conversion');
        }
        
        const yarnType = await YarnType.findById(yarnTypeId);
        
        if (yarnType && yarnType.details) {
          const subtypeId = mongoose.Types.ObjectId.isValid(processedBody.yarnSubtype) 
            ? processedBody.yarnSubtype 
            : new mongoose.Types.ObjectId(processedBody.yarnSubtype);
          
          const subtypeDetail = yarnType.details.find(d => d._id.toString() === subtypeId.toString());
          
          if (subtypeDetail) {
            processedBody.yarnSubtype = {
              _id: subtypeDetail._id,
              subtype: subtypeDetail.subtype,
              countSize: subtypeDetail.countSize || [],
            };
          } else {
            throw new ApiError(httpStatus.BAD_REQUEST, `Yarn subtype with ID ${subtypeId} not found in yarn type ${yarnTypeId}`);
          }
        } else {
          throw new ApiError(httpStatus.BAD_REQUEST, `Yarn type ${yarnTypeId} not found or has no details`);
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(httpStatus.BAD_REQUEST, `Invalid yarn subtype ID: ${processedBody.yarnSubtype}`);
      }
    }
  }
  
  return processedBody;
};

/**
 * Create a yarn catalog
 * @param {Object} yarnCatalogBody
 * @returns {Promise<YarnCatalog>}
 */
export const createYarnCatalog = async (yarnCatalogBody) => {
  // Convert IDs to embedded objects
  const processedBody = await convertIdsToEmbedded(yarnCatalogBody);
  
  // Check if yarnName is taken (if provided)
  if (processedBody.yarnName && await YarnCatalog.isYarnNameTaken(processedBody.yarnName)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Yarn catalog name already taken');
  }
  
  return YarnCatalog.create(processedBody);
};

/**
 * Query for yarn catalogs
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
export const queryYarnCatalogs = async (filter, options) => {
  const mongooseFilter = { ...filter };
  
  // Convert yarnName to regex for partial/fuzzy search (case-insensitive)
  // Escape special regex characters to allow matching of special characters like ( ) / - etc.
  if (mongooseFilter.yarnName) {
    const yarnNameValue = String(mongooseFilter.yarnName).trim();
    // Escape special regex characters: . * + ? ^ $ { } [ ] \ | ( )
    // This allows searching for yarn names with special characters like "70/2-Black (New)-Black (New)-Nylon/Nylon"
    const escapedYarnName = yarnNameValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    mongooseFilter.yarnName = { $regex: escapedYarnName, $options: 'i' };
  }
  
  const yarnCatalogs = await YarnCatalog.paginate(mongooseFilter, options);
  return yarnCatalogs;
};

/**
 * Find yarn catalog by count size, color, and shade code (for receiving pipeline).
 * Matches countSize.name, colorFamily.name, and pantonShade or pantonName to shadeCode.
 * @param {string} countSizeName - e.g. "70/1", "20s"
 * @param {string} colorName - Color name
 * @param {string} shadeCode - e.g. "WN96793" (matched against pantonShade or pantonName)
 * @param {string[]} [poItemYarnNames] - If provided, prefer a catalog whose yarnName is in this list (PO items)
 * @returns {Promise<{ yarnName: string, _id: ObjectId }|null>}
 */
export const findYarnByCountColorShade = async (countSizeName, colorName, shadeCode, poItemYarnNames = []) => {
  const count = (countSizeName || '').trim();
  const color = (colorName || '').trim();
  const shade = (shadeCode || '').trim();
  if (!count || !color) return null;

  const filter = {
    status: { $ne: 'deleted' },
    $and: [
      { $or: [{ 'countSize.name': new RegExp(`^${escapeRegex(count)}$`, 'i') }, { 'countSize.name': count }] },
      { $or: [{ 'colorFamily.name': new RegExp(`^${escapeRegex(color)}$`, 'i') }, { 'colorFamily.name': color }] },
    ],
  };
  if (shade) {
    filter.$and.push({
      $or: [
        { pantonShade: new RegExp(`^${escapeRegex(shade)}$`, 'i') },
        { pantonName: new RegExp(`^${escapeRegex(shade)}$`, 'i') },
        { pantonShade: shade },
        { pantonName: shade },
      ],
    });
  }

  const catalogs = await YarnCatalog.find(filter).select('yarnName _id').lean();
  if (!catalogs.length) return null;
  if (poItemYarnNames && poItemYarnNames.length > 0) {
    const set = new Set(poItemYarnNames.map((n) => (n || '').trim().toLowerCase()));
    const preferred = catalogs.find((c) => c.yarnName && set.has(c.yarnName.trim().toLowerCase()));
    if (preferred) return { yarnName: preferred.yarnName, _id: preferred._id };
  }
  return { yarnName: catalogs[0].yarnName, _id: catalogs[0]._id };
};

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get yarn catalog by id
 * @param {ObjectId} id
 * @returns {Promise<YarnCatalog>}
 */
export const getYarnCatalogById = async (id) => {
  return YarnCatalog.findById(id);
};

/**
 * Update yarn catalog by id
 * @param {ObjectId} yarnCatalogId
 * @param {Object} updateBody
 * @returns {Promise<YarnCatalog>}
 */
export const updateYarnCatalogById = async (yarnCatalogId, updateBody) => {
  const yarnCatalog = await getYarnCatalogById(yarnCatalogId);
  if (!yarnCatalog) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn catalog not found');
  }
  
  // Convert IDs to embedded objects
  const processedBody = await convertIdsToEmbedded(updateBody);
  
  // Check if yarnName is taken (if being updated)
  if (processedBody.yarnName && (await YarnCatalog.isYarnNameTaken(processedBody.yarnName, yarnCatalogId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Yarn catalog name already taken');
  }
  
  Object.assign(yarnCatalog, processedBody);
  await yarnCatalog.save();
  return yarnCatalog;
};

/**
 * Delete yarn catalog by id
 * @param {ObjectId} yarnCatalogId
 * @returns {Promise<YarnCatalog>}
 */
export const deleteYarnCatalogById = async (yarnCatalogId) => {
  const yarnCatalog = await getYarnCatalogById(yarnCatalogId);
  if (!yarnCatalog) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn catalog not found');
  }
  await yarnCatalog.deleteOne();
  return yarnCatalog;
};

/**
 * Bulk import yarn catalogs with batch processing
 * @param {Array} yarnCatalogs - Array of yarn catalog objects
 * @param {number} batchSize - Number of yarn catalogs to process in each batch
 * @returns {Promise<Object>} - Results of the bulk import operation
 */
export const bulkImportYarnCatalogs = async (yarnCatalogs, batchSize = 50) => {
  const results = {
    total: yarnCatalogs.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  try {
    // Validate input size
    if (yarnCatalogs.length > 1000) {
      throw new Error('Maximum 1000 yarn catalogs allowed per request');
    }

    // Process yarn catalogs in batches
    for (let i = 0; i < yarnCatalogs.length; i += batchSize) {
      const batch = yarnCatalogs.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      try {
        const batchPromises = batch.map(async (yarnCatalogData, batchIndex) => {
          const globalIndex = i + batchIndex;
          
          try {
            const hasId = yarnCatalogData.id && yarnCatalogData.id.trim() !== '';
            
            // Validate required fields
            if (!yarnCatalogData.yarnType) {
              throw new Error('Yarn type is required');
            }
            if (!yarnCatalogData.countSize) {
              throw new Error('Count size is required');
            }
            if (!yarnCatalogData.blend) {
              throw new Error('Blend is required');
            }

            const rawData = {
              yarnName: yarnCatalogData.yarnName?.trim() || undefined,
              yarnType: yarnCatalogData.yarnType,
              yarnSubtype: yarnCatalogData.yarnSubtype || undefined,
              countSize: yarnCatalogData.countSize,
              blend: yarnCatalogData.blend,
              colorFamily: yarnCatalogData.colorFamily || undefined,
              pantonShade: yarnCatalogData.pantonShade?.trim() || undefined,
              pantonName: yarnCatalogData.pantonName?.trim() || undefined,
              season: yarnCatalogData.season?.trim() || undefined,
              gst: yarnCatalogData.gst !== undefined ? Number(yarnCatalogData.gst) : undefined,
              remark: yarnCatalogData.remark?.trim() || undefined,
              hsnCode: yarnCatalogData.hsnCode?.trim()?.toUpperCase() || undefined,
              minQuantity: yarnCatalogData.minQuantity !== undefined ? Number(yarnCatalogData.minQuantity) : undefined,
              status: yarnCatalogData.status || 'active',
            };

            // Remove undefined fields
            Object.keys(rawData).forEach(key => {
              if (rawData[key] === undefined) {
                delete rawData[key];
              }
            });

            // Convert IDs to embedded objects
            const processedData = await convertIdsToEmbedded(rawData);

            if (hasId) {
              // Validate ObjectId format
              if (!/^[0-9a-fA-F]{24}$/.test(yarnCatalogData.id.trim())) {
                throw new Error('Invalid yarn catalog ID format');
              }

              const existingYarnCatalog = await YarnCatalog.findById(yarnCatalogData.id).lean();
              if (!existingYarnCatalog) {
                throw new Error(`Yarn catalog with ID ${yarnCatalogData.id} not found`);
              }
              
              // Check for yarnName conflicts (if provided)
              if (processedData.yarnName && processedData.yarnName !== existingYarnCatalog.yarnName) {
                if (await YarnCatalog.isYarnNameTaken(processedData.yarnName, yarnCatalogData.id)) {
                  throw new Error(`Yarn catalog name "${processedData.yarnName}" already taken`);
                }
              }
              
              await YarnCatalog.updateOne(
                { _id: yarnCatalogData.id },
                { $set: processedData }
              );
              results.updated++;
            } else {
              // Check for yarnName conflicts (if provided)
              if (processedData.yarnName && await YarnCatalog.isYarnNameTaken(processedData.yarnName)) {
                throw new Error(`Yarn catalog name "${processedData.yarnName}" already taken`);
              }
              
              await YarnCatalog.create(processedData);
              results.created++;
            }
          } catch (error) {
            results.failed++;
            results.errors.push({
              index: globalIndex,
              yarnName: yarnCatalogData.yarnName || 'N/A',
              error: error.message,
            });
          }
        });
        
        await Promise.all(batchPromises);
        
        const batchEndTime = Date.now();
        console.log(`YarnCatalog batch ${Math.floor(i / batchSize) + 1} completed in ${batchEndTime - batchStartTime}ms`);
        
      } catch (error) {
        console.error(`Error processing yarnCatalog batch ${Math.floor(i / batchSize) + 1}:`, error);
        batch.forEach((yarnCatalogData, batchIndex) => {
          const globalIndex = i + batchIndex;
          results.failed++;
          results.errors.push({
            index: globalIndex,
            yarnName: yarnCatalogData.yarnName || 'N/A',
            error: `Batch processing error: ${error.message}`,
          });
        });
      }
    }
    
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    
    console.log(`Bulk import yarn catalogs completed in ${results.processingTime}ms: ${results.created} created, ${results.updated} updated, ${results.failed} failed`);
    
    return results;
    
  } catch (error) {
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    results.errors.push({
      index: -1,
      yarnName: 'N/A',
      error: `Bulk import failed: ${error.message}`,
    });
    throw error;
  }
};

