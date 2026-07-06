import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as scanningValidation from '../../../validations/whms/scanning.validation.js';
import * as scanningController from '../../../controllers/whms/scanning.controller.js';

const router = express.Router();

router
  .route('/sessions')
  .post(
    auth('whmsScanning'),
    validate(scanningValidation.createSession),
    scanningController.createSession
  )
  .get(
    auth('getOrders'),
    validate(scanningValidation.getSessions),
    scanningController.getSessions
  );

router
  .route('/sessions/:sessionId')
  .get(
    auth('getOrders'),
    validate(scanningValidation.getSession),
    scanningController.getSession
  );

router
  .route('/sessions/:sessionId/scan')
  .post(
    auth('whmsScanning'),
    validate(scanningValidation.scanBarcode),
    scanningController.scanBarcode
  );

router
  .route('/sessions/:sessionId/items/:itemId')
  .patch(
    auth('whmsScanning'),
    validate(scanningValidation.updateScanItem),
    scanningController.updateScanItem
  );

router
  .route('/sessions/:sessionId/complete')
  .post(
    auth('whmsScanning'),
    validate(scanningValidation.completeSession),
    scanningController.completeSession
  );

router
  .route('/sessions/:sessionId/cancel')
  .post(
    auth('whmsScanning'),
    validate(scanningValidation.cancelSession),
    scanningController.cancelSession
  );

export default router;
