import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as vendorPurchaseOrderValidation from '../../validations/vendorPurchaseOrder.validation.js';
import * as vendorPurchaseOrderController from '../../controllers/vendorManagement/vendorPurchaseOrder.controller.js';

const router = express.Router();

router
  .route('/bulk')
  .post(
    auth(),
    validate(vendorPurchaseOrderValidation.bulkCreateVendorPurchaseOrders),
    vendorPurchaseOrderController.bulkCreateVendorPurchaseOrders
  );

router
  .route('/by-number/:vpoNumber')
  .get(
    auth(),
    validate(vendorPurchaseOrderValidation.getVendorPurchaseOrderByVpoNumber),
    vendorPurchaseOrderController.getVendorPurchaseOrderByVpoNumber
  );

router
  .route('/')
  .get(auth(), validate(vendorPurchaseOrderValidation.getVendorPurchaseOrders), vendorPurchaseOrderController.getVendorPurchaseOrders)
  .post(auth(), validate(vendorPurchaseOrderValidation.createVendorPurchaseOrder), vendorPurchaseOrderController.createVendorPurchaseOrder);

router
  .route('/:vendorPurchaseOrderId')
  .get(auth(), validate(vendorPurchaseOrderValidation.getVendorPurchaseOrderById), vendorPurchaseOrderController.getVendorPurchaseOrder)
  .patch(auth(), validate(vendorPurchaseOrderValidation.updateVendorPurchaseOrder), vendorPurchaseOrderController.updateVendorPurchaseOrder)
  .delete(auth(), validate(vendorPurchaseOrderValidation.deleteVendorPurchaseOrder), vendorPurchaseOrderController.deleteVendorPurchaseOrder);

export default router;
