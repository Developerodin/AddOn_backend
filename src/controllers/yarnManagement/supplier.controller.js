import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as supplierService from '../../services/yarnManagement/supplier.service.js';

export const createSupplier = catchAsync(async (req, res) => {
  const supplier = await supplierService.createSupplier(req.body);
  res.status(httpStatus.CREATED).send(supplier);
});

export const getSuppliers = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['brandName', 'email', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await supplierService.querySuppliers(filter, options);
  res.send(result);
});

export const getSupplier = catchAsync(async (req, res) => {
  const supplier = await supplierService.getSupplierById(req.params.supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');
  }
  res.send(supplier);
});

/**
 * GET tearweight for given yarn name(s) for a supplier.
 * Query: yarnName (single string or repeated: yarnName=a&yarnName=b)
 */
export const getSupplierYarnTearweight = catchAsync(async (req, res) => {
  const yarnNameParam = req.query.yarnName;
  const yarnNames = Array.isArray(yarnNameParam) ? yarnNameParam : yarnNameParam ? [yarnNameParam] : [];
  const result = await supplierService.getSupplierYarnTearweight(req.params.supplierId, yarnNames);
  res.send(result);
});

export const updateSupplier = catchAsync(async (req, res) => {
  const supplier = await supplierService.updateSupplierById(req.params.supplierId, req.body);
  res.send(supplier);
});

export const deleteSupplier = catchAsync(async (req, res) => {
  await supplierService.deleteSupplierById(req.params.supplierId);
  res.status(httpStatus.NO_CONTENT).send();
});

/**
 * Sync all suppliers' yarnDetails with YarnCatalog (same as script: link yarnCatalogId, update name/type/subtype from catalog).
 */
export const syncAllSuppliersYarnCatalog = catchAsync(async (req, res) => {
  const result = await supplierService.syncAllSuppliersYarnDetailsWithCatalog();
  res.status(httpStatus.OK).send({
    message: 'All supplier yarn details synced with catalog',
    summary: {
      suppliersUpdated: result.suppliersUpdated,
      detailsLinked: result.detailsLinked,
      detailsSynced: result.detailsSynced,
      noMatch: result.noMatch,
      catalogNotFound: result.catalogNotFound,
    },
  });
});

/**
 * Sync one supplier's yarnDetails with YarnCatalog by supplierId.
 */
export const syncSupplierYarnCatalog = catchAsync(async (req, res) => {
  const result = await supplierService.syncSupplierYarnDetailsWithCatalog(req.params.supplierId);
  res.status(httpStatus.OK).send({
    message: 'Supplier yarn details synced with catalog',
    supplier: result.supplier,
    summary: {
      detailsLinked: result.detailsLinked,
      detailsSynced: result.detailsSynced,
      noMatch: result.noMatch,
      catalogNotFound: result.catalogNotFound,
    },
  });
});

export const bulkImportSuppliers = catchAsync(async (req, res) => {
  const { suppliers, batchSize = 50 } = req.body;
  
  if (!suppliers || !Array.isArray(suppliers) || suppliers.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Suppliers array is required and must not be empty');
  }

  const results = await supplierService.bulkImportSuppliers(suppliers, batchSize);
  
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
      errors: results.errors,
      skippedYarnNames: results.skippedYarnNames || []
    }
  };

  const statusCode = results.failed === 0 ? httpStatus.OK : 
                    results.failed === results.total ? httpStatus.BAD_REQUEST : 
                    httpStatus.PARTIAL_CONTENT;

  res.status(statusCode).send(response);
});

