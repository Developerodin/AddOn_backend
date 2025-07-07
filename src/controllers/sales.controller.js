import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import { cleanFilterObjectIds } from '../utils/validateObjectId.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as salesService from '../services/sales.service.js';

export const createSales = catchAsync(async (req, res) => {
  const sales = await salesService.createSales(req.body);
  res.status(httpStatus.CREATED).send(sales);
});

export const getSales = catchAsync(async (req, res) => {
  // Define allowed filter fields
  const allowedFilterFields = [
    'plant', 'materialCode', 'dateFrom', 'dateTo', 'quantity', 'mrp', 'discount', 'gsv', 'nsv', 'totalTax'
  ];
  
  // Pick only valid filter fields
  const filter = pick(req.query, allowedFilterFields);
  
  console.log('Original filter:', filter);
  console.log('Query params:', req.query);
  
  // Clean the filter - remove empty values
  const cleanFilter = cleanFilterObjectIds(filter, ['plant', 'materialCode']);
  
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
  
  const result = await salesService.querySales(cleanFilter, options);
  res.send(result);
});

export const getSalesRecord = catchAsync(async (req, res) => {
  const sales = await salesService.getSalesById(req.params.salesId);
  if (!sales) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sales record not found');
  }
  res.send(sales);
});

export const updateSales = catchAsync(async (req, res) => {
  const sales = await salesService.updateSalesById(req.params.salesId, req.body);
  res.send(sales);
});

export const deleteSales = catchAsync(async (req, res) => {
  await salesService.deleteSalesById(req.params.salesId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const bulkImportSales = catchAsync(async (req, res) => {
  const { salesRecords, batchSize = 50 } = req.body;
  
  if (!salesRecords || !Array.isArray(salesRecords) || salesRecords.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Sales records array is required and must not be empty');
  }

  const results = await salesService.bulkImportSales(salesRecords, batchSize);
  
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