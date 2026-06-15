import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as vendorGrnValidation from '../../validations/vendorGrn.validation.js';
import * as vendorGrnController from '../../controllers/vendorManagement/vendorGrn.controller.js';

const router = express.Router();

router.route('/').get(auth(), validate(vendorGrnValidation.listVendorGrns), vendorGrnController.listGrns);

router
  .route('/by-number/:grnNumber')
  .get(auth(), validate(vendorGrnValidation.getVendorGrnByNumber), vendorGrnController.getGrnByNumber);

router
  .route('/by-po/:vpoId')
  .get(auth(), validate(vendorGrnValidation.getVendorGrnsByVpo), vendorGrnController.getGrnsByVpo);

router
  .route('/by-po/:vpoId/ensure')
  .post(auth(), validate(vendorGrnValidation.ensureVendorGrnsForVpo), vendorGrnController.ensureGrnsForVpo);

router
  .route('/by-lot/:lotNumber')
  .get(auth(), validate(vendorGrnValidation.getVendorGrnsByLot), vendorGrnController.getGrnsByLot);

router
  .route('/by-flow/:flowId/issue')
  .post(auth(), validate(vendorGrnValidation.issueVendorGrnFromFlow), vendorGrnController.issueGrnFromFlow);

router
  .route('/by-flow/:flowId/active')
  .get(auth(), validate(vendorGrnValidation.getActiveVendorGrnForFlow), vendorGrnController.getActiveGrnForFlow);

router
  .route('/:grnId/revisions')
  .get(auth(), validate(vendorGrnValidation.getVendorGrnRevisions), vendorGrnController.getGrnRevisions);

router
  .route('/:grnId/header')
  .patch(auth(), validate(vendorGrnValidation.updateVendorGrnHeader), vendorGrnController.updateGrnHeader);

router.route('/:grnId').get(auth(), validate(vendorGrnValidation.getVendorGrn), vendorGrnController.getGrn);

export default router;
