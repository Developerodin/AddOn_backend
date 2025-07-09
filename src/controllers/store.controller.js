import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import { cleanFilterObjectIds } from '../utils/validateObjectId.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as storeService from '../services/store.service.js';

export const createStore = catchAsync(async (req, res) => {
  const store = await storeService.createStore(req.body);
  res.status(httpStatus.CREATED).send(store);
});

export const getStores = catchAsync(async (req, res) => {
  // Define allowed filter fields
  const allowedFilterFields = [
    'storeId', 'storeName', 'city', 'contactPerson', 'contactEmail', 'creditRating', 'isActive',
    // New fields
    'bpCode', 'oldStoreCode', 'bpName', 'street', 'block', 'zipCode', 'state', 'country',
    'telephone', 'internalSapCode', 'internalSoftwareCode', 'brandGrouping', 'brand',
    'hankyNorms', 'socksNorms', 'towelNorms', 'totalNorms'
  ];
  
  // Pick only valid filter fields
  const filter = pick(req.query, allowedFilterFields);
  
  console.log('Original filter:', filter);
  console.log('Query params:', req.query);
  
  // Clean the filter - remove empty values
  const cleanFilter = cleanFilterObjectIds(filter, []);
  
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
  
  const result = await storeService.queryStores(cleanFilter, options);
  res.send(result);
});

export const getStore = catchAsync(async (req, res) => {
  const store = await storeService.getStoreById(req.params.storeId);
  if (!store) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Store not found');
  }
  res.send(store);
});

export const updateStore = catchAsync(async (req, res) => {
  const store = await storeService.updateStoreById(req.params.storeId, req.body);
  res.send(store);
});

export const deleteStore = catchAsync(async (req, res) => {
  await storeService.deleteStoreById(req.params.storeId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const bulkImportStores = catchAsync(async (req, res) => {
  const { stores, batchSize = 50 } = req.body;
  
  if (!stores || !Array.isArray(stores) || stores.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Stores array is required and must not be empty');
  }

  const results = await storeService.bulkImportStores(stores, batchSize);
  
  // Prepare response based on results
  const response = {
    message: 'Bulk import completed',
    summary: {
      total: results.total,
      created: results.created,
      updated: results.updated,
      failed: results.failed,
      successRate: results.total > 0 ? ((results.created + results.updated) / results.total * 100).toFixed(2) + '%' : '0%',
      processingTime: `${results.processingTime}ms`
    },
    details: {
      successful: results.created + results.updated,
      errors: results.errors
    }
  };

  // Set appropriate status code
  const statusCode = results.failed === 0 ? httpStatus.OK : 
                    results.failed === results.total ? httpStatus.BAD_REQUEST : 
                    httpStatus.PARTIAL_CONTENT;

  res.status(statusCode).send(response);
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