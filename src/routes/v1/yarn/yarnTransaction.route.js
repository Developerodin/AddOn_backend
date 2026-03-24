import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnTransactionValidation from '../../../validations/yarnTransaction.validation.js';
import * as yarnTransactionController from '../../../controllers/yarnManagement/yarnTransaction.controller.js';

const router = express.Router();

router
  .route('/')
  .get(
    validate(yarnTransactionValidation.getYarnTransactions),
    yarnTransactionController.getYarnTransactions
  )
  .post(
    validate(yarnTransactionValidation.createYarnTransaction),
    yarnTransactionController.createYarnTransaction
  );

router
  .route('/yarn-issued-by-order/:orderno')
  .get(
    validate(yarnTransactionValidation.getYarnIssuedByOrder),
    yarnTransactionController.getYarnIssuedByOrder
  );

router
  .route('/yarn-issued')
  .get(
    validate(yarnTransactionValidation.getAllYarnIssued),
    yarnTransactionController.getAllYarnIssued
  );

router
  .route('/:transactionId')
  .get(
    validate(yarnTransactionValidation.getYarnTransactionById),
    yarnTransactionController.getYarnTransactionById
  );

export default router;


