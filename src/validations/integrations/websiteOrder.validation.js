import Joi from 'joi';

const customerSchema = Joi.object({
  opencartCustomerId: Joi.number().integer().min(0).required(),
  companyName: Joi.string().allow('').trim(),
  retailerName: Joi.string().allow('').trim(),
  contactPerson: Joi.string().allow('').trim(),
  email: Joi.alternatives().try(Joi.string().valid(''), Joi.string().email().trim()),
  telephone: Joi.string().allow('').trim(),
  mobilePhone: Joi.string().allow('').trim(),
  address1: Joi.string().allow('').trim(),
  address: Joi.string().allow('').trim(),
  city: Joi.string().allow('').trim(),
  postcode: Joi.string().allow('').trim(),
  zipCode: Joi.string().allow('').trim(),
  zone: Joi.string().allow('').trim(),
  state: Joi.string().allow('').trim(),
  country: Joi.string().allow('').trim(),
  gstin: Joi.string().allow('').trim(),
  shippingAddress1: Joi.string().allow('').trim(),
  shippingCity: Joi.string().allow('').trim(),
  shippingPostcode: Joi.string().allow('').trim(),
  shippingZone: Joi.string().allow('').trim(),
  shippingCountry: Joi.string().allow('').trim(),
});

const productOptionSchema = Joi.object({
  name: Joi.string().allow('').trim(),
  value: Joi.string().allow('').trim(),
});

const productSchema = Joi.object({
  model: Joi.string().required().trim(),
  name: Joi.string().allow('').trim(),
  quantity: Joi.number().integer().min(1).required(),
  price: Joi.number().min(0),
  total: Joi.number().min(0),
  options: Joi.array().items(productOptionSchema).default([]),
});

export const ingestWebsiteOrder = {
  body: Joi.object({
    addonOrderId: Joi.string().required().trim(),
    opencartOrderId: Joi.number().integer().min(1).required(),
    orderDate: Joi.date().iso(),
    paymentMethod: Joi.string().allow('').trim(),
    shippingMethod: Joi.string().allow('').trim(),
    approvedBy: Joi.string().allow('').trim(),
    customer: customerSchema.required(),
    products: Joi.array().items(productSchema).min(1).required(),
    totals: Joi.object({
      subTotal: Joi.number().min(0),
      shipping: Joi.number().min(0),
      tax: Joi.number().min(0),
      grandTotal: Joi.number().min(0),
      currency: Joi.string().allow('').trim(),
    }),
  }),
};

export const cancelWebsiteOrder = {
  body: Joi.object({
    addonOrderId: Joi.string().required().trim(),
    reason: Joi.string().allow('').trim(),
  }),
};

export const pushWebsiteOrder = {
  params: Joi.object({
    warehouseOrderId: Joi.string().hex().length(24).required(),
  }),
};

export const getSyncLog = {
  query: Joi.object({
    addonOrderId: Joi.string().trim(),
    direction: Joi.string().valid('inbound', 'outbound'),
    status: Joi.string().trim(),
    sortBy: Joi.string(),
    limit: Joi.number().integer().min(1).max(100),
    page: Joi.number().integer().min(1),
  }),
};
