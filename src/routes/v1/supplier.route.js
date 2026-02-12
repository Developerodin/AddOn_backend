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
  .route('/sync-yarn-catalog')
  .patch(supplierController.syncAllSuppliersYarnCatalog);

router
  .route('/bulk-import')
  .post(
    bulkImportMiddleware,
    validateBulkImportSize,
    validate(supplierValidation.bulkImportSuppliers),
    supplierController.bulkImportSuppliers
  );

router
  .route('/:supplierId/yarn-tearweight')
  .get(validate(supplierValidation.getSupplierYarnTearweight), supplierController.getSupplierYarnTearweight);

router
  .route('/:supplierId/sync-yarn-catalog')
  .patch(validate(supplierValidation.syncSupplierYarnCatalog), supplierController.syncSupplierYarnCatalog);

router
  .route('/:supplierId')
  .get(validate(supplierValidation.getSupplier), supplierController.getSupplier)
  .patch(validate(supplierValidation.updateSupplier), supplierController.updateSupplier)
  .delete(validate(supplierValidation.deleteSupplier), supplierController.deleteSupplier);

export default router;

