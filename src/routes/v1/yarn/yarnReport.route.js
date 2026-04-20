import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnReportValidation from '../../../validations/yarnReport.validation.js';
import * as yarnReportController from '../../../controllers/yarnManagement/yarnReport.controller.js';

const router = express.Router();

router
  .route('/')
  .get(validate(yarnReportValidation.getYarnReport), yarnReportController.getYarnReport);

router
  .route('/po-short-term/:poNumber')
  .get(
    validate(yarnReportValidation.getPoShortTermStorageReport),
    yarnReportController.getPoShortTermStorageReport
  );

router
  .route('/po-audit/:poNumber')
  .get(validate(yarnReportValidation.getPoBoxAuditReport), yarnReportController.getPoBoxAuditReport);

export default router;
