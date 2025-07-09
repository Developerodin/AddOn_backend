import httpStatus from 'http-status';
import Store from '../models/store.model.js';
import ApiError from '../utils/ApiError.js';

/**
 * Create a store
 * @param {Object} storeBody
 * @returns {Promise<Store>}
 */
export const createStore = async (storeBody) => {
  if (await Store.isStoreIdTaken(storeBody.storeId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Store ID already taken');
  }
  if (await Store.isContactEmailTaken(storeBody.contactEmail)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Contact email already taken');
  }
  return Store.create(storeBody);
};

/**
 * Query for stores
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @param {string} [options.populate] - Populate options
 * @returns {Promise<QueryResult>}
 */
export const queryStores = async (filter, options) => {
  try {
    // Ensure filter is a valid object
    if (!filter || typeof filter !== 'object') {
      filter = {};
    }
    
    // Remove any potential _id field that might cause issues
    if (filter._id) {
      console.warn('Removing _id from filter to prevent ObjectId casting issues');
      delete filter._id;
    }
    
    const stores = await Store.paginate(filter, options);
    return stores;
  } catch (error) {
    // Handle ObjectId casting errors
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      throw new ApiError(
        httpStatus.BAD_REQUEST, 
        `Invalid ID format: ${error.value}. Please provide a valid 24-character hexadecimal ID.`
      );
    }
    // Re-throw other errors
    throw error;
  }
};

/**
 * Get store by id
 * @param {ObjectId} id
 * @returns {Promise<Store>}
 */
export const getStoreById = async (id) => {
  return Store.findById(id);
};

/**
 * Update store by id
 * @param {ObjectId} storeId
 * @param {Object} updateBody
 * @returns {Promise<Store>}
 */
