import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as vendorManagementValidation from '../../validations/vendorManagement.validation.js';
import * as vendorManagementController from '../../controllers/vendorManagement/vendorManagement.controller.js';
import * as vendorM2M3M4Controller from '../../controllers/vendorManagement/vendorM2M3M4Management.controller.js';
import * as vendorDispatchTransferNoteController from '../../controllers/vendorManagement/vendorDispatchTransferNote.controller.js';
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

router.route('/production-flow/:vendorProductionFlowId/branding-type').patch(
  auth(),
  validate(vendorManagementValidation.updateVendorBrandingType),
  vendorManagementController.updateVendorBrandingType
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

// ==================== VENDOR M2 / M3 / M4 MANAGEMENT ====================

router
  .route('/m2/entries')
  .get(auth(), validate(vendorManagementValidation.getVendorM2Entries), vendorM2M3M4Controller.getM2Entries);

router
  .route('/m2/logs')
  .get(auth(), validate(vendorManagementValidation.getVendorM2Logs), vendorM2M3M4Controller.getM2Logs);

router.route('/m2/statistics').get(auth(), vendorM2M3M4Controller.getM2Statistics);

router
  .route('/m2/entries/:entryId/merge-to-m1')
  .post(auth(), validate(vendorManagementValidation.markVendorM2MergeToM1), vendorM2M3M4Controller.markM2MergeToM1);

router
  .route('/m2/entries/:entryId/transfer-to-m3')
  .post(auth(), validate(vendorManagementValidation.markVendorM2TransferToM3), vendorM2M3M4Controller.markM2TransferToM3);

router
  .route('/m2/entries/:entryId/transfer-to-m4')
  .post(auth(), validate(vendorManagementValidation.markVendorM2TransferToM4), vendorM2M3M4Controller.markM2TransferToM4);

router
  .route('/m3/flows')
  .get(auth(), validate(vendorManagementValidation.getVendorM3Flows), vendorM2M3M4Controller.getM3Flows);

router
  .route('/m3/logs')
  .get(auth(), validate(vendorManagementValidation.getVendorM3Logs), vendorM2M3M4Controller.getM3Logs);

router.route('/m3/statistics').get(auth(), vendorM2M3M4Controller.getM3Statistics);

router
  .route('/m3/flows/:flowId/outward')
  .post(auth(), validate(vendorManagementValidation.markVendorM3Outward), vendorM2M3M4Controller.markM3Outward);

router
  .route('/m4/flows')
  .get(auth(), validate(vendorManagementValidation.getVendorM4Flows), vendorM2M3M4Controller.getM4Flows);

router
  .route('/m4/logs')
  .get(auth(), validate(vendorManagementValidation.getVendorM4Logs), vendorM2M3M4Controller.getM4Logs);

router.route('/m4/statistics').get(auth(), vendorM2M3M4Controller.getM4Statistics);

router
  .route('/m4/flows/:flowId/outward')
  .post(auth(), validate(vendorManagementValidation.markVendorM4Outward), vendorM2M3M4Controller.markM4Outward);

router
  .route('/dispatch/transfer-notes/report')
  .get(
    auth(),
    validate(vendorManagementValidation.getVendorDispatchTransferNoteReport),
    vendorDispatchTransferNoteController.getVendorDispatchTransferNoteReport
  );

router
  .route('/dispatch/transfer-notes/preview')
  .get(
    auth(),
    validate(vendorManagementValidation.previewVendorDispatchTransferNote),
    vendorDispatchTransferNoteController.previewVendorDispatchTransferNote
  );

router
  .route('/dispatch/transfer-notes/:transferNoteId')
  .get(
    auth(),
    validate(vendorManagementValidation.getVendorDispatchTransferNote),
    vendorDispatchTransferNoteController.getVendorDispatchTransferNote
  );

router
  .route('/dispatch/transfer-notes')
  .get(
    auth(),
    validate(vendorManagementValidation.getVendorDispatchTransferNotes),
    vendorDispatchTransferNoteController.getVendorDispatchTransferNotes
  )
  .post(
    auth(),
    validate(vendorManagementValidation.createVendorDispatchTransferNote),
    vendorDispatchTransferNoteController.createVendorDispatchTransferNote
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
