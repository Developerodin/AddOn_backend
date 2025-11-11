import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnCatalogService from '../../services/yarnManagement/yarnCatalog.service.js';

export const createYarnCatalog = catchAsync(async (req, res) => {
  const yarnCatalog = await yarnCatalogService.createYarnCatalog(req.body);
  res.status(httpStatus.CREATED).send(yarnCatalog);
});

export const getYarnCatalogs = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['yarnName', 'status', 'yarnType', 'countSize', 'blend', 'colorFamily']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await yarnCatalogService.queryYarnCatalogs(filter, options);
  res.send(result);
});

export const getYarnCatalog = catchAsync(async (req, res) => {
  const yarnCatalog = await yarnCatalogService.getYarnCatalogById(req.params.yarnCatalogId);
  if (!yarnCatalog) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn catalog not found');
  }
  res.send(yarnCatalog);
});

export const updateYarnCatalog = catchAsync(async (req, res) => {
  const yarnCatalog = await yarnCatalogService.updateYarnCatalogById(req.params.yarnCatalogId, req.body);
  res.send(yarnCatalog);
});

export const deleteYarnCatalog = catchAsync(async (req, res) => {
  await yarnCatalogService.deleteYarnCatalogById(req.params.yarnCatalogId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const bulkImportYarnCatalogs = catchAsync(async (req, res) => {
  const { yarnCatalogs, batchSize = 50 } = req.body;
  
  if (!yarnCatalogs || !Array.isArray(yarnCatalogs) || yarnCatalogs.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Yarn catalogs array is required and must not be empty');
  }

  const results = await yarnCatalogService.bulkImportYarnCatalogs(yarnCatalogs, batchSize);
  
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

