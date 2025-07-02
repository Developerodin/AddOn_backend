import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import { cleanFilterObjectIds } from '../utils/validateObjectId.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as sealsExcelMasterService from '../services/sealsExcelMaster.service.js';

export const createSealsExcelMaster = catchAsync(async (req, res) => {
  const record = await sealsExcelMasterService.createSealsExcelMaster(req.body);
  res.status(httpStatus.CREATED).send(record);
});

export const getSealsExcelMasters = catchAsync(async (req, res) => {
  // Define allowed filter fields
  const allowedFilterFields = [
    'fileName', 
    'description', 
    'fileKey', 
    'uploadedBy', 
    'processingStatus', 
    'mimeType', 
    'isActive'
  ];
  
  // Pick only valid filter fields
  const filter = pick(req.query, allowedFilterFields);
  
  console.log('Original filter:', filter);
  console.log('Query params:', req.query);
  
  // Clean the filter - remove empty values
  const cleanFilter = cleanFilterObjectIds(filter, ['uploadedBy']);
  
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
  
  const result = await sealsExcelMasterService.querySealsExcelMasters(cleanFilter, options);
  res.send(result);
});

export const getSealsExcelMaster = catchAsync(async (req, res) => {
  const record = await sealsExcelMasterService.getSealsExcelMasterById(req.params.sealsExcelId);
  if (!record) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Seals Excel Master record not found');
  }
  res.send(record);
});

export const updateSealsExcelMaster = catchAsync(async (req, res) => {
  const record = await sealsExcelMasterService.updateSealsExcelMasterById(req.params.sealsExcelId, req.body);
  res.send(record);
});

export const deleteSealsExcelMaster = catchAsync(async (req, res) => {
  await sealsExcelMasterService.deleteSealsExcelMasterById(req.params.sealsExcelId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const getSealsExcelMastersByUser = catchAsync(async (req, res) => {
  const userId = req.params.userId || req.user.id;
  
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
  
  const result = await sealsExcelMasterService.getSealsExcelMastersByUser(userId, options);
  res.send(result);
});

export const getRecentUploads = catchAsync(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 10;
  const records = await sealsExcelMasterService.getRecentUploads(limit);
  res.send(records);
});

export const updateProcessingStatus = catchAsync(async (req, res) => {
  const { status, errorMessage } = req.body;
  const record = await sealsExcelMasterService.updateProcessingStatus(
    req.params.sealsExcelId, 
    status, 
    errorMessage
  );
  res.send(record);
});

export const bulkImportSealsExcelMasters = catchAsync(async (req, res) => {
  const { records, batchSize = 50 } = req.body;
  
  if (!records || !Array.isArray(records) || records.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Records array is required and must not be empty');
  }

  const results = await sealsExcelMasterService.bulkImportSealsExcelMasters(records, batchSize);
  
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