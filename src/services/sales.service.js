import httpStatus from 'http-status';
import Sales from '../models/sales.model.js';
import Store from '../models/store.model.js';
import Product from '../models/product.model.js';
import ApiError from '../utils/ApiError.js';

/**
 * Create a sales record
 * @param {Object} salesBody
 * @returns {Promise<Sales>}
 */
export const createSales = async (salesBody) => {
  // Check if sales record already exists for the same plant, material and date
  if (await Sales.isSalesRecordExists(salesBody.plant, salesBody.materialCode, salesBody.date)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Sales record already exists for this plant, material and date');
  }
  return Sales.create(salesBody);
};

/**
 * Query for sales records
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @param {string} [options.populate] - Populate options
 * @returns {Promise<QueryResult>}
 */
export const querySales = async (filter, options) => {
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
    
    // Handle city filtering
    if (filter.city) {
      const city = filter.city.trim();
      // Find stores in the specified city
      const storesInCity = await Store.find({ city: { $regex: city, $options: 'i' } }).select('_id').lean();
      if (storesInCity.length === 0) {
        // Return empty results if no stores found in city
        return {
          results: [],
          page: options.page || 1,
          limit: options.limit || 10,
          totalPages: 0,
          totalResults: 0,
        };
      }
      filter.plant = { $in: storesInCity.map(store => store._id) };
      delete filter.city;
    }
    
    // Handle category filtering
    if (filter.category) {
      // Find products in the specified category
      const productsInCategory = await Product.find({ category: filter.category }).select('_id').lean();
      if (productsInCategory.length === 0) {
        // Return empty results if no products found in category
        return {
          results: [],
          page: options.page || 1,
          limit: options.limit || 10,
          totalPages: 0,
          totalResults: 0,
        };
      }
      filter.materialCode = { $in: productsInCategory.map(product => product._id) };
      delete filter.category;
    }
    
    // Resolve string/number identifiers to ObjectIds
    if (filter.plant && !Array.isArray(filter.plant)) {
      // Convert to string for consistent lookup
      const storeId = String(filter.plant).trim();
      const store = await Store.findOne({ storeId: storeId }).select('_id').lean();
      if (!store) {
        throw new ApiError(httpStatus.NOT_FOUND, `Store with ID '${storeId}' not found`);
      }
      filter.plant = store._id;
    }
    
    if (filter.materialCode && typeof filter.materialCode === 'string' && !Array.isArray(filter.materialCode)) {
      const product = await Product.findOne({ styleCode: filter.materialCode.trim() }).select('_id').lean();
      if (!product) {
        throw new ApiError(httpStatus.NOT_FOUND, `Product with style code '${filter.materialCode}' not found`);
      }
      filter.materialCode = product._id;
    }
    
    // Handle date range filtering
    if (filter.dateFrom || filter.dateTo) {
      const dateFilter = {};
      if (filter.dateFrom) {
        dateFilter.$gte = new Date(filter.dateFrom);
        delete filter.dateFrom;
      }
      if (filter.dateTo) {
        dateFilter.$lte = new Date(filter.dateTo);
        delete filter.dateTo;
      }
      filter.date = dateFilter;
    }
    
    // Combine sortBy and sortOrder into the format expected by paginate plugin
    const paginateOptions = { ...options };
    if (options.sortBy && options.sortOrder) {
      paginateOptions.sortBy = `${options.sortBy}:${options.sortOrder}`;
    } else if (options.sortBy) {
      // Default to desc if sortOrder not provided
      paginateOptions.sortBy = `${options.sortBy}:desc`;
    }
    
    const sales = await Sales.paginate(filter, {
      ...paginateOptions,
      populate: 'plant,materialCode.category', // Populate store, product, and category data
    });

    // Post-process to handle null categories and add default values
    if (sales.results && sales.results.length > 0) {
      sales.results = sales.results.map(sale => {
        if (sale.materialCode && !sale.materialCode.category) {
          // Add default category info if category is null
          sale.materialCode.category = {
            _id: null,
            name: 'Uncategorized'
          };
        }
        return sale;
      });
    }
    return sales;
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
 * Get sales record by id
 * @param {ObjectId} id
 * @returns {Promise<Sales>}
 */
export const getSalesById = async (id) => {
  const sales = await Sales.findById(id).populate('plant,materialCode.category');
  
  // Handle null category
  if (sales && sales.materialCode && !sales.materialCode.category) {
    sales.materialCode.category = {
      _id: null,
      name: 'Uncategorized'
    };
  }
  
  return sales;
};

/**
 * Update sales record by id
 * @param {ObjectId} salesId
 * @param {Object} updateBody
 * @returns {Promise<Sales>}
 */
export const updateSalesById = async (salesId, updateBody) => {
  const sales = await getSalesById(salesId);
  if (!sales) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sales record not found');
  }
  
  // Check if updated record would conflict with existing record
  if (updateBody.plant || updateBody.materialCode || updateBody.date) {
    const plant = updateBody.plant || sales.plant;
    const materialCode = updateBody.materialCode || sales.materialCode;
    const date = updateBody.date || sales.date;
    
    if (await Sales.isSalesRecordExists(plant, materialCode, date, salesId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Sales record already exists for this plant, material and date');
    }
  }
  
  Object.assign(sales, updateBody);
  await sales.save();
  return sales;
};

/**
 * Delete sales record by id
 * @param {ObjectId} salesId
 * @returns {Promise<Sales>}
 */
export const deleteSalesById = async (salesId) => {
  const sales = await getSalesById(salesId);
  if (!sales) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sales record not found');
  }
  await sales.deleteOne();
  return sales;
};

