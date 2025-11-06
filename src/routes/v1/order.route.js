import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as orderValidation from '../../validations/order.validation.js';
import * as orderController from '../../controllers/order.controller.js';

const router = express.Router();

// Sync routes
router
  .route('/sync')
  .post(auth('manageOrders'), validate(orderValidation.syncOrders), orderController.syncOrdersFromAllSources);

router
  .route('/sync/:source')
  .post(auth('manageOrders'), validate(orderValidation.syncOrders), orderController.syncOrdersFromSource);

// Statistics
router
  .route('/stats')
  .get(auth('getOrders'), validate(orderValidation.getOrderStatistics), orderController.getOrderStatistics);

// CRUD routes
router
  .route('/')
  .post(auth('manageOrders'), validate(orderValidation.createOrder), orderController.createOrder)
  .get(auth('getOrders'), validate(orderValidation.getOrders), orderController.getOrders);

router
  .route('/source/:source/:externalOrderId')
  .get(auth('getOrders'), validate(orderValidation.getOrderBySourceAndExternalId), orderController.getOrderBySourceAndExternalId);

router
  .route('/:orderId')
  .get(auth('getOrders'), validate(orderValidation.getOrder), orderController.getOrder)
  .patch(auth('manageOrders'), validate(orderValidation.updateOrder), orderController.updateOrder)
  .delete(auth('manageOrders'), validate(orderValidation.deleteOrder), orderController.deleteOrder);

router
  .route('/:orderId/status')
  .patch(auth('manageOrders'), validate(orderValidation.updateOrderStatus), orderController.updateOrderStatus);

router
  .route('/:orderId/logistics')
  .patch(auth('manageOrders'), validate(orderValidation.updateLogisticsStatus), orderController.updateLogistics);

export default router;
