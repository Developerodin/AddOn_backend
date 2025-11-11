import express from 'express';
import validate from '../../middlewares/validate.js';
import { bulkImportMiddleware, validateBulkImportSize } from '../../middlewares/bulkImport.js';
import * as yarnTypeValidation from '../../validations/yarnType.validation.js';
import * as yarnTypeController from '../../controllers/yarnManagement/yarnType.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(yarnTypeValidation.createYarnType), yarnTypeController.createYarnType)
  .get(validate(yarnTypeValidation.getYarnTypes), yarnTypeController.getYarnTypes);

router
  .route('/bulk-import')
  .post(
    bulkImportMiddleware,
    validateBulkImportSize,
    validate(yarnTypeValidation.bulkImportYarnTypes),
    yarnTypeController.bulkImportYarnTypes
  );

router
  .route('/:yarnTypeId')
  .get(validate(yarnTypeValidation.getYarnType), yarnTypeController.getYarnType)
  .patch(validate(yarnTypeValidation.updateYarnType), yarnTypeController.updateYarnType)
  .delete(validate(yarnTypeValidation.deleteYarnType), yarnTypeController.deleteYarnType);

export default router;

