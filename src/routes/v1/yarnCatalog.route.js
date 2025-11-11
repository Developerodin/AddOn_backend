import express from 'express';
import validate from '../../middlewares/validate.js';
import { bulkImportMiddleware, validateBulkImportSize } from '../../middlewares/bulkImport.js';
import * as yarnCatalogValidation from '../../validations/yarnCatalog.validation.js';
import * as yarnCatalogController from '../../controllers/yarnManagement/yarnCatalog.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(yarnCatalogValidation.createYarnCatalog), yarnCatalogController.createYarnCatalog)
  .get(validate(yarnCatalogValidation.getYarnCatalogs), yarnCatalogController.getYarnCatalogs);

router
  .route('/bulk-import')
  .post(
    bulkImportMiddleware,
    validateBulkImportSize,
    validate(yarnCatalogValidation.bulkImportYarnCatalogs),
    yarnCatalogController.bulkImportYarnCatalogs
  );

router
  .route('/:yarnCatalogId')
  .get(validate(yarnCatalogValidation.getYarnCatalog), yarnCatalogController.getYarnCatalog)
  .patch(validate(yarnCatalogValidation.updateYarnCatalog), yarnCatalogController.updateYarnCatalog)
  .delete(validate(yarnCatalogValidation.deleteYarnCatalog), yarnCatalogController.deleteYarnCatalog);

export default router;

