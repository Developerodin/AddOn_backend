import express from 'express';
import validate from '../../middlewares/validate.js';
import { bulkImportMiddleware, validateBulkImportSize } from '../../middlewares/bulkImport.js';
import * as storeValidation from '../../validations/store.validation.js';
import * as storeController from '../../controllers/store.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(storeValidation.createStore), storeController.createStore)
  .get(validate(storeValidation.getStores), storeController.getStores);

router
  .route('/debug')
  .get(storeController.debugQuery);

router
  .route('/bulk-import')
  .post(
    bulkImportMiddleware,
    validateBulkImportSize,
    validate(storeValidation.bulkImportStores), 
    storeController.bulkImportStores
  );

router
  .route('/:storeId')
  .get(validate(storeValidation.getStore), storeController.getStore)
  .patch(validate(storeValidation.updateStore), storeController.updateStore)
  .delete(validate(storeValidation.deleteStore), storeController.deleteStore);

export default router; 