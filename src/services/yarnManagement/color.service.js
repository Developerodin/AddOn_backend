import httpStatus from 'http-status';
import { Color } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Create a color
 * @param {Object} colorBody
 * @returns {Promise<Color>}
 */
export const createColor = async (colorBody) => {
  if (await Color.isNameTaken(colorBody.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Color name already taken');
  }
  if (await Color.isColorCodeTaken(colorBody.colorCode)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Color code already taken');
  }
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
  const colors = await Color.paginate(filter, options);
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
  if (updateBody.name && (await Color.isNameTaken(updateBody.name, colorId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Color name already taken');
  }
  if (updateBody.colorCode && (await Color.isColorCodeTaken(updateBody.colorCode, colorId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Color code already taken');
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

