import httpStatus from 'http-status';
import RawMaterial from '../models/rawMaterial.model.js';
import ApiError from '../utils/ApiError.js';

/**
 * Create a raw material
 * @param {Object} materialBody
 * @returns {Promise<RawMaterial>}
 */
export const createRawMaterial = async (materialBody) => {
  return RawMaterial.create(materialBody);
};

/**
 * Query for raw materials
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
export const queryRawMaterials = async (filter, options) => {
  const materials = await RawMaterial.paginate(filter, options);
  return materials;
};

/**
 * Get raw material by id
 * @param {ObjectId} id
 * @returns {Promise<RawMaterial>}
 */
export const getRawMaterialById = async (id) => {
  return RawMaterial.findById(id);
};

/**
 * Update raw material by id
 * @param {ObjectId} materialId
 * @param {Object} updateBody
 * @returns {Promise<RawMaterial>}
 */
export const updateRawMaterialById = async (materialId, updateBody) => {
  const material = await getRawMaterialById(materialId);
  if (!material) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Raw material not found');
  }
  Object.assign(material, updateBody);
  await material.save();
  return material;
};

/**
 * Delete raw material by id
 * @param {ObjectId} materialId
 * @returns {Promise<RawMaterial>}
 */
export const deleteRawMaterialById = async (materialId) => {
  const material = await getRawMaterialById(materialId);
  if (!material) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Raw material not found');
  }
  await material.remove();
  return material;
}; 