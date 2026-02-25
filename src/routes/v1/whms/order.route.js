import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as whmsOrderValidation from '../../../validations/whms/order.validation.js';
import * as whmsOrderController from '../../../controllers/whms/order.controller.js';

const router = express.Router();

router
  .route('/')
  .post(
    auth('manageOrders'),
    validate(whmsOrderValidation.createOrder),
    whmsOrderController.createOrder
  )
  .get(
    auth('getOrders'),
    validate(whmsOrderValidation.getOrders),
    whmsOrderController.getOrders
  );

router
  .route('/:orderId')
  .get(
    auth('getOrders'),
    validate(whmsOrderValidation.getOrder),
    whmsOrderController.getOrder
  )
  .patch(
    auth('manageOrders'),
    validate(whmsOrderValidation.updateOrder),
    whmsOrderController.updateOrder
  )
  .delete(
    auth('manageOrders'),
    validate(whmsOrderValidation.deleteOrder),
    whmsOrderController.deleteOrder
  );

router
  .route('/:orderId/tracking')
  .post(
    auth('manageOrders'),
    validate(whmsOrderValidation.saveTracking),
    whmsOrderController.saveTracking
  );

export default router;
