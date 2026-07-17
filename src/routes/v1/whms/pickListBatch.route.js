import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as pickListBatchValidation from '../../../validations/whms/pickListBatch.validation.js';
import * as pickListBatchController from '../../../controllers/whms/pickListBatch.controller.js';

const router = express.Router();

router
  .route('/')
  .post(
    auth('manageOrders'),
    validate(pickListBatchValidation.createBatch),
    pickListBatchController.createBatch
  )
  .get(
    auth('getOrders'),
    validate(pickListBatchValidation.getBatches),
    pickListBatchController.getBatches
  );

router
  .route('/order/:orderId')
  .get(
    auth('getOrders'),
    validate(pickListBatchValidation.getBatchForOrder),
    pickListBatchController.getBatchForOrder
  );

router
  .route('/:batchId/send-to-scanning')
  .post(
    auth('manageOrders'),
    validate(pickListBatchValidation.sendBatchToScanning),
    pickListBatchController.sendBatchToScanning
  );

router
  .route('/:batchId/barcodes')
  .get(
    auth('getOrders'),
    validate(pickListBatchValidation.getBatchBarcodes),
    pickListBatchController.getBatchBarcodes
  )
  .post(
    auth('manageOrders'),
    validate(pickListBatchValidation.logBarcodePrint),
    pickListBatchController.logBarcodePrint
  );

router
  .route('/:batchId/picker')
  .patch(
    auth('manageOrders'),
    validate(pickListBatchValidation.setBatchPicker),
    pickListBatchController.setBatchPicker
  );

router
  .route('/:batchId/picks')
  .patch(
    auth('manageOrders'),
    validate(pickListBatchValidation.saveBatchPicks),
    pickListBatchController.saveBatchPicks
  );

router
  .route('/:batchId/items/:itemKey')
  .patch(
    auth('manageOrders'),
    validate(pickListBatchValidation.updateBatchItem),
    pickListBatchController.updateBatchItem
  );

router
  .route('/:batchId')
  .get(
    auth('getOrders'),
    validate(pickListBatchValidation.getBatch),
    pickListBatchController.getBatch
  )
  .delete(
    auth('manageOrders'),
    validate(pickListBatchValidation.cancelBatch),
    pickListBatchController.cancelBatch
  );

export default router;
