import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import { bulkImportMiddleware } from '../../../middlewares/bulkImport.js';
import * as warehouseOrderValidation from '../../../validations/whms/warehouseOrder.validation.js';
import * as warehouseOrderController from '../../../controllers/whms/warehouseOrder.controller.js';
import * as orderFlowValidation from '../../../validations/whms/orderFlow.validation.js';
import * as orderFlowController from '../../../controllers/whms/orderFlow.controller.js';
import * as pickListController from '../../../controllers/whms/pickList.controller.js';
import * as dispatchValidation from '../../../validations/whms/dispatch.validation.js';
import * as dispatchController from '../../../controllers/whms/dispatch.controller.js';

const router = express.Router();

// Flow-status transitions are permission-checked per target stage inside the
// service (roles.js whms* rights), so the route only requires authentication + read access.
router
  .route('/:orderId/flow-status')
  .patch(
    auth('getOrders'),
    validate(orderFlowValidation.transitionFlowStatus),
    orderFlowController.transitionFlowStatus
  );

router
  .route('/:orderId/flow-history')
  .get(
    auth('getOrders'),
    validate(orderFlowValidation.getFlowHistory),
    orderFlowController.getFlowHistory
  );

// Barcode label payload for the Barcode Team (labels = picked quantities).
router
  .route('/:orderId/barcodes')
  .get(
    auth('getOrders'),
    validate(orderFlowValidation.getFlowHistory),
    pickListController.getOrderBarcodeLabels
  );

// Dispatch preparation and shipment updates.
router
  .route('/:orderId/dispatch-details')
  .patch(
    auth('whmsDispatch'),
    validate(dispatchValidation.setDispatchDetails),
    dispatchController.setDispatchDetails
  );

router
  .route('/:orderId/dispatch')
  .post(
    auth('whmsDispatch'),
    validate(dispatchValidation.dispatchOrder),
    dispatchController.dispatchOrder
  );

router
  .route('/:orderId/delivery-status')
  .patch(
    auth('whmsDispatch'),
    validate(dispatchValidation.setDeliveryStatus),
    dispatchController.setDeliveryStatus
  );

router
  .route('/:orderId/shipping-label')
  .get(
    auth('getOrders'),
    validate(dispatchValidation.printPayload),
    dispatchController.getShippingLabel
  );

router
  .route('/:orderId/packing-list')
  .get(
    auth('getOrders'),
    validate(dispatchValidation.printPayload),
    dispatchController.getPackingList
  );

router
  .route('/')
  .post(
    auth('manageOrders'),
    validate(warehouseOrderValidation.createWarehouseOrder),
    warehouseOrderController.createWarehouseOrder
  )
  .get(
    auth('getOrders'),
    validate(warehouseOrderValidation.getWarehouseOrders),
    warehouseOrderController.getWarehouseOrders
  );

router
  .route('/bulk-import')
  .post(
    auth('manageOrders'),
    bulkImportMiddleware,
    validate(warehouseOrderValidation.bulkImportWarehouseOrders),
    warehouseOrderController.bulkImportWarehouseOrders
  );

router
  .route('/catalogue-attrs')
  .get(
    auth('getOrders'),
    validate(warehouseOrderValidation.getCatalogueAttrs),
    warehouseOrderController.getCatalogueAttrs
  );

router
  .route('/:orderId')
  .get(
    auth('getOrders'),
    validate(warehouseOrderValidation.getWarehouseOrder),
    warehouseOrderController.getWarehouseOrder
  )
  .patch(
    auth('manageOrders'),
    validate(warehouseOrderValidation.updateWarehouseOrder),
    warehouseOrderController.updateWarehouseOrder
  )
  .delete(
    auth('manageOrders'),
    validate(warehouseOrderValidation.deleteWarehouseOrder),
    warehouseOrderController.deleteWarehouseOrder
  );

export default router;

