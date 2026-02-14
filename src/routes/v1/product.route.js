import express from 'express';
import validate from '../../middlewares/validate.js';
import { bulkImportMiddleware, validateBulkImportSize } from '../../middlewares/bulkImport.js';
import * as productValidation from '../../validations/product.validation.js';
import * as productController from '../../controllers/product.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(productValidation.createProduct), productController.createProduct)
  .get(validate(productValidation.getProducts), productController.getProducts);

router
  .route('/debug')
  .get(productController.debugQuery);

router
  .route('/bulk-import')
  .post(
    bulkImportMiddleware,
    validateBulkImportSize,
    validate(productValidation.bulkImportProducts),
    productController.bulkImportProducts
  );

router
  .route('/bulk-upsert')
  .post(
    bulkImportMiddleware,
    validateBulkImportSize,
    validate(productValidation.bulkUpsertProducts),
    productController.bulkUpsertProducts
  );

router
  .route('/bulk-export')
  .get(
    validate(productValidation.bulkExportProducts),
    productController.bulkExportProducts
  );

router
  .route('/by-code')
  .get(validate(productValidation.getProductByCode), productController.getProductByCode);

router
  .route('/:productId')
  .get(validate(productValidation.getProduct), productController.getProduct)
  .patch(validate(productValidation.updateProduct), productController.updateProduct)
  .delete(validate(productValidation.deleteProduct), productController.deleteProduct);

export default router; 