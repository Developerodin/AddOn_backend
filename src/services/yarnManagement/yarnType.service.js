import httpStatus from 'http-status';
import { YarnType } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Create a yarn type
 * @param {Object} yarnTypeBody
 * @returns {Promise<YarnType>}
 */
export const createYarnType = async (yarnTypeBody) => {
  if (await YarnType.isNameTaken(yarnTypeBody.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Yarn type name already taken');
  }
  return YarnType.create(yarnTypeBody);
};

/**
 * Query for yarn types
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
export const queryYarnTypes = async (filter, options) => {
  const yarnTypes = await YarnType.paginate(filter, options);
  return yarnTypes;
};

/**
 * Get yarn type by id
 * @param {ObjectId} id
 * @returns {Promise<YarnType>}
 */
export const getYarnTypeById = async (id) => {
  return YarnType.findById(id);
};

/**
 * Update yarn type by id
 * @param {ObjectId} yarnTypeId
 * @param {Object} updateBody
 * @returns {Promise<YarnType>}
 */
export const updateYarnTypeById = async (yarnTypeId, updateBody) => {
  const yarnType = await getYarnTypeById(yarnTypeId);
  if (!yarnType) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn type not found');
  }
  if (updateBody.name && (await YarnType.isNameTaken(updateBody.name, yarnTypeId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Yarn type name already taken');
  }
  Object.assign(yarnType, updateBody);
  await yarnType.save();
  return yarnType;
};

/**
 * Delete yarn type by id
 * @param {ObjectId} yarnTypeId
 * @returns {Promise<YarnType>}
 */
export const deleteYarnTypeById = async (yarnTypeId) => {
  const yarnType = await getYarnTypeById(yarnTypeId);
  if (!yarnType) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn type not found');
  }
  await yarnType.deleteOne();
  return yarnType;
};

