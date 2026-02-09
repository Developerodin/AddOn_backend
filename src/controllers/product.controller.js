import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import { cleanFilterObjectIds } from '../utils/validateObjectId.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as productService from '../services/product.service.js';

export const createProduct = catchAsync(async (req, res) => {
  const product = await productService.createProduct(req.body);
  res.status(httpStatus.CREATED).send(product);
});

export const getProducts = catchAsync(async (req, res) => {
  // Define allowed filter fields
  const allowedFilterFields = ['name', 'softwareCode', 'internalCode', 'vendorCode', 'factoryCode', 'styleCode', 'eanCode', 'brand', 'pack', 'category', 'status'];
  
  // Pick only valid filter fields
  const filter = pick(req.query, allowedFilterFields);
  
  // Extract search parameter separately
  const search = req.query.search;
  
  console.log('Original filter:', filter);
  console.log('Search term:', search);
  console.log('Query params:', req.query);
  
  // Clean the filter - remove empty values and validate ObjectId fields
  const cleanFilter = cleanFilterObjectIds(filter, ['category']);
  
  console.log('Clean filter:', cleanFilter);
  
  // Only pick allowed options
  const allowedOptions = ['sortBy', 'limit', 'page', 'populate'];
  const options = pick(req.query, allowedOptions);
  
  // Ensure limit and page are numbers
  if (options.limit) {
    options.limit = parseInt(options.limit, 10);
  }
  if (options.page) {
    options.page = parseInt(options.page, 10);
  }
  
  const result = await productService.queryProducts(cleanFilter, options, search);
  res.send(result);
});

export const getProduct = catchAsync(async (req, res) => {
  const product = await productService.getProductById(req.params.productId);
  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }
  res.send(product);
});

export const updateProduct = catchAsync(async (req, res) => {
  const product = await productService.updateProductById(req.params.productId, req.body);
  res.send(product);
});

export const deleteProduct = catchAsync(async (req, res) => {
  await productService.deleteProductById(req.params.productId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const bulkImportProducts = catchAsync(async (req, res) => {
  const { products, batchSize = 50 } = req.body;
  
  if (!products || !Array.isArray(products) || products.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Products array is required and must not be empty');
  }

  const results = await productService.bulkImportProducts(products, batchSize);
  
  res.status(httpStatus.OK).send({
    message: 'Bulk import completed',
    results,
  });
});

export const debugQuery = catchAsync(async (req, res) => {
  res.status(httpStatus.OK).json({
    message: 'Debug query parameters',
    query: req.query,
    headers: req.headers,
    url: req.url,
    method: req.method
  });
});

export const getProductByCode = catchAsync(async (req, res) => {
  const { factoryCode, internalCode } = req.query;
  const product = await productService.getProductByCode(factoryCode, internalCode);
  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }
  res.send(product);
}); 