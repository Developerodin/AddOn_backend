import express from 'express';
import validate from '../../middlewares/validate.js';
import { bulkImportMiddleware, validateBulkImportSize } from '../../middlewares/bulkImport.js';
import * as sealsExcelMasterValidation from '../../validations/sealsExcelMaster.validation.js';
import * as sealsExcelMasterController from '../../controllers/sealsExcelMaster.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(sealsExcelMasterValidation.createSealsExcelMaster), sealsExcelMasterController.createSealsExcelMaster)
  .get(validate(sealsExcelMasterValidation.getSealsExcelMasters), sealsExcelMasterController.getSealsExcelMasters);

router
  .route('/debug')
  .get(sealsExcelMasterController.debugQuery);

router
  .route('/recent')
  .get(validate(sealsExcelMasterValidation.getRecentUploads), sealsExcelMasterController.getRecentUploads);

router
  .route('/user/:userId?')
  .get(validate(sealsExcelMasterValidation.getSealsExcelMastersByUser), sealsExcelMasterController.getSealsExcelMastersByUser);

router
  .route('/bulk-import')
  .post(
    bulkImportMiddleware,
    validateBulkImportSize,
    validate(sealsExcelMasterValidation.bulkImportSealsExcelMasters), 
    sealsExcelMasterController.bulkImportSealsExcelMasters
  );

router
  .route('/:sealsExcelId')
  .get(validate(sealsExcelMasterValidation.getSealsExcelMaster), sealsExcelMasterController.getSealsExcelMaster)
  .patch(validate(sealsExcelMasterValidation.updateSealsExcelMaster), sealsExcelMasterController.updateSealsExcelMaster)
  .delete(validate(sealsExcelMasterValidation.deleteSealsExcelMaster), sealsExcelMasterController.deleteSealsExcelMaster);

router
  .route('/:sealsExcelId/status')
  .patch(validate(sealsExcelMasterValidation.updateProcessingStatus), sealsExcelMasterController.updateProcessingStatus);

export default router; 