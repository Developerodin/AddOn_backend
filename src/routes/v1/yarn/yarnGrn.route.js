import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnGrnValidation from '../../../validations/yarnGrn.validation.js';
import * as yarnGrnController from '../../../controllers/yarnManagement/yarnGrn.controller.js';

const router = express.Router();

router
  .route('/')
  .get(validate(yarnGrnValidation.listGrns), yarnGrnController.listGrns);

router
  .route('/by-number/:grnNumber')
  .get(validate(yarnGrnValidation.getGrnByNumber), yarnGrnController.getGrnByNumber);

router
  .route('/by-po/:purchaseOrderId')
  .get(validate(yarnGrnValidation.getGrnsByPo), yarnGrnController.getGrnsByPo);

router
  .route('/by-po/:purchaseOrderId/ensure')
  .post(validate(yarnGrnValidation.ensureGrnForPo), yarnGrnController.ensureGrnForPo);

router
  .route('/by-lot/:lotNumber')
  .get(validate(yarnGrnValidation.getGrnsByLot), yarnGrnController.getGrnsByLot);

router
  .route('/:grnId/revisions')
  .get(validate(yarnGrnValidation.getGrnRevisions), yarnGrnController.getGrnRevisions);

router
  .route('/:grnId/header')
  .patch(validate(yarnGrnValidation.updateGrnHeader), yarnGrnController.updateGrnHeader);

router
  .route('/:grnId')
  .get(validate(yarnGrnValidation.getGrn), yarnGrnController.getGrn);

export default router;
