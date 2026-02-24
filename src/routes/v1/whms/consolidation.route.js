import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as consolidationValidation from '../../../validations/whms/consolidation.validation.js';
import * as consolidationController from '../../../controllers/whms/consolidation.controller.js';

const router = express.Router();

router
  .route('/')
  .post(
    auth('manageOrders'),
    validate(consolidationValidation.createBatch),
    consolidationController.createBatch
  )
  .get(
    auth('getOrders'),
    validate(consolidationValidation.getBatches),
    consolidationController.getBatches
  );

router
  .route('/:id')
  .get(
    auth('getOrders'),
    validate(consolidationValidation.getBatch),
    consolidationController.getBatch
  )
  .patch(
    auth('manageOrders'),
    validate(consolidationValidation.updateBatch),
    consolidationController.updateBatch
  );

router
  .route('/:id/status')
  .patch(
    auth('manageOrders'),
    validate(consolidationValidation.setBatchStatus),
    consolidationController.setBatchStatus
  );

export default router;
