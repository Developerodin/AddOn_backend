import httpStatus from 'http-status';
import ProductAttribute from '../models/productAttribute.model.js';
import ApiError from '../utils/ApiError.js';

/**
 * Create a product attribute
 * @param {Object} attributeBody
 * @returns {Promise<ProductAttribute>}
 */
export const createProductAttribute = async (attributeBody) => {
  return ProductAttribute.create(attributeBody);
};

/**
 * Query for product attributes
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
export const queryProductAttributes = async (filter, options) => {
  const attributes = await ProductAttribute.paginate(filter, options);
  return attributes;
};

/**
 * Get product attribute by id
 * @param {ObjectId} id
 * @returns {Promise<ProductAttribute>}
 */
export const getProductAttributeById = async (id) => {
  return ProductAttribute.findById(id);
};

/**
 * Update product attribute by id
 * @param {ObjectId} attributeId
 * @param {Object} updateBody
 * @returns {Promise<ProductAttribute>}
 */
export const updateProductAttributeById = async (attributeId, updateBody) => {
  const attribute = await getProductAttributeById(attributeId);
  if (!attribute) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product attribute not found');
  }
  Object.assign(attribute, updateBody);
  await attribute.save();
  return attribute;
};

/**
 * Delete product attribute by id
 * @param {ObjectId} attributeId
 * @returns {Promise<ProductAttribute>}
 */
export const deleteProductAttributeById = async (attributeId) => {
  const attribute = await getProductAttributeById(attributeId);
  if (!attribute) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product attribute not found');
  }
  await attribute.remove();
  return attribute;
}; 