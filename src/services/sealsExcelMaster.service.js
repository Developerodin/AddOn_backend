import httpStatus from 'http-status';
import SealsExcelMaster from '../models/sealsExcelMaster.model.js';
import ApiError from '../utils/ApiError.js';

/**
 * Create a seals excel master record
 * @param {Object} sealsExcelBody
 * @returns {Promise<SealsExcelMaster>}
 */
export const createSealsExcelMaster = async (sealsExcelBody) => {
  if (await SealsExcelMaster.isFileKeyTaken(sealsExcelBody.fileKey)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'File key already taken');
  }
  return SealsExcelMaster.create(sealsExcelBody);
};

/**
 * Query for seals excel master records
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @param {string} [options.populate] - Populate options
 * @returns {Promise<QueryResult>}
 */
export const querySealsExcelMasters = async (filter, options) => {
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
    
    const records = await SealsExcelMaster.paginate(filter, options);
    return records;
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
 * Get seals excel master by id
 * @param {ObjectId} id
 * @returns {Promise<SealsExcelMaster>}
 */
export const getSealsExcelMasterById = async (id) => {
  return SealsExcelMaster.findById(id);
};

/**
 * Update seals excel master by id
 * @param {ObjectId} sealsExcelId
 * @param {Object} updateBody
 * @returns {Promise<SealsExcelMaster>}
 */
export const updateSealsExcelMasterById = async (sealsExcelId, updateBody) => {
  const record = await getSealsExcelMasterById(sealsExcelId);
  if (!record) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Seals Excel Master record not found');
  }
  if (updateBody.fileKey && (await SealsExcelMaster.isFileKeyTaken(updateBody.fileKey, sealsExcelId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'File key already taken');
  }
  Object.assign(record, updateBody);
  await record.save();
  return record;
};

/**
 * Delete seals excel master by id
 * @param {ObjectId} sealsExcelId
 * @returns {Promise<SealsExcelMaster>}
 */
export const deleteSealsExcelMasterById = async (sealsExcelId) => {
  const record = await getSealsExcelMasterById(sealsExcelId);
  if (!record) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Seals Excel Master record not found');
  }
  await record.deleteOne();
  return record;
};

/**
 * Get seals excel master records by user
 * @param {ObjectId} userId
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
export const getSealsExcelMastersByUser = async (userId, options = {}) => {
  return SealsExcelMaster.getByUser(userId, options);
};

/**
 * Get recent uploads
 * @param {number} limit - Number of records to fetch
 * @returns {Promise<Array>}
 */
export const getRecentUploads = async (limit = 10) => {
  return SealsExcelMaster.getRecentUploads(limit);
};

/**
 * Update processing status
 * @param {ObjectId} sealsExcelId
 * @param {string} status - Processing status
 * @param {string} errorMessage - Optional error message
 * @returns {Promise<SealsExcelMaster>}
 */
export const updateProcessingStatus = async (sealsExcelId, status, errorMessage = null) => {
  const record = await getSealsExcelMasterById(sealsExcelId);
  if (!record) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Seals Excel Master record not found');
  }
  
  record.processingStatus = status;
  if (errorMessage) {
    record.errorMessage = errorMessage;
  }
  
  await record.save();
  return record;
};

/**
 * Bulk import seals excel master records
 * @param {Array} records - Array of seals excel master objects
 * @param {number} batchSize - Number of records to process in each batch
 * @returns {Promise<Object>} - Results of the bulk import operation
 */
export const bulkImportSealsExcelMasters = async (records, batchSize = 50) => {
  const results = {
    total: records.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  try {
    // Validate input size
    if (records.length > 1000) {
      throw new Error('Maximum 1000 records allowed per request');
    }

    // Process records in batches
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      try {
        // Process each record in the current batch
        const batchPromises = batch.map(async (recordData, batchIndex) => {
          const globalIndex = i + batchIndex;
          
          try {
            const hasId = recordData.id && recordData.id.trim() !== '';
            
            // Prepare record data
            const processedData = {
              fileName: recordData.fileName?.trim(),
              description: recordData.description?.trim() || '',
              fileUrl: recordData.fileUrl?.trim(),
              fileKey: recordData.fileKey?.trim(),
              data: recordData.data,
              uploadedBy: recordData.uploadedBy,
              fileSize: recordData.fileSize,
              mimeType: recordData.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              processingStatus: recordData.processingStatus || 'pending',
              recordsCount: recordData.recordsCount || 0,
              isActive: recordData.isActive !== undefined ? recordData.isActive : true,
            };

            if (hasId) {
              // Update existing record
              const existingRecord = await SealsExcelMaster.findById(recordData.id).lean();
              if (!existingRecord) {
                throw new Error(`Record with ID ${recordData.id} not found`);
              }
              
              // Check for file key conflicts
              if (processedData.fileKey && processedData.fileKey !== existingRecord.fileKey) {
                const duplicateCheck = await SealsExcelMaster.findOne({ 
                  fileKey: processedData.fileKey, 
                  _id: { $ne: recordData.id } 
                }).lean();
                if (duplicateCheck) {
                  throw new Error(`File key ${processedData.fileKey} already exists`);
                }
              }
              
              await SealsExcelMaster.updateOne(
                { _id: recordData.id },
                { $set: processedData }
              );
              results.updated++;
            } else {
              // Create new record
              const duplicateCheck = await SealsExcelMaster.findOne({ fileKey: processedData.fileKey }).lean();
              if (duplicateCheck) {
                throw new Error(`File key ${processedData.fileKey} already exists`);
              }
              
              await SealsExcelMaster.create(processedData);
              results.created++;
            }
          } catch (error) {
            results.failed++;
            results.errors.push({
              index: globalIndex,
              error: error.message,
              data: recordData
            });
          }
        });
        
        await Promise.all(batchPromises);
      } catch (batchError) {
        console.error(`Batch processing error:`, batchError);
        results.failed += batch.length;
      }
    }
  } catch (error) {
    throw new ApiError(httpStatus.BAD_REQUEST, error.message);
  } finally {
    results.processingTime = Date.now() - startTime;
  }

  return results;
}; 