import express from 'express';
import validate from '../../middlewares/validate.js';
import { bulkImportMiddleware, validateBulkImportSize } from '../../middlewares/bulkImport.js';
import * as supplierValidation from '../../validations/supplier.validation.js';
import * as supplierController from '../../controllers/yarnManagement/supplier.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(supplierValidation.createSupplier), supplierController.createSupplier)
  .get(validate(supplierValidation.getSuppliers), supplierController.getSuppliers);

router
  .route('/bulk-import')
  .post(
    bulkImportMiddleware,
    validateBulkImportSize,
    validate(supplierValidation.bulkImportSuppliers),
    supplierController.bulkImportSuppliers
  );

router
  .route('/:supplierId')
  .get(validate(supplierValidation.getSupplier), supplierController.getSupplier)
  .patch(validate(supplierValidation.updateSupplier), supplierController.updateSupplier)
  .delete(validate(supplierValidation.deleteSupplier), supplierController.deleteSupplier);

export default router;

