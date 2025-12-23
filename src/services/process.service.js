import httpStatus from 'http-status';
import { Process } from '../models/index.js';
import ApiError from '../utils/ApiError.js';

/**
 * Create a process
 * @param {Object} processBody
 * @returns {Promise<Process>}
 */
export const createProcess = async (processBody) => {
  return Process.create(processBody);
};

/**
 * Query for processes
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @param {string} [search] - Search term to filter across multiple fields
 * @returns {Promise<QueryResult>}
 */
export const queryProcesses = async (filter, options, search) => {
  // Handle search parameter - search across multiple fields
  if (search && typeof search === 'string' && search.trim()) {
    const searchTerm = search.trim();
    // Escape special regex characters
    const escapedSearch = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedSearch, 'i');
    
    // Build $or query to search across multiple fields
    const searchFilter = {
      $or: [
        { name: searchRegex },
        { type: searchRegex },
        { description: searchRegex },
        { 'steps.stepTitle': searchRegex },
        { 'steps.stepDescription': searchRegex },
      ],
    };
    
    // Combine search filter with existing filter using $and
    if (Object.keys(filter).length > 0) {
      filter = {
        $and: [filter, searchFilter],
      };
    } else {
      filter = searchFilter;
    }
  }
  
  const processes = await Process.paginate(filter, options);
  return processes;
};

/**
 * Get process by id
 * @param {ObjectId} id
 * @returns {Promise<Process>}
 */
export const getProcessById = async (id) => {
  return Process.findById(id);
};

/**
 * Update process by id
 * @param {ObjectId} processId
 * @param {Object} updateBody
 * @returns {Promise<Process>}
 */
export const updateProcessById = async (processId, updateBody) => {
  const process = await getProcessById(processId);
  if (!process) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Process not found');
  }
  Object.assign(process, updateBody);
  await process.save();
  return process;
};

/**
 * Delete process by id
 * @param {ObjectId} processId
 * @returns {Promise<Process>}
 */
export const deleteProcessById = async (processId) => {
  const process = await getProcessById(processId);
  if (!process) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Process not found');
  }
  await process.deleteOne();
  return process;
}; 