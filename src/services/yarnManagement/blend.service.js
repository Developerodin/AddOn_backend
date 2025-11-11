import httpStatus from 'http-status';
import { Blend } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Create a blend
 * @param {Object} blendBody
 * @returns {Promise<Blend>}
 */
export const createBlend = async (blendBody) => {
  if (await Blend.isNameTaken(blendBody.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Blend name already taken');
  }
  return Blend.create(blendBody);
};

/**
 * Query for blends
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
export const queryBlends = async (filter, options) => {
  const blends = await Blend.paginate(filter, options);
  return blends;
};

/**
 * Get blend by id
 * @param {ObjectId} id
 * @returns {Promise<Blend>}
 */
export const getBlendById = async (id) => {
  return Blend.findById(id);
};

/**
 * Update blend by id
 * @param {ObjectId} blendId
 * @param {Object} updateBody
 * @returns {Promise<Blend>}
 */
export const updateBlendById = async (blendId, updateBody) => {
  const blend = await getBlendById(blendId);
  if (!blend) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Blend not found');
  }
  if (updateBody.name && (await Blend.isNameTaken(updateBody.name, blendId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Blend name already taken');
  }
  Object.assign(blend, updateBody);
  await blend.save();
  return blend;
};

/**
 * Delete blend by id
 * @param {ObjectId} blendId
 * @returns {Promise<Blend>}
 */
export const deleteBlendById = async (blendId) => {
  const blend = await getBlendById(blendId);
  if (!blend) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Blend not found');
  }
  await blend.deleteOne();
  return blend;
};