export const updateStoreById = async (storeId, updateBody) => {
  const store = await getStoreById(storeId);
  if (!store) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Store not found');
  }
  if (updateBody.storeId && (await Store.isStoreIdTaken(updateBody.storeId, storeId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Store ID already taken');
  }
  if (updateBody.contactEmail && (await Store.isContactEmailTaken(updateBody.contactEmail, storeId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Contact email already taken');
  }
  Object.assign(store, updateBody);
  await store.save();
  return store;
};

/**
 * Delete store by id
 * @param {ObjectId} storeId
 * @returns {Promise<Store>}
 */
export const deleteStoreById = async (storeId) => {
  const store = await getStoreById(storeId);
  if (!store) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Store not found');
  }
  await store.deleteOne();
  return store;
};

/**
 * Bulk import stores with batch processing
 * @param {Array} stores - Array of store objects
 * @param {number} batchSize - Number of stores to process in each batch
 * @returns {Promise<Object>} - Results of the bulk import operation
 */
export const bulkImportStores = async (stores, batchSize = 50) => {
  const results = {
    total: stores.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  try {
    // Validate input size
    if (stores.length > 1000) {
      throw new Error('Maximum 1000 stores allowed per request');
    }

    // Estimate memory usage (rough calculation)
    const estimatedMemoryMB = (stores.length * 1000) / (1024 * 1024); // ~1KB per store
    if (estimatedMemoryMB > 100) {
      console.warn(`Large bulk import detected: ${estimatedMemoryMB.toFixed(2)} MB estimated memory usage`);
    }

    // Process stores in batches
    for (let i = 0; i < stores.length; i += batchSize) {
      const batch = stores.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      try {
        // Process each store in the current batch
        const batchPromises = batch.map(async (storeData, batchIndex) => {
          const globalIndex = i + batchIndex;
          
          try {
            const hasId = storeData.id && storeData.id.trim() !== '';
            
            // Validate required fields first
            const requiredFields = ['storeId', 'storeName', 'city', 'addressLine1', 'storeNumber', 'pincode', 'contactPerson', 'contactEmail', 'contactPhone'];
            const missingFields = requiredFields.filter(field => !storeData[field] || storeData[field].toString().trim() === '');
            
            if (missingFields.length > 0) {
              throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
            }

            // Validate pincode format
            if (!/^\d{6}$/.test(storeData.pincode.trim())) {
              throw new Error('Pincode must be exactly 6 digits');
            }

            // Validate email format
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(storeData.contactEmail.trim())) {
              throw new Error('Invalid email format');
            }

            // Validate phone format
            if (!/^\+?[\d\s\-\(\)]{10,15}$/.test(storeData.contactPhone.trim())) {
              throw new Error('Contact phone must be 10-15 digits with optional +, spaces, dashes, or parentheses');
            }

            // Validate credit rating if provided
            if (storeData.creditRating && !['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'].includes(storeData.creditRating)) {
              throw new Error('Invalid credit rating. Must be one of: A+, A, A-, B+, B, B-, C+, C, C-, D, F');
            }

            // Validate numeric fields
            const numericFields = ['hankyNorms', 'socksNorms', 'towelNorms', 'totalNorms'];
            for (const field of numericFields) {
              if (storeData[field] !== undefined && storeData[field] !== null && storeData[field] !== '') {
                const numValue = Number(storeData[field]);
                if (isNaN(numValue) || numValue < 0) {
                  throw new Error(`${field} must be a non-negative number`);
                }
              }
            }
            
            // Prepare store data with minimal memory footprint
            const processedData = {
              // Required fields
              storeId: storeData.storeId?.trim().toUpperCase(),
              storeName: storeData.storeName?.trim(),
              city: storeData.city?.trim(),
              addressLine1: storeData.addressLine1?.trim(),
              storeNumber: storeData.storeNumber?.trim(),
              pincode: storeData.pincode?.trim(),
              contactPerson: storeData.contactPerson?.trim(),
              contactEmail: storeData.contactEmail?.trim().toLowerCase(),
              contactPhone: storeData.contactPhone?.trim(),
              creditRating: storeData.creditRating || 'C',
              
              // Optional fields
              bpCode: storeData.bpCode?.trim() || undefined,
              oldStoreCode: storeData.oldStoreCode?.trim() || undefined,
              bpName: storeData.bpName?.trim() || undefined,
              street: storeData.street?.trim() || undefined,
              block: storeData.block?.trim() || undefined,
              addressLine2: storeData.addressLine2?.trim() || '',
              zipCode: storeData.zipCode?.trim() || undefined,
              state: storeData.state?.trim() || undefined,
              country: storeData.country?.trim() || undefined,
              telephone: storeData.telephone?.trim() || undefined,
              internalSapCode: storeData.internalSapCode?.trim() || undefined,
              internalSoftwareCode: storeData.internalSoftwareCode?.trim() || undefined,
              brandGrouping: storeData.brandGrouping?.trim() || undefined,
              brand: storeData.brand?.trim() || undefined,
              hankyNorms: storeData.hankyNorms ? Number(storeData.hankyNorms) : undefined,
              socksNorms: storeData.socksNorms ? Number(storeData.socksNorms) : undefined,
              towelNorms: storeData.towelNorms ? Number(storeData.towelNorms) : undefined,
              totalNorms: storeData.totalNorms ? Number(storeData.totalNorms) : undefined,
              isActive: storeData.isActive !== undefined ? Boolean(storeData.isActive) : true,
            };

            // Debug logging for totalNorms
            console.log('Debug - Input totalNorms:', storeData.totalNorms, typeof storeData.totalNorms);
            console.log('Debug - Processed totalNorms:', processedData.totalNorms, typeof processedData.totalNorms);

            if (hasId) {
              // Validate ObjectId format
              if (!/^[0-9a-fA-F]{24}$/.test(storeData.id.trim())) {
                throw new Error('Invalid store ID format. Must be a valid 24-character hexadecimal string');
              }

              // Update existing store
              const existingStore = await Store.findById(storeData.id).lean();
              if (!existingStore) {
                throw new Error(`Store with ID ${storeData.id} not found`);
              }
              
              // Check for store ID conflicts
              if (processedData.storeId && processedData.storeId !== existingStore.storeId) {
                const duplicateCheck = await Store.findOne({ 
                  storeId: processedData.storeId, 
                  _id: { $ne: storeData.id } 
                }).lean();
                if (duplicateCheck) {
                  throw new Error(`Store ID ${processedData.storeId} already exists`);
                }
              }
              
              // Check for email conflicts
              if (processedData.contactEmail && processedData.contactEmail !== existingStore.contactEmail) {
                const duplicateCheck = await Store.findOne({ 
                  contactEmail: processedData.contactEmail, 
                  _id: { $ne: storeData.id } 
                }).lean();
                if (duplicateCheck) {
                  throw new Error(`Contact email ${processedData.contactEmail} already exists`);
                }
              }
              
              // Use updateOne for better performance
              const updateResult = await Store.updateOne(
                { _id: storeData.id },
                { $set: processedData }
              );

              if (updateResult.matchedCount === 0) {
                throw new Error(`Store with ID ${storeData.id} not found during update`);
              }

              results.updated++;
            } else {
              // Create new store
              // Check for store ID conflicts
              const duplicateCheck = await Store.findOne({ storeId: processedData.storeId }).lean();
              if (duplicateCheck) {
                throw new Error(`Store ID ${processedData.storeId} already exists`);
              }
              
              // Check for email conflicts
              const emailCheck = await Store.findOne({ contactEmail: processedData.contactEmail }).lean();
              if (emailCheck) {
                throw new Error(`Contact email ${processedData.contactEmail} already exists`);
              }
              
              await Store.create(processedData);
              results.created++;
            }
          } catch (error) {
            results.failed++;
            results.errors.push({
              index: globalIndex,
              storeId: storeData.storeId || 'N/A',
              error: error.message,
              data: {
                storeName: storeData.storeName || 'N/A',
                city: storeData.city || 'N/A'
              }
            });
          }
        });
        
        // Wait for all stores in the current batch to complete
        await Promise.all(batchPromises);
        
        const batchEndTime = Date.now();
        console.log(`Batch ${Math.floor(i / batchSize) + 1} completed in ${batchEndTime - batchStartTime}ms`);
        
      } catch (error) {
        console.error(`Error processing batch ${Math.floor(i / batchSize) + 1}:`, error);
        // Mark all stores in this batch as failed
        batch.forEach((storeData, batchIndex) => {
          const globalIndex = i + batchIndex;
          results.failed++;
          results.errors.push({
            index: globalIndex,
            storeId: storeData.storeId || 'N/A',
            error: `Batch processing error: ${error.message}`,
            data: {
              storeName: storeData.storeName || 'N/A',
              city: storeData.city || 'N/A'
            }
          });
        });
      }
    }
    
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    
    console.log(`Bulk import completed in ${results.processingTime}ms`);
    console.log(`Results: ${results.created} created, ${results.updated} updated, ${results.failed} failed`);
    
    return results;
    
  } catch (error) {
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    results.errors.push({
      index: -1,
      storeId: 'N/A',
      error: `Bulk import failed: ${error.message}`,
      data: {
        storeName: 'N/A',
        city: 'N/A'
      }
    });
    throw error;
  }
};