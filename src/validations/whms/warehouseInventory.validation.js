import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const mixedObject = Joi.object().unknown(true);

/** Single create row — reused by POST / and POST /bulk-import */
export const createWarehouseInventoryBodySchema = Joi.object()
  .keys({
    /** Explicit path: master ids + display style code */
    itemId: Joi.string().custom(objectId),
    styleCodeId: Joi.string().custom(objectId),
    styleCode: Joi.string().trim().min(1),
    /** Resolve path: article no. = Product.factoryCode; styleCode looked up in Style Code master */
    factoryCode: Joi.string().trim().min(1),
    articleNumber: Joi.string().trim().min(1),
    itemData: mixedObject,
    styleCodeData: mixedObject,
    totalQuantity: Joi.number().min(0).default(0),
    blockedQuantity: Joi.number().min(0).default(0),
  })
  .custom((value, helpers) => {
    const style = String(value.styleCode || '').trim();
    const hasExplicit = Boolean(value.itemId && value.styleCodeId && style);
    const article = String(value.factoryCode || value.articleNumber || '').trim();
    const hasArticleResolve = Boolean(article && style);
    /** styleCode + quantities only — product resolved via Product.styleCodes */
    const hasStyleOnly = Boolean(style && !article && !value.itemId && !value.styleCodeId);

    if (hasExplicit && article) {
      return helpers.error('any.custom', {
        message:
          'Do not mix article fields (factoryCode/articleNumber) with itemId/styleCodeId; use one resolution path',
      });
    }
    if (hasExplicit || hasArticleResolve || hasStyleOnly) {
      return value;
    }
    return helpers.error('any.custom', {
      message:
        'Provide (itemId, styleCodeId, and styleCode), (factoryCode or articleNumber and styleCode), or (styleCode only with that style on exactly one product)',
    });
  });

export const createWarehouseInventory = {
  body: createWarehouseInventoryBodySchema,
};

export const bulkImportWarehouseInventory = {
  body: Joi.object().keys({
    items: Joi.array().items(createWarehouseInventoryBodySchema).min(1).max(10000).required(),
  }),
};

/**
 * POST /warehouse-inventory — single row **or** `{ items: [...] }` bulk (same as /bulk-import).
 */
export const createOrBulkWarehouseInventory = {
  body: Joi.alternatives()
    .try(
      Joi.object({
        items: Joi.array().items(createWarehouseInventoryBodySchema).min(1).max(10000).required(),
      }).unknown(false),
      createWarehouseInventoryBodySchema
    )
    .messages({
      'alternatives.match':
        'Body must be either a single inventory row (styleCode, quantities, etc.) or bulk import with an "items" array',
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

export const getWarehouseInventoryLogs = {
  params: Joi.object().keys({
    inventoryId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};
