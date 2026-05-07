import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnReportValidation from '../../../validations/yarnReport.validation.js';
import * as yarnReportController from '../../../controllers/yarnManagement/yarnReport.controller.js';

const router = express.Router();

router
  .route('/snapshot-bounds')
  .get(
    validate(yarnReportValidation.getYarnReportSnapshotBounds),
    yarnReportController.getYarnReportSnapshotBounds
  );

router
  .route('/po-analytics/lines')
  .get(validate(yarnReportValidation.getPoAnalyticsLines), yarnReportController.getPoAnalyticsLines);

router
  .route('/po-analytics')
  .get(validate(yarnReportValidation.getPoAnalytics), yarnReportController.getPoAnalytics);

router
  .route('/yarn-closing-trend')
  .get(validate(yarnReportValidation.getYarnClosingTrend), yarnReportController.getYarnClosingTrend);

router
  .route('/transaction-analytics')
  .get(
    validate(yarnReportValidation.getYarnTransactionAnalytics),
    yarnReportController.getYarnTransactionAnalytics
  );

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
