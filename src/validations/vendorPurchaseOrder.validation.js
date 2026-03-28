import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { vendorPurchaseOrderStatuses, vendorLotStatuses } from '../models/vendorManagement/vendorPurchaseOrder.model.js';

const poItemSchema = Joi.object().keys({
  productId: Joi.string().custom(objectId).required(),
  productName: Joi.string().trim(),
  quantity: Joi.number().min(0).required(),
  rate: Joi.number().min(0).required(),
  gstRate: Joi.number().min(0),
  estimatedDeliveryDate: Joi.date(),
  type: Joi.string().trim().allow('', null),
  color: Joi.string().trim().allow('', null),
  pattern: Joi.string().trim().allow('', null),
});

const statusLogSchema = Joi.object().keys({
  statusCode: Joi.string()
    .valid(...vendorPurchaseOrderStatuses)
    .required(),
  updatedBy: Joi.object()
    .keys({
      username: Joi.string().required(),
      user: Joi.string().custom(objectId).required(),
    })
    .required(),
  notes: Joi.string().trim().allow('', null),
});

const receivedLotSchema = Joi.object().keys({
  lotNumber: Joi.string().required().trim(),
  numberOfBoxes: Joi.number().min(0),
  totalUnits: Joi.number().min(0),
  poItems: Joi.array().items(
    Joi.object().keys({
      poItem: Joi.string().custom(objectId).required(),
      receivedQuantity: Joi.number().min(0).required(),
    })
  ),
  status: Joi.string().valid(...vendorLotStatuses),
});

const packListFileSchema = Joi.object().keys({
  url: Joi.string().required().trim(),
  key: Joi.string().required().trim(),
  originalName: Joi.string().required().trim(),
  mimeType: Joi.string().required().trim(),
  size: Joi.number().min(0).required(),
});

const packListSchema = Joi.object().keys({
  poItems: Joi.array().items(Joi.string().custom(objectId)),
  packingNumber: Joi.string().trim().allow('', null),
  courierName: Joi.string().trim().allow('', null),
  courierNumber: Joi.string().trim().allow('', null),
  vehicleNumber: Joi.string().trim().allow('', null),
  challanNumber: Joi.string().trim().allow('', null),
  dispatchDate: Joi.date(),
  estimatedDeliveryDate: Joi.date(),
  notes: Joi.string().trim().allow('', null),
  numberOfBoxes: Joi.number().min(0),
  totalUnits: Joi.number().min(0),
  files: Joi.array().items(packListFileSchema).default([]),
});

const createBody = Joi.object().keys({
  vendor: Joi.string().custom(objectId).required(),
  /** Denormalized display name; optional — server fills from VendorManagement if omitted */
  vendorName: Joi.string().trim(),
  poItems: Joi.array().items(poItemSchema).min(1).required(),
  notes: Joi.string().trim().allow('', null),
  subTotal: Joi.number().min(0).required(),
  gst: Joi.number().min(0).required(),
  total: Joi.number().min(0).required(),
  goodsReceivedDate: Joi.date(),
  creditDays: Joi.number().min(0),
  estimatedOrderDeliveryDate: Joi.date(),
  currentStatus: Joi.string().valid(...vendorPurchaseOrderStatuses),
  statusLogs: Joi.array().items(statusLogSchema),
  receivedLotDetails: Joi.array().items(receivedLotSchema),
  packListDetails: Joi.array().items(packListSchema),
  year: Joi.number().integer().min(2000).max(2100),
});

export const createVendorPurchaseOrder = {
  body: createBody,
};

export const bulkCreateVendorPurchaseOrders = {
  body: Joi.object().keys({
    year: Joi.number().integer().min(2000).max(2100),
    orders: Joi.array().items(createBody).min(1).required(),
  }),
};

export const getVendorPurchaseOrders = {
  query: Joi.object().keys({
    vendor: Joi.string().custom(objectId),
    vendorName: Joi.string(),
    vpoNumber: Joi.string(),
    currentStatus: Joi.string().valid(...vendorPurchaseOrderStatuses),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    populate: Joi.string().trim(),
  }),
};

export const getVendorPurchaseOrderById = {
  params: Joi.object().keys({
    vendorPurchaseOrderId: Joi.string().custom(objectId).required(),
  }),
};

export const getVendorPurchaseOrderByVpoNumber = {
  params: Joi.object().keys({
    vpoNumber: Joi.string().required().trim(),
  }),
};

export const updateVendorPurchaseOrder = {
  params: Joi.object().keys({
    vendorPurchaseOrderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      vendor: Joi.string().custom(objectId),
      vendorName: Joi.string().trim(),
      poItems: Joi.array().items(poItemSchema).min(1),
      notes: Joi.string().trim().allow('', null),
      subTotal: Joi.number().min(0),
      gst: Joi.number().min(0),
      total: Joi.number().min(0),
      goodsReceivedDate: Joi.date(),
      creditDays: Joi.number().min(0),
      estimatedOrderDeliveryDate: Joi.date(),
      currentStatus: Joi.string().valid(...vendorPurchaseOrderStatuses),
      statusLogs: Joi.array().items(statusLogSchema),
      receivedLotDetails: Joi.array().items(receivedLotSchema),
      packListDetails: Joi.array().items(packListSchema),
      vpoNumber: Joi.string().trim(),
    })
    .min(1),
};

export const deleteVendorPurchaseOrder = {
  params: Joi.object().keys({
    vendorPurchaseOrderId: Joi.string().custom(objectId).required(),
  }),
};
