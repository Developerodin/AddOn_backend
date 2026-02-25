import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as inwardValidation from '../../../validations/whms/inward.validation.js';
import * as inwardController from '../../../controllers/whms/inward.controller.js';

const router = express.Router();

router
  .route('/')
  .post(
    auth('manageOrders'),
    validate(inwardValidation.createInward),
    inwardController.createInward
  )
  .get(
    auth('getOrders'),
    validate(inwardValidation.getInwardList),
    inwardController.getInwardList
  );

router
  .route('/:id')
  .get(
    auth('getOrders'),
    validate(inwardValidation.getInward),
    inwardController.getInward
  )
  .patch(
    auth('manageOrders'),
    validate(inwardValidation.updateInward),
    inwardController.updateInward
  );

export default router;
