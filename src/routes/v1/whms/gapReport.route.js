import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as gapReportValidation from '../../../validations/whms/gapReport.validation.js';
import * as gapReportController from '../../../controllers/whms/gapReport.controller.js';

const router = express.Router();

router
  .route('/')
  .get(
    auth('getOrders'),
    validate(gapReportValidation.getGapReport),
    gapReportController.getGapReport
  );

router
  .route('/send-requirement')
  .post(
    auth('manageOrders'),
    validate(gapReportValidation.sendRequirement),
    gapReportController.sendRequirement
  );

export default router;