/**
 * Bulk import sales records with batch processing
 * @param {Array} salesRecords - Array of sales objects with string identifiers
 * @param {number} batchSize - Number of records to process in each batch
 * @returns {Promise<Object>} - Results of the bulk import operation
 */
export const bulkImportSales = async (salesRecords, batchSize = 50) => {
  const results = {
    total: salesRecords.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  try {
    // Validate input size
    if (salesRecords.length > 1000) {
      throw new Error('Maximum 1000 sales records allowed per request');
    }

    // Estimate memory usage (rough calculation)
    const estimatedMemoryMB = (salesRecords.length * 1000) / (1024 * 1024); // ~1KB per record
    if (estimatedMemoryMB > 100) {
      console.warn(`Large bulk import detected: ${estimatedMemoryMB.toFixed(2)} MB estimated memory usage`);
    }

    // Pre-fetch all unique storeIds and styleCodes for better performance
    const uniqueStoreIds = [...new Set(salesRecords.map(record => record.plant?.trim()).filter(Boolean))];
    const uniqueStyleCodes = [...new Set(salesRecords.map(record => record.materialCode?.trim()).filter(Boolean))];

    console.log(`Resolving ${uniqueStoreIds.length} unique stores and ${uniqueStyleCodes.length} unique products`);

    // Fetch all stores and products in bulk
    const [stores, products] = await Promise.all([
      Store.find({ storeId: { $in: uniqueStoreIds } }).select('_id storeId').lean(),
      Product.find({ styleCode: { $in: uniqueStyleCodes } }).select('_id styleCode').lean()
    ]);

    // Create lookup maps for O(1) access
    const storeMap = new Map(stores.map(store => [store.storeId, store._id]));
    const productMap = new Map(products.map(product => [product.styleCode, product._id]));

    // Track missing references for better error reporting
    const missingStoreIds = uniqueStoreIds.filter(storeId => !storeMap.has(storeId));
    const missingStyleCodes = uniqueStyleCodes.filter(styleCode => !productMap.has(styleCode));

    if (missingStoreIds.length > 0) {
      console.warn(`Missing stores: ${missingStoreIds.join(', ')}`);
    }
    if (missingStyleCodes.length > 0) {
      console.warn(`Missing products: ${missingStyleCodes.join(', ')}`);
    }

    // Process records in batches
    for (let i = 0; i < salesRecords.length; i += batchSize) {
      const batch = salesRecords.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      try {
        // Process each record in the current batch
        const batchPromises = batch.map(async (salesData, batchIndex) => {
          const globalIndex = i + batchIndex;
          
          try {
            const hasId = salesData.id && salesData.id.trim() !== '';
            
            // Validate and resolve string identifiers to ObjectIds
            const storeId = salesData.plant?.trim();
            const styleCode = salesData.materialCode?.trim();
            
            if (!storeId) {
              throw new Error('Plant (storeId) is required');
            }
            if (!styleCode) {
              throw new Error('Material code (styleCode) is required');
            }

            // Resolve store and product ObjectIds
            const plantObjectId = storeMap.get(storeId);
            const materialObjectId = productMap.get(styleCode);

            if (!plantObjectId) {
              throw new Error(`Store with ID '${storeId}' not found`);
            }
            if (!materialObjectId) {
              throw new Error(`Product with style code '${styleCode}' not found`);
            }

            // Validate numeric fields
            const quantity = Number(salesData.quantity);
            const mrp = Number(salesData.mrp);
            const discount = Number(salesData.discount) || 0;
            const gsv = Number(salesData.gsv);
            const nsv = Number(salesData.nsv);
            const totalTax = Number(salesData.totalTax) || 0;

            if (isNaN(quantity) || quantity < 0) {
              throw new Error('Quantity must be a non-negative number');
            }
            if (isNaN(mrp) || mrp < 0) {
              throw new Error('MRP must be a non-negative number');
            }
            if (isNaN(discount) || discount < 0) {
              throw new Error('Discount must be a non-negative number');
            }
            if (isNaN(gsv) || gsv < 0) {
              throw new Error('GSV must be a non-negative number');
            }
            if (isNaN(nsv) || nsv < 0) {
              throw new Error('NSV must be a non-negative number');
            }
            if (isNaN(totalTax) || totalTax < 0) {
              throw new Error('Total tax must be a non-negative number');
            }

            // Prepare sales data with resolved ObjectIds
            const processedData = {
              date: salesData.date ? new Date(salesData.date) : new Date(),
              plant: plantObjectId,
              materialCode: materialObjectId,
              quantity,
              mrp,
              discount,
              gsv,
              nsv,
              totalTax,
            };

            if (hasId) {
              // Update existing record
              const existingRecord = await Sales.findById(salesData.id).lean();
              if (!existingRecord) {
                throw new Error(`Sales record with ID ${salesData.id} not found`);
              }
              
              // Check for conflicts
              const startOfDay = new Date(processedData.date);
              startOfDay.setHours(0, 0, 0, 0);
              const endOfDay = new Date(processedData.date);
              endOfDay.setHours(23, 59, 59, 999);
              
              const conflictCheck = await Sales.findOne({
                plant: processedData.plant,
                materialCode: processedData.materialCode,
                date: { $gte: startOfDay, $lte: endOfDay },
                _id: { $ne: salesData.id }
              }).lean();
              
              if (conflictCheck) {
                throw new Error(`Sales record already exists for this plant, material and date`);
              }
              
              // Use updateOne for better performance
              await Sales.updateOne(
                { _id: salesData.id },
                { $set: processedData }
              );
              results.updated++;
            } else {
              // Create new record
              // Check for conflicts
              const startOfDay = new Date(processedData.date);
              startOfDay.setHours(0, 0, 0, 0);
              const endOfDay = new Date(processedData.date);
              endOfDay.setHours(23, 59, 59, 999);
              
              const conflictCheck = await Sales.findOne({
                plant: processedData.plant,
                materialCode: processedData.materialCode,
                date: { $gte: startOfDay, $lte: endOfDay }
              }).lean();
              
              if (conflictCheck) {
                throw new Error(`Sales record already exists for this plant, material and date`);
              }
              
              await Sales.create(processedData);
              results.created++;
            }
          } catch (error) {
            results.failed++;
            results.errors.push({
              index: globalIndex,
              plant: salesData.plant || 'N/A',
              materialCode: salesData.materialCode || 'N/A',
              error: error.message,
            });
          }
        });
        
        // Wait for all records in the current batch to complete
        await Promise.all(batchPromises);
        
        const batchEndTime = Date.now();
        console.log(`Batch ${Math.floor(i / batchSize) + 1} completed in ${batchEndTime - batchStartTime}ms`);
        
      } catch (error) {
        console.error(`Error processing batch ${Math.floor(i / batchSize) + 1}:`, error);
        // Mark all records in this batch as failed
        batch.forEach((_, batchIndex) => {
          const globalIndex = i + batchIndex;
          results.failed++;
          results.errors.push({
            index: globalIndex,
            plant: 'N/A',
            materialCode: 'N/A',
            error: `Batch processing error: ${error.message}`,
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
      plant: 'N/A',
      materialCode: 'N/A',
      error: `Bulk import failed: ${error.message}`,
    });
    throw error;
  }
}; 

/**
 * Bulk delete sales records
 * @param {Array} salesIds - Array of sales ObjectIds
 * @param {number} batchSize - Number of records to process in each batch
 * @returns {Promise<Object>} - Results of the bulk delete operation
 */
export const bulkDeleteSales = async (salesIds, batchSize = 50) => {
  const results = {
    total: salesIds.length,
    deleted: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  try {
    // Validate input size
    if (salesIds.length > 1000) {
      throw new Error('Maximum 1000 sales records allowed per delete request');
    }

    // Validate all IDs are valid ObjectIds
    const invalidIds = salesIds.filter(id => !/^[0-9a-fA-F]{24}$/.test(id));
    if (invalidIds.length > 0) {
      throw new Error(`Invalid ObjectId format: ${invalidIds.join(', ')}`);
    }

    // Estimate memory usage (rough calculation)
    const estimatedMemoryMB = (salesIds.length * 100) / (1024 * 1024); // ~100 bytes per ID
    if (estimatedMemoryMB > 10) {
      console.warn(`Large bulk delete detected: ${estimatedMemoryMB.toFixed(2)} MB estimated memory usage`);
    }

    // Process deletions in batches
    for (let i = 0; i < salesIds.length; i += batchSize) {
      const batch = salesIds.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      try {
        // Process each deletion in the current batch
        const batchPromises = batch.map(async (salesId, batchIndex) => {
          const globalIndex = i + batchIndex;
          
          try {
            // Check if sales record exists
            const existingRecord = await Sales.findById(salesId).lean();
            if (!existingRecord) {
              throw new Error(`Sales record with ID ${salesId} not found`);
            }
            
            // Delete the record
            await Sales.deleteOne({ _id: salesId });
            results.deleted++;
            
          } catch (error) {
            results.failed++;
            results.errors.push({
              index: globalIndex,
              salesId: salesId,
              error: error.message,
            });
          }
        });
        
        // Wait for all deletions in the current batch to complete
        await Promise.all(batchPromises);
        
        const batchEndTime = Date.now();
        console.log(`Batch ${Math.floor(i / batchSize) + 1} completed in ${batchEndTime - batchStartTime}ms`);
        
      } catch (error) {
        console.error(`Error processing batch ${Math.floor(i / batchSize) + 1}:`, error);
        // Mark all records in this batch as failed
        batch.forEach((salesId, batchIndex) => {
          const globalIndex = i + batchIndex;
          results.failed++;
          results.errors.push({
            index: globalIndex,
            salesId: salesId,
            error: `Batch processing error: ${error.message}`,
          });
        });
      }
    }
    
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    
    console.log(`Bulk delete completed in ${results.processingTime}ms`);
    console.log(`Results: ${results.deleted} deleted, ${results.failed} failed`);
    
    return results;
    
  } catch (error) {
    const endTime = Date.now();
    results.processingTime = endTime - startTime;
    results.errors.push({
      index: -1,
      salesId: 'N/A',
      error: `Bulk delete failed: ${error.message}`,
    });
    throw error;
  }
}; 