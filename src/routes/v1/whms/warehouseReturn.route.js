import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as warehouseReturnValidation from '../../../validations/whms/warehouseReturn.validation.js';
import * as warehouseReturnController from '../../../controllers/whms/warehouseReturn.controller.js';

const router = express.Router();

router
  .route('/')
  .post(
    auth('whmsReturns'),
    validate(warehouseReturnValidation.createReturn),
    warehouseReturnController.createReturn
  )
  .get(
    auth('getOrders'),
    validate(warehouseReturnValidation.getReturns),
    warehouseReturnController.getReturns
  );

router
  .route('/:returnId')
  .get(
    auth('getOrders'),
    validate(warehouseReturnValidation.getReturn),
    warehouseReturnController.getReturn
  );

router
  .route('/:returnId/scan')
  .post(
    auth('whmsReturns'),
    validate(warehouseReturnValidation.scanReturnItem),
    warehouseReturnController.scanReturnItem
  );

router
  .route('/:returnId/items/:itemId')
  .patch(
    auth('whmsReturns'),
    validate(warehouseReturnValidation.updateReturnItem),
    warehouseReturnController.updateReturnItem
  );

router
  .route('/:returnId/difference-report')
  .get(
    auth('getOrders'),
    validate(warehouseReturnValidation.getReturn),
    warehouseReturnController.getDifferenceReport
  );

router
  .route('/:returnId/submit')
  .post(
    auth('whmsReturns'),
    validate(warehouseReturnValidation.submitReturn),
    warehouseReturnController.submitReturn
  );

router
  .route('/:returnId/approve')
  .post(
    auth('whmsReturnsApprove'),
    validate(warehouseReturnValidation.approveReturn),
    warehouseReturnController.approveReturn
  );

router
  .route('/:returnId/reject')
  .post(
    auth('whmsReturnsApprove'),
    validate(warehouseReturnValidation.rejectReturn),
    warehouseReturnController.rejectReturn
  );

export default router;
