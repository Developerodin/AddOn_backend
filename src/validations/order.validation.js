import Joi from 'joi';
import { objectId } from './custom.validation.js';

const customerAddressSchema = Joi.object({
  street: Joi.string().allow(''),
  city: Joi.string().allow(''),
  state: Joi.string().allow(''),
  country: Joi.string().allow(''),
  zipCode: Joi.string().allow(''),
  addressLine1: Joi.string().allow(''),
  addressLine2: Joi.string().allow(''),
});

const customerSchema = Joi.object({
  name: Joi.string().required(),
  phone: Joi.string().allow(''),
  email: Joi.string().email().allow(''),
  address: customerAddressSchema.optional(),
});

const orderItemSchema = Joi.object({
  sku: Joi.string().required(),
  name: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required(),
  price: Joi.number().min(0).required(),
});

const paymentSchema = Joi.object({
  method: Joi.string().allow(''),
  status: Joi.string().valid('pending', 'completed', 'failed', 'refunded'),
  amount: Joi.number().min(0).required(),
});

const logisticsSchema = Joi.object({
  status: Joi.string().valid('pending', 'picked', 'packed', 'shipped', 'delivered', 'cancelled'),
  trackingId: Joi.string().allow(''),
  warehouse: Joi.string().allow(''),
  picker: Joi.string().allow(''),
});

const createOrder = {
  body: Joi.object().keys({
    source: Joi.string().valid('Website', 'Amazon', 'Flipkart', 'Blinkit').required(),
    externalOrderId: Joi.string().required(),
    customer: customerSchema.required(),
    items: Joi.array().items(orderItemSchema).min(1).required(),
    payment: paymentSchema.required(),
    logistics: logisticsSchema.optional(),
    orderStatus: Joi.string().valid('pending', 'processing', 'completed', 'cancelled', 'refunded'),
    timestamps: Joi.object({
      createdAt: Joi.date(),
      updatedAt: Joi.date(),
    }).optional(),
    meta: Joi.object().optional(),
  }),
};

const getOrders = {
  query: Joi.object().keys({
    source: Joi.string().valid('Website', 'Amazon', 'Flipkart', 'Blinkit'),
    orderStatus: Joi.string().valid('pending', 'processing', 'completed', 'cancelled', 'refunded'),
    'customer.email': Joi.string().email(),
    'logistics.trackingId': Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId),
  }),
};

const getOrderBySourceAndExternalId = {
  params: Joi.object().keys({
    source: Joi.string().valid('Website', 'Amazon', 'Flipkart', 'Blinkit').required(),
    externalOrderId: Joi.string().required(),
  }),
};

const updateOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      customer: customerSchema.optional(),
      items: Joi.array().items(orderItemSchema).optional(),
      payment: paymentSchema.optional(),
      logistics: logisticsSchema.optional(),
      orderStatus: Joi.string().valid('pending', 'processing', 'completed', 'cancelled', 'refunded').optional(),
      meta: Joi.object().optional(),
    })
    .min(1),
};

const updateOrderStatus = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    orderStatus: Joi.string().valid('pending', 'processing', 'completed', 'cancelled', 'refunded').required(),
  }),
};

const updateWebsiteOrderStatus = {
  params: Joi.object().keys({
    externalOrderId: Joi.string().required(),
  }),
};

const updateLogisticsStatus = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    status: Joi.string().valid('pending', 'picked', 'packed', 'shipped', 'delivered', 'cancelled').optional(),
    trackingId: Joi.string().allow('').optional(),
    warehouse: Joi.string().allow('').optional(),
    picker: Joi.string().allow('').optional(),
  }).min(1),
};

const deleteOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId),
  }),
};

const syncOrders = {
  body: Joi.object().keys({
    startDate: Joi.date().optional(),
    endDate: Joi.date().optional(),
    limit: Joi.number().integer().min(1).max(1000).optional(),
    sources: Joi.array().items(Joi.string().valid('Website', 'Amazon', 'Flipkart', 'Blinkit')).optional(),
  }),
};

const getOrderStatistics = {
  query: Joi.object().keys({
    source: Joi.string().valid('Website', 'Amazon', 'Flipkart', 'Blinkit'),
    orderStatus: Joi.string().valid('pending', 'processing', 'completed', 'cancelled', 'refunded'),
  }),
};

export {
  createOrder,
  getOrders,
  getOrder,
  getOrderBySourceAndExternalId,
  updateOrder,
  updateOrderStatus,
  updateWebsiteOrderStatus,
  updateLogisticsStatus,
  deleteOrder,
  syncOrders,
  getOrderStatistics,
};
