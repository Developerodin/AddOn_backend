import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const mixedObject = Joi.object().unknown(true);

export const createWarehouseInventory = {
  body: Joi.object().keys({
    itemId: Joi.string().custom(objectId).required(),
    styleCodeId: Joi.string().custom(objectId).required(),
    styleCode: Joi.string().trim().min(1).required(),
    itemData: mixedObject,
    styleCodeData: mixedObject,
    totalQuantity: Joi.number().min(0).default(0),
    blockedQuantity: Joi.number().min(0).default(0),
  }),
};

export const getWarehouseInventories = {
  query: Joi.object().keys({
    itemId: Joi.string().custom(objectId),
    styleCodeId: Joi.string().custom(objectId),
    /** Partial case-insensitive match on stored styleCode */
    styleCode: Joi.string().trim(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getWarehouseInventoryByStyleCode = {
  query: Joi.object()
    .keys({
      styleCode: Joi.string().trim().min(1).required(),
    })
    .required(),
};

export const getWarehouseInventory = {
  params: Joi.object().keys({
    inventoryId: Joi.string().custom(objectId).required(),
  }),
};

export const updateWarehouseInventory = {
  params: Joi.object().keys({
    inventoryId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      itemData: mixedObject,
      styleCodeData: mixedObject,
      totalQuantity: Joi.number().min(0),
      blockedQuantity: Joi.number().min(0),
      adjustReason: Joi.string().trim().allow('').max(500),
    })
    .or('itemData', 'styleCodeData', 'totalQuantity', 'blockedQuantity'),
};

export const deleteWarehouseInventory = {
  params: Joi.object().keys({
    inventoryId: Joi.string().custom(objectId).required(),
  }),
};
