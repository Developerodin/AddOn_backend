import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnInventoryService from '../../services/yarnManagement/yarnInventory.service.js';

/**
 * Get all yarn inventories with optional filters
 * Supports filtering by yarn_id, yarn_name, inventory_status, overbooked
 * Returns LTS/STS breakdown with blocked weight included in net weight
 */
export const getYarnInventories = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['yarn_id', 'yarn_name', 'inventory_status', 'overbooked']);
  const options = pick(req.query, ['sortBy', 'page', 'limit']);
  if (!options.limit || options.limit <= 0) {
    options.limit = 100;
  }
  const result = await yarnInventoryService.queryYarnInventories(filter, options);
  res.status(httpStatus.OK).send(result);
});

/**
 * Global yarn stock totals (same live aggregation as inventories list; no pagination).
 * GET /yarn-management/yarn-inventories/summary
 */
export const getYarnInventoriesSummary = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['yarn_id', 'yarn_name', 'inventory_status', 'overbooked']);
  const summary = await yarnInventoryService.getYarnInventoriesSummary(filter);
  res.status(httpStatus.OK).send(summary);
});

/**
 * Create/initialize a new yarn inventory record
 * Automatically calculates total inventory from long-term and short-term buckets
 */
export const createYarnInventory = catchAsync(async (req, res) => {
  const inventory = await yarnInventoryService.createYarnInventory(req.body);
  res.status(httpStatus.CREATED).send(inventory);
});

/**
 * Get a single yarn inventory by inventory ID
 */
export const getYarnInventory = catchAsync(async (req, res) => {
  const inventory = await yarnInventoryService.getYarnInventoryById(req.params.inventoryId);
  res.status(httpStatus.OK).send(inventory);
});

/**
 * Get yarn inventory by yarn catalog ID
 */
export const getYarnInventoryByYarnId = catchAsync(async (req, res) => {
  const inventory = await yarnInventoryService.getYarnInventoryByYarnId(req.params.yarnId);
  res.status(httpStatus.OK).send(inventory);
});

