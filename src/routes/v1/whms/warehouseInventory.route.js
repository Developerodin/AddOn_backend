import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import { bulkImportMiddleware } from '../../../middlewares/bulkImport.js';
import * as warehouseInventoryValidation from '../../../validations/whms/warehouseInventory.validation.js';
import * as warehouseInventoryController from '../../../controllers/whms/warehouseInventory.controller.js';

const router = express.Router();

router
  .route('/')
  .post(
    auth('manageOrders'),
    validate(warehouseInventoryValidation.createOrBulkWarehouseInventory),
    warehouseInventoryController.createOrBulkWarehouseInventory
  )
  .get(
    auth('getOrders'),
    validate(warehouseInventoryValidation.getWarehouseInventories),
    warehouseInventoryController.getWarehouseInventories
  );

/** Must be before /:inventoryId so "by-style-code" is not captured as an id */
router.get(
  '/by-style-code',
  auth('getOrders'),
  validate(warehouseInventoryValidation.getWarehouseInventoryByStyleCode),
  warehouseInventoryController.getWarehouseInventoryByStyleCode
);

router.post(
  '/bulk-import',
  auth('manageOrders'),
  bulkImportMiddleware,
  validate(warehouseInventoryValidation.bulkImportWarehouseInventory),
  warehouseInventoryController.bulkImportWarehouseInventory
);

router.get(
  '/:inventoryId/logs',
  auth('getOrders'),
  validate(warehouseInventoryValidation.getWarehouseInventoryLogs),
  warehouseInventoryController.getWarehouseInventoryLogs
);

router
  .route('/:inventoryId')
  .get(
    auth('getOrders'),
    validate(warehouseInventoryValidation.getWarehouseInventory),
    warehouseInventoryController.getWarehouseInventory
  )
  .patch(
    auth('manageOrders'),
    validate(warehouseInventoryValidation.updateWarehouseInventory),
    warehouseInventoryController.updateWarehouseInventory
  )
  .delete(
    auth('manageOrders'),
    validate(warehouseInventoryValidation.deleteWarehouseInventory),
    warehouseInventoryController.deleteWarehouseInventory
  );

export default router;
