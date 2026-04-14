import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as inwardReceiveValidation from '../../../validations/whms/inwardReceive.validation.js';
import * as inwardReceiveController from '../../../controllers/whms/inwardReceive.controller.js';

const router = express.Router();

router
  .route('/promote-vendor-dispatch')
  .post(
    auth('manageOrders'),
    validate(inwardReceiveValidation.promoteVendorDispatchToInwardReceive),
    inwardReceiveController.promoteVendorDispatchToInwardReceive
  );

router
  .route('/')
  .post(
    auth('manageOrders'),
    validate(inwardReceiveValidation.createInwardReceive),
    inwardReceiveController.createInwardReceive
  )
  .get(
    auth('getOrders'),
    validate(inwardReceiveValidation.getInwardReceives),
    inwardReceiveController.getInwardReceives
  );

router
  .route('/:id')
  .get(
    auth('getOrders'),
    validate(inwardReceiveValidation.getInwardReceive),
    inwardReceiveController.getInwardReceive
  )
  .patch(
    auth('manageOrders'),
    validate(inwardReceiveValidation.updateInwardReceive),
    inwardReceiveController.updateInwardReceive
  )
  .delete(
    auth('manageOrders'),
    validate(inwardReceiveValidation.deleteInwardReceive),
    inwardReceiveController.deleteInwardReceive
  );

export default router;
