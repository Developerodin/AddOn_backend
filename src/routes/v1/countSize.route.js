import express from 'express';
import validate from '../../middlewares/validate.js';
import { bulkImportMiddleware, validateBulkImportSize } from '../../middlewares/bulkImport.js';
import * as countSizeValidation from '../../validations/countSize.validation.js';
import * as countSizeController from '../../controllers/yarnManagement/countSize.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(countSizeValidation.createCountSize), countSizeController.createCountSize)
  .get(validate(countSizeValidation.getCountSizes), countSizeController.getCountSizes);

router
  .route('/bulk-import')
  .post(
    bulkImportMiddleware,
    validateBulkImportSize,
    validate(countSizeValidation.bulkImportCountSizes),
    countSizeController.bulkImportCountSizes
  );

router
  .route('/:countSizeId')
  .get(validate(countSizeValidation.getCountSize), countSizeController.getCountSize)
  .patch(validate(countSizeValidation.updateCountSize), countSizeController.updateCountSize)
  .delete(validate(countSizeValidation.deleteCountSize), countSizeController.deleteCountSize);

export default router;

