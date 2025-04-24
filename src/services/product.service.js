import httpStatus from 'http-status';
import Product from '../models/product.model.js';
import ApiError from '../utils/ApiError.js';

/**
 * Create a product
 * @param {Object} productBody
 * @returns {Promise<Product>}
 */
export const createProduct = async (productBody) => {
  if (await Product.findOne({ softwareCode: productBody.softwareCode })) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Software code already taken');
  }
  return Product.create(productBody);
};

/**
 * Query for products
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
export const queryProducts = async (filter, options) => {
  const products = await Product.paginate(filter, options);
  return products;
};

/**
 * Get product by id
 * @param {ObjectId} id
 * @returns {Promise<Product>}
 */
export const getProductById = async (id) => {
  return Product.findById(id)
    .populate('category', 'name')
    .populate('bom.materialId', 'itemName printName')
    .populate('processes.processId', 'name type');
};

/**
 * Update product by id
 * @param {ObjectId} productId
 * @param {Object} updateBody
 * @returns {Promise<Product>}
 */
export const updateProductById = async (productId, updateBody) => {
  const product = await getProductById(productId);
  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }
  if (updateBody.softwareCode && (await Product.findOne({ softwareCode: updateBody.softwareCode, _id: { $ne: productId } }))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Software code already taken');
  }
  Object.assign(product, updateBody);
  await product.save();
  return product;
};

/**
 * Delete product by id
 * @param {ObjectId} productId
 * @returns {Promise<Product>}
 */
export const deleteProductById = async (productId) => {
  const product = await getProductById(productId);
  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }
  await product.deleteOne();
  return product;
}; 