import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnTypeService from '../../services/yarnManagement/yarnType.service.js';

export const createYarnType = catchAsync(async (req, res) => {
  const yarnType = await yarnTypeService.createYarnType(req.body);
  res.status(httpStatus.CREATED).send(yarnType);
});

export const getYarnTypes = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await yarnTypeService.queryYarnTypes(filter, options);
  res.send(result);
});

export const getYarnType = catchAsync(async (req, res) => {
  const yarnType = await yarnTypeService.getYarnTypeById(req.params.yarnTypeId);
  if (!yarnType) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn type not found');
  }
  res.send(yarnType);
});

export const updateYarnType = catchAsync(async (req, res) => {
  const yarnType = await yarnTypeService.updateYarnTypeById(req.params.yarnTypeId, req.body);
  res.send(yarnType);
});

export const deleteYarnType = catchAsync(async (req, res) => {
  await yarnTypeService.deleteYarnTypeById(req.params.yarnTypeId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const bulkImportYarnTypes = catchAsync(async (req, res) => {
  const { yarnTypes, batchSize = 50 } = req.body;
  
  if (!yarnTypes || !Array.isArray(yarnTypes) || yarnTypes.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Yarn types array is required and must not be empty');
  }

  const results = await yarnTypeService.bulkImportYarnTypes(yarnTypes, batchSize);
  
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

