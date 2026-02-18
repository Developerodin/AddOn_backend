import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as yarnReceivingValidation from '../../../validations/yarnReceiving.validation.js';
import * as yarnReceivingController from '../../../controllers/yarnManagement/yarnReceiving.controller.js';

const router = express.Router();

/** Normal flow: process from existing PO (pack list/lots already on PO or sent in body; replaces, does not append). */
router
  .route('/process-from-po/:purchaseOrderId')
  .post(
    auth(),
    validate(yarnReceivingValidation.processFromExistingPo),
    yarnReceivingController.processFromExistingPo
  );

/** Normal flow: multi-PO with append behaviour (e.g. step-by-step or legacy). Prefer /process-excel for Excel upload. */
router
  .route('/process')
  .post(
    auth(),
    validate(yarnReceivingValidation.processReceiving),
    yarnReceivingController.processReceiving
  );

/** Excel process only: replaces pack list and received lots per PO (no duplicate on resubmit). */
router
  .route('/process-excel')
  .post(
    auth(),
    validate(yarnReceivingValidation.processExcelReceiving),
    yarnReceivingController.processExcel
  );

router
  .route('/process-step-by-step')
  .post(
    auth(),
    validate(yarnReceivingValidation.processReceivingStepByStep),
    yarnReceivingController.processReceivingStepByStep
  );

router
  .route('/step/:stepNumber')
  .post(
    auth(),
    validate(yarnReceivingValidation.processReceivingStep),
    yarnReceivingController.processReceivingStep
  );

export default router;
