import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as approvalsValidation from '../../../validations/whms/approvals.validation.js';
import * as approvalsController from '../../../controllers/whms/approvals.controller.js';

const router = express.Router();

router
  .route('/variance')
  .get(
    auth('getOrders'),
    validate(approvalsValidation.getVarianceApprovals),
    approvalsController.getVarianceApprovals
  )
  .post(
    auth('manageOrders'),
    validate(approvalsValidation.createVarianceApproval),
    approvalsController.createVarianceApproval
  );

router
  .route('/variance/:id')
  .patch(
    auth('manageOrders'),
    validate(approvalsValidation.updateVarianceApproval),
    approvalsController.updateVarianceApproval
  );

router
  .route('/dispatch')
  .get(
    auth('getOrders'),
    validate(approvalsValidation.getDispatchApprovals),
    approvalsController.getDispatchApprovals
  )
  .post(
    auth('manageOrders'),
    validate(approvalsValidation.createDispatchApproval),
    approvalsController.createDispatchApproval
  );

router
  .route('/dispatch/:id')
  .patch(
    auth('manageOrders'),
    validate(approvalsValidation.updateDispatchApproval),
    approvalsController.updateDispatchApproval
  );

export default router;
