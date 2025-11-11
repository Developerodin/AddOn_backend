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

export const updateSupplier = catchAsync(async (req, res) => {
  const supplier = await supplierService.updateSupplierById(req.params.supplierId, req.body);
  res.send(supplier);
});

export const deleteSupplier = catchAsync(async (req, res) => {
  await supplierService.deleteSupplierById(req.params.supplierId);
  res.status(httpStatus.NO_CONTENT).send();
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
      errors: results.errors
    }
  };

  const statusCode = results.failed === 0 ? httpStatus.OK : 
                    results.failed === results.total ? httpStatus.BAD_REQUEST : 
                    httpStatus.PARTIAL_CONTENT;

  res.status(statusCode).send(response);
});

