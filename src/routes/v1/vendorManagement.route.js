import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as vendorManagementValidation from '../../validations/vendorManagement.validation.js';
import * as vendorManagementController from '../../controllers/vendorManagement/vendorManagement.controller.js';
import vendorManagementPoRoute from './vendorManagementPo.route.js';
import vendorManagementBoxRoute from './vendorManagementBox.route.js';
import vendorGrnRoute from './vendorGrn.route.js';
import vendorPoVendorReturnRoute from './vendorPoVendorReturn.route.js';
import vendorPoReturnChallanRoute from './vendorPoReturnChallan.route.js';

const router = express.Router();

router.use('/purchase-orders', vendorManagementPoRoute);
router.use('/boxes', vendorManagementBoxRoute);
router.use('/vendor-grns', vendorGrnRoute);
router.use('/vendor-returns', vendorPoVendorReturnRoute);
router.use('/vendor-po-return-challans', vendorPoReturnChallanRoute);

router
  .route('/')
  .post(auth(), validate(vendorManagementValidation.createVendorManagement), vendorManagementController.createVendorManagement)
  .get(auth(), validate(vendorManagementValidation.getVendorManagements), vendorManagementController.getVendorManagements);

router
  .route('/bulk')
  .post(
    auth(),
    validate(vendorManagementValidation.bulkCreateVendorManagements),
    vendorManagementController.bulkCreateVendorManagements
  );

router
  .route('/production-flow')
  .get(
    auth(),
    validate(vendorManagementValidation.getVendorProductionFlows),
    vendorManagementController.getVendorProductionFlows
  );

router
  .route('/production-flow/:vendorProductionFlowId')
  .get(auth(), validate(vendorManagementValidation.getVendorProductionFlow), vendorManagementController.getVendorProductionFlow);

router.route('/production-flow/:vendorProductionFlowId/floors/:floorKey').patch(
  auth(),
  validate(vendorManagementValidation.updateVendorProductionFlowFloor),
  vendorManagementController.updateVendorProductionFlowFloor
);

router.route('/production-flow/:vendorProductionFlowId/transfer').patch(
  auth(),
  validate(vendorManagementValidation.transferVendorProductionFlow),
  vendorManagementController.transferVendorProductionFlow
);

router.route('/production-flow/:vendorProductionFlowId/confirm').post(
  auth(),
  validate(vendorManagementValidation.confirmVendorProductionFlow),
  vendorManagementController.confirmVendorProductionFlow
);

router.route('/production-flow/:vendorProductionFlowId/final-checking/m2-transfer').patch(
  auth(),
  validate(vendorManagementValidation.transferFinalCheckingM2ForRework),
  vendorManagementController.transferFinalCheckingM2ForRework
);

router
  .route('/:vendorManagementId/products')
  .post(auth(), validate(vendorManagementValidation.addVendorProducts), vendorManagementController.addVendorProducts)
  .delete(auth(), validate(vendorManagementValidation.removeVendorProducts), vendorManagementController.removeVendorProducts);

router
  .route('/:vendorManagementId')
  .get(auth(), validate(vendorManagementValidation.getVendorManagement), vendorManagementController.getVendorManagement)
  .patch(auth(), validate(vendorManagementValidation.updateVendorManagement), vendorManagementController.updateVendorManagement)
  .delete(auth(), validate(vendorManagementValidation.deleteVendorManagement), vendorManagementController.deleteVendorManagement);

export default router;
