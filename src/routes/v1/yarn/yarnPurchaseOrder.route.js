import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnPurchaseOrderValidation from '../../../validations/yarnPurchaseOrder.validation.js';
import * as yarnPurchaseOrderController from '../../../controllers/yarnManagement/yarnPurchaseOrder.controller.js';

const router = express.Router();

router
  .route('/')
  .get(
    validate(yarnPurchaseOrderValidation.getPurchaseOrders),
    yarnPurchaseOrderController.getPurchaseOrders
  )
  .post(
    validate(yarnPurchaseOrderValidation.createPurchaseOrder),
    yarnPurchaseOrderController.createPurchaseOrder
  );

router
  .route('/tearweight')
  .get(
    validate(yarnPurchaseOrderValidation.getSupplierTearweightByPoAndYarnName),
    yarnPurchaseOrderController.getSupplierTearweightByPoAndYarnName
  );

router
  .route('/lot-status')
  .patch(
    validate(yarnPurchaseOrderValidation.updateLotStatus),
    yarnPurchaseOrderController.updateLotStatus
  );

router
  .route('/lot-status-qc-approve')
  .patch(
    validate(yarnPurchaseOrderValidation.updateLotStatusAndQcApprove),
    yarnPurchaseOrderController.updateLotStatusAndQcApprove
  );

router
  .route('/by-number/:poNumber')
  .get(
    validate(yarnPurchaseOrderValidation.getPurchaseOrderByPoNumber),
    yarnPurchaseOrderController.getPurchaseOrderByPoNumber
  );


router
  .route('/lot')
  .delete(
    validate(yarnPurchaseOrderValidation.deleteLot),
    yarnPurchaseOrderController.deleteLot
  );

router
  .route('/:purchaseOrderId')
  .get(
    validate(yarnPurchaseOrderValidation.getPurchaseOrderById),
    yarnPurchaseOrderController.getPurchaseOrder
  )
  .patch(
    validate(yarnPurchaseOrderValidation.updatePurchaseOrder),
    yarnPurchaseOrderController.updatePurchaseOrder
  )
  .delete(
    validate(yarnPurchaseOrderValidation.deletePurchaseOrder),
    yarnPurchaseOrderController.deletePurchaseOrder
  );

router
  .route('/:purchaseOrderId/status')
  .patch(
    validate(yarnPurchaseOrderValidation.updatePurchaseOrderStatus),
    yarnPurchaseOrderController.updatePurchaseOrderStatus
  );

router
  .route('/:purchaseOrderId/qc-approve-all')
  .patch(
    validate(yarnPurchaseOrderValidation.qcApproveAllLots),
    yarnPurchaseOrderController.qcApproveAllLots
  );

export default router;


