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
 * @param {string} [search] - Search term to filter across multiple fields
 * @returns {Promise<QueryResult>}
 */
export const queryProductAttributes = async (filter, options, search) => {
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
        { attributeType: searchRegex },
        { type: searchRegex },
        { 'optionValues.name': searchRegex },
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
  // attributeType exact filter if provided
  if (filter.attributeType) {
    filter.attributeType = filter.attributeType;
  }
  
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