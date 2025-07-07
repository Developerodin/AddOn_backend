import httpStatus from 'http-status';
import Sales from '../models/sales.model.js';
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
    
    const sales = await Sales.paginate(filter, {
      ...options,
      populate: 'plant,materialCode', // Always populate references
    });
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
  return Sales.findById(id).populate('plant,materialCode');
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
 * @param {Array} salesRecords - Array of sales objects
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
            
            // Prepare sales data with minimal memory footprint
            const processedData = {
              date: salesData.date ? new Date(salesData.date) : new Date(),
              plant: salesData.plant,
              materialCode: salesData.materialCode,
              quantity: Number(salesData.quantity) || 0,
              mrp: Number(salesData.mrp) || 0,
              discount: Number(salesData.discount) || 0,
              gsv: Number(salesData.gsv) || 0,
              nsv: Number(salesData.nsv) || 0,
              totalTax: Number(salesData.totalTax) || 0,
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