import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as blendService from '../../services/yarnManagement/blend.service.js';

export const createBlend = catchAsync(async (req, res) => {
  const blend = await blendService.createBlend(req.body);
  res.status(httpStatus.CREATED).send(blend);
});

export const getBlends = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await blendService.queryBlends(filter, options);
  res.send(result);
});

export const getBlend = catchAsync(async (req, res) => {
  const blend = await blendService.getBlendById(req.params.blendId);
  if (!blend) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Blend not found');
  }
  res.send(blend);
});

export const updateBlend = catchAsync(async (req, res) => {
  const blend = await blendService.updateBlendById(req.params.blendId, req.body);
  res.send(blend);
});

export const deleteBlend = catchAsync(async (req, res) => {
  await blendService.deleteBlendById(req.params.blendId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const bulkImportBlends = catchAsync(async (req, res) => {
  const { blends, batchSize = 50 } = req.body;
  
  if (!blends || !Array.isArray(blends) || blends.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Blends array is required and must not be empty');
  }

  const results = await blendService.bulkImportBlends(blends, batchSize);
  
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

