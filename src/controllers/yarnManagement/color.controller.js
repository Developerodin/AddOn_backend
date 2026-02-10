import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as colorService from '../../services/yarnManagement/color.service.js';

export const createColor = catchAsync(async (req, res) => {
  const color = await colorService.createColor(req.body);
  res.status(httpStatus.CREATED).send(color);
});

export const getColors = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'search', 'colorCode', 'pantoneName', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await colorService.queryColors(filter, options);
  res.send(result);
});

export const getColor = catchAsync(async (req, res) => {
  const color = await colorService.getColorById(req.params.colorId);
  if (!color) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Color not found');
  }
  res.send(color);
});

export const updateColor = catchAsync(async (req, res) => {
  const color = await colorService.updateColorById(req.params.colorId, req.body);
  res.send(color);
});

export const deleteColor = catchAsync(async (req, res) => {
  await colorService.deleteColorById(req.params.colorId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const bulkImportColors = catchAsync(async (req, res) => {
  const { colors, batchSize = 50 } = req.body;
  
  if (!colors || !Array.isArray(colors) || colors.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Colors array is required and must not be empty');
  }

  const results = await colorService.bulkImportColors(colors, batchSize);
  
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

  const statusCode = results.failed === 0 ? httpStatus.OK : 
                    results.failed === results.total ? httpStatus.BAD_REQUEST : 
                    httpStatus.PARTIAL_CONTENT;

  res.status(statusCode).send(response);
});

