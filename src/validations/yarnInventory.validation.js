import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { yarnInventoryStatuses } from '../models/yarnReq/yarnInventory.model.js';

const inventoryBucketSchema = Joi.object().keys({
  totalWeight: Joi.number().min(0).default(0),
  totalTearWeight: Joi.number().min(0).default(0),
  totalNetWeight: Joi.number().min(0).default(0),
  numberOfCones: Joi.number().min(0).default(0),
});

export const getYarnInventories = {
  query: Joi.object().keys({
    yarn_id: Joi.string().custom(objectId).optional(),
    yarn_name: Joi.string().trim().optional(),
    inventory_status: Joi.string().valid(...yarnInventoryStatuses).optional(),
    overbooked: Joi.boolean().optional(),
    sortBy: Joi.string().optional(),
    limit: Joi.number().integer().optional(),
    page: Joi.number().integer().optional(),
  }),
};

export const createYarnInventory = {
  body: Joi.object()
    .keys({
      yarn: Joi.string().custom(objectId).required(),
      yarnName: Joi.string().trim().required(),
      totalInventory: inventoryBucketSchema.optional(),
      longTermInventory: inventoryBucketSchema.optional(),
      shortTermInventory: inventoryBucketSchema.optional(),
      blockedNetWeight: Joi.number().min(0).default(0),
      inventoryStatus: Joi.string().valid(...yarnInventoryStatuses).default('in_stock'),
      overbooked: Joi.boolean().default(false),
    })
    .required(),
};

