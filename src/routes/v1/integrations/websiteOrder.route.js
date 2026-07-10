import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import apiKeyAuth from '../../../middlewares/apiKeyAuth.js';
import * as websiteOrderValidation from '../../../validations/integrations/websiteOrder.validation.js';
import * as websiteOrderController from '../../../controllers/integrations/websiteOrder.controller.js';

const router = express.Router();

router
  .route('/ingest')
  .post(apiKeyAuth, validate(websiteOrderValidation.ingestWebsiteOrder), websiteOrderController.ingest);

router
  .route('/cancel')
  .post(apiKeyAuth, validate(websiteOrderValidation.cancelWebsiteOrder), websiteOrderController.cancel);

router
  .route('/sync-log')
  .get(auth('manageOrders'), validate(websiteOrderValidation.getSyncLog), websiteOrderController.syncLog);

router
  .route('/:warehouseOrderId/push')
  .post(auth('manageOrders'), validate(websiteOrderValidation.pushWebsiteOrder), websiteOrderController.push);

export default router;
