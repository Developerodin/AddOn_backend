import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const customerAddress = Joi.object({
  street: Joi.string().allow(''),
  city: Joi.string().allow(''),
  state: Joi.string().allow(''),
  zipCode: Joi.string().allow(''),
  country: Joi.string().allow(''),
  addressLine1: Joi.string().allow(''),
  addressLine2: Joi.string().allow(''),
});

const customer = Joi.object({
  name: Joi.string().required(),
  phone: Joi.string().allow(''),
  email: Joi.string().email().allow(''),
  address: customerAddress.optional(),
});

const orderItem = Joi.object({
  sku: Joi.string().required(),
  name: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required(),
  unitPrice: Joi.number().min(0),
  totalPrice: Joi.number().min(0),
  productId: Joi.string().custom(objectId),
});

const tracking = Joi.object({
  courierName: Joi.string().allow(''),
  trackingNumber: Joi.string().allow(''),
  dispatchDate: Joi.date(),
  vehicleAwb: Joi.string().allow(''),
  remarks: Joi.string().allow(''),
});

export const createOrder = {
  body: Joi.object().keys({
    orderNumber: Joi.string().allow(''),
    channel: Joi.string().valid('online', 'retail', 'wholesale', 'marketplace', 'direct'),
    customer: customer.required(),
    items: Joi.array().items(orderItem).min(1).required(),
    packingInstructions: Joi.object({
      fragile: Joi.boolean(),
      packagingType: Joi.string(),
      specialHandling: Joi.string(),
      notes: Joi.string(),
    }),
    dispatchMode: Joi.string().valid('standard', 'express', 'overnight', 'pickup'),
    totalValue: Joi.number().min(0),
    totalQuantity: Joi.number().min(0),
    priority: Joi.string().valid('low', 'medium', 'high'),
    estimatedDispatchDate: Joi.date(),
  }),
};

export const getOrders = {
  query: Joi.object().keys({
    status: Joi.string().valid('pending', 'in-progress', 'packed', 'dispatched', 'cancelled'),
    channel: Joi.string(),
    orderNumber: Joi.string(),
    stockBlockStatus: Joi.string(),
    lifecycleStatus: Joi.string(),
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
};

export const updateOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      status: Joi.string().valid('pending', 'in-progress', 'packed', 'dispatched', 'cancelled'),
      stockBlockStatus: Joi.string().valid('available', 'tentative-block', 'pick-block'),
      lifecycleStatus: Joi.string(),
      customer: customer,
      items: Joi.array().items(orderItem),
      packingInstructions: Joi.object(),
      dispatchMode: Joi.string(),
      totalValue: Joi.number().min(0),
      totalQuantity: Joi.number().min(0),
      priority: Joi.string().valid('low', 'medium', 'high'),
      estimatedDispatchDate: Joi.date(),
    })
    .min(1),
};

export const saveTracking = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    courierName: Joi.string().allow(''),
    trackingNumber: Joi.string().allow(''),
    dispatchDate: Joi.date(),
    vehicleAwb: Joi.string().allow(''),
    remarks: Joi.string().allow(''),
  }).min(1),
};

export const deleteOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
};
