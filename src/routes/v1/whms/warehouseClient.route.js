import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import { bulkImportMiddleware } from '../../../middlewares/bulkImport.js';
import * as warehouseClientValidation from '../../../validations/whms/warehouseClient.validation.js';
import * as warehouseClientController from '../../../controllers/whms/warehouseClient.controller.js';

const router = express.Router();

router
  .route('/')
  .post(
    auth('manageOrders'),
    validate(warehouseClientValidation.createWarehouseClient),
    warehouseClientController.createWarehouseClient
  )
  .get(
    auth('getOrders'),
    validate(warehouseClientValidation.getWarehouseClients),
    warehouseClientController.getWarehouseClients
  );

router
  .route('/by-type/:type')
  .get(
    auth('getOrders'),
    validate(warehouseClientValidation.getWarehouseClientsByType),
    warehouseClientController.getWarehouseClientsByType
  );

router.post(
  '/bulk-import',
  auth('manageOrders'),
  bulkImportMiddleware,
  validate(warehouseClientValidation.bulkImportWarehouseClients),
  warehouseClientController.bulkImportWarehouseClients
);

router
  .route('/:clientId')
  .get(
    auth('getOrders'),
    validate(warehouseClientValidation.getWarehouseClient),
    warehouseClientController.getWarehouseClient
  )
  .patch(
    auth('manageOrders'),
    validate(warehouseClientValidation.updateWarehouseClient),
    warehouseClientController.updateWarehouseClient
  )
  .delete(
    auth('manageOrders'),
    validate(warehouseClientValidation.deleteWarehouseClient),
    warehouseClientController.deleteWarehouseClient
  );

export default router;
