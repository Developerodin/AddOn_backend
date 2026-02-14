import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as yarnReceivingValidation from '../../../validations/yarnReceiving.validation.js';
import * as yarnReceivingController from '../../../controllers/yarnManagement/yarnReceiving.controller.js';

const router = express.Router();

router
  .route('/process-from-po/:purchaseOrderId')
  .post(
    auth(),
    validate(yarnReceivingValidation.processFromExistingPo),
    yarnReceivingController.processFromExistingPo
  );

router
  .route('/process')
  .post(
    auth(),
    validate(yarnReceivingValidation.processReceiving),
    yarnReceivingController.processReceiving
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
