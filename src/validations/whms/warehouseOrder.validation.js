import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const clientTypes = ['Store', 'Trade', 'Departmental', 'Ecom'];

const orderStatuses = ['draft', 'pending', 'in-progress', 'packed', 'dispatched', 'cancelled'];

const singlePairItem = Joi.object({
  styleCodeId: Joi.string().custom(objectId).required(),
  styleCode: Joi.string().allow('').trim(),
  pack: Joi.string().allow('').trim(),
  colour: Joi.string().allow('').trim(),
  type: Joi.string().allow('').trim(),
  pattern: Joi.string().allow('').trim(),
  quantity: Joi.number().integer().min(1).required(),
});

const multiPairItem = Joi.object({
  styleCodeMultiPairId: Joi.string().custom(objectId).required(),
  styleCode: Joi.string().allow('').trim(),
  pack: Joi.string().allow('').trim(),
  colour: Joi.string().allow('').trim(),
  type: Joi.string().allow('').trim(),
  pattern: Joi.string().allow('').trim(),
  quantity: Joi.number().integer().min(1).required(),
});

export const createWarehouseOrder = {
  body: Joi.object()
    .keys({
      orderNumber: Joi.string().allow('').trim(),
      addonOrderId: Joi.string().allow('').trim(),
      date: Joi.date(),
      clientType: Joi.string().valid(...clientTypes).required(),
      clientId: Joi.string().custom(objectId).required(),

      styleCodeSinglePair: Joi.array().items(singlePairItem).default([]),
      styleCodeMultiPair: Joi.array().items(multiPairItem).default([]),

      status: Joi.string().valid(...orderStatuses),
      meta: Joi.object(),
    })
    .custom((value, helpers) => {
      const singleCount = Array.isArray(value.styleCodeSinglePair) ? value.styleCodeSinglePair.length : 0;
      const multiCount = Array.isArray(value.styleCodeMultiPair) ? value.styleCodeMultiPair.length : 0;
      if (singleCount + multiCount === 0) {
        return helpers.error('any.custom', { message: 'Warehouse order must have at least one item' });
      }
      return value;
    }),
};

export const getWarehouseOrders = {
  query: Joi.object().keys({
    status: Joi.string().valid(...orderStatuses),
    statusIn: Joi.string()
      .trim()
      .custom((value, helpers) => {
        if (!value) return value;
        const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
        const invalid = parts.filter((p) => !orderStatuses.includes(p));
        if (invalid.length) {
          return helpers.error('any.only', { valids: orderStatuses });
        }
        return value;
      }),
    clientType: Joi.string().valid(...clientTypes),
    clientId: Joi.string().custom(objectId),
    orderNumber: Joi.string().trim(),
    addonOrderId: Joi.string().trim(),
    q: Joi.string().trim(),
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    createdFrom: Joi.date(),
    createdTo: Joi.date(),
    styleCodeId: Joi.string().custom(objectId),
    styleCodeMultiPairId: Joi.string().custom(objectId),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getWarehouseOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
};

export const updateWarehouseOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      date: Joi.date(),
      addonOrderId: Joi.string().allow('').trim(),
      styleCodeSinglePair: Joi.array().items(singlePairItem),
      styleCodeMultiPair: Joi.array().items(multiPairItem),
      status: Joi.string().valid(...orderStatuses),
      meta: Joi.object(),
    })
    .min(1),
};

export const deleteWarehouseOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
};

const bulkSinglePairItem = Joi.object({
  styleCode: Joi.string().required().trim(),
  colour: Joi.string().allow('').trim(),
  color: Joi.string().allow('').trim(),
  pattern: Joi.string().allow('').trim(),
  quantity: Joi.number().integer().min(1).required(),
});

const bulkMultiPairItem = Joi.object({
  styleCode: Joi.string().required().trim(),
  type: Joi.string().allow('').trim(),
  colour: Joi.string().allow('').trim(),
  color: Joi.string().allow('').trim(),
  pattern: Joi.string().allow('').trim(),
  quantity: Joi.number().integer().min(1).required(),
});

export const bulkImportWarehouseOrders = {
  body: Joi.object().keys({
    orders: Joi.array()
      .items(
        Joi.object({
          clientType: Joi.string().valid(...clientTypes).required(),
          clientName: Joi.string().required().trim(),
          addonOrderId: Joi.string().allow('').trim(),
          date: Joi.alternatives().try(Joi.date(), Joi.string().trim()).allow('', null),
          status: Joi.string().valid(...orderStatuses).default('pending'),
          styleCodeSinglePair: Joi.array().items(bulkSinglePairItem).default([]),
          styleCodeMultiPair: Joi.array().items(bulkMultiPairItem).default([]),
        }).custom((value, helpers) => {
          const singleCount = Array.isArray(value.styleCodeSinglePair) ? value.styleCodeSinglePair.length : 0;
          const multiCount = Array.isArray(value.styleCodeMultiPair) ? value.styleCodeMultiPair.length : 0;
          if (singleCount + multiCount === 0) {
            return helpers.error('any.custom', { message: 'Each order must have at least one style-code item' });
          }
          return value;
        })
      )
      .min(1)
      .required(),
  }),
};

