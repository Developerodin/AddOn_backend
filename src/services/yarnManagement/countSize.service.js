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

