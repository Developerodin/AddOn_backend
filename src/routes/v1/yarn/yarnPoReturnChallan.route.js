import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnPoReturnChallanValidation from '../../../validations/yarnPoReturnChallan.validation.js';
import * as yarnPoReturnChallanController from '../../../controllers/yarnManagement/yarnPoReturnChallan.controller.js';

const router = express.Router();

router
  .route('/')
  .get(validate(yarnPoReturnChallanValidation.listChallans), yarnPoReturnChallanController.listChallans);

router
  .route('/by-number/:challanNumber')
  .get(validate(yarnPoReturnChallanValidation.getChallanByNumber), yarnPoReturnChallanController.getChallanByNumber);

router
  .route('/by-po/:purchaseOrderId')
  .get(validate(yarnPoReturnChallanValidation.getChallansByPo), yarnPoReturnChallanController.getChallansByPo);

router
  .route('/:challanId/transport')
  .patch(
    validate(yarnPoReturnChallanValidation.patchChallanTransport),
    yarnPoReturnChallanController.patchChallanTransport
  );

router
  .route('/:challanId')
  .get(validate(yarnPoReturnChallanValidation.getChallan), yarnPoReturnChallanController.getChallan);

export default router;
