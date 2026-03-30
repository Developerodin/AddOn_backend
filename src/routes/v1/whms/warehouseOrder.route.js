import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as warehouseOrderValidation from '../../../validations/whms/warehouseOrder.validation.js';
import * as warehouseOrderController from '../../../controllers/whms/warehouseOrder.controller.js';

const router = express.Router();

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

