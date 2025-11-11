import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as countSizeService from '../../services/yarnManagement/countSize.service.js';

export const createCountSize = catchAsync(async (req, res) => {
  const countSize = await countSizeService.createCountSize(req.body);
  res.status(httpStatus.CREATED).send(countSize);
});

export const getCountSizes = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await countSizeService.queryCountSizes(filter, options);
  res.send(result);
});

export const getCountSize = catchAsync(async (req, res) => {
  const countSize = await countSizeService.getCountSizeById(req.params.countSizeId);
  if (!countSize) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Count size not found');
  }
  res.send(countSize);
});

export const updateCountSize = catchAsync(async (req, res) => {
  const countSize = await countSizeService.updateCountSizeById(req.params.countSizeId, req.body);
  res.send(countSize);
});

export const deleteCountSize = catchAsync(async (req, res) => {
  await countSizeService.deleteCountSizeById(req.params.countSizeId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const bulkImportCountSizes = catchAsync(async (req, res) => {
  const { countSizes, batchSize = 50 } = req.body;
  
  if (!countSizes || !Array.isArray(countSizes) || countSizes.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Count sizes array is required and must not be empty');
  }

  const results = await countSizeService.bulkImportCountSizes(countSizes, batchSize);
  
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

