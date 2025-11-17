import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnInventoryValidation from '../../../validations/yarnInventory.validation.js';
import * as yarnInventoryController from '../../../controllers/yarnManagement/yarnInventory.controller.js';

const router = express.Router();

/**
 * GET /v1/yarn-management/yarn-inventories
 * Get all yarn inventories with optional filters
 * Query params: yarn_id, yarn_name, inventory_status, overbooked, sortBy, limit, page
 * Returns: yarn_name, yarn_id, Total Weight (LTS/STS), Net Weight (LTS/STS + blocked), 
 *          Number of cones (LTS/STS), inventoryStatus, overbooked
 */
router
  .route('/')
  .get(
    validate(yarnInventoryValidation.getYarnInventories),
    yarnInventoryController.getYarnInventories
  )
  .post(
    validate(yarnInventoryValidation.createYarnInventory),
    yarnInventoryController.createYarnInventory
  );

/**
 * GET /v1/yarn-management/yarn-inventories/:inventoryId
 * Get a single yarn inventory by inventory ID
 */
router
  .route('/:inventoryId')
  .get(yarnInventoryController.getYarnInventory);

/**
 * GET /v1/yarn-management/yarn-inventories/yarn/:yarnId
 * Get yarn inventory by yarn catalog ID
 */
router
  .route('/yarn/:yarnId')
  .get(yarnInventoryController.getYarnInventoryByYarnId);

export default router;

