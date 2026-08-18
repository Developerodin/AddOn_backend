import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { yarnVendorShipmentStatuses } from '../models/yarnReq/yarnVendorShipment.model.js';

export const previewBox = {
  body: Joi.object()
    .keys({
      barcode: Joi.string().trim().required(),
    })
    .required(),
};

export const sendBoxes = {
  body: Joi.object()
    .keys({
      barcodes: Joi.array().items(Joi.string().trim()).min(1).required(),
      supplierId: Joi.string().custom(objectId).required(),
      sendingNote: Joi.string().trim().allow('').max(2000).optional(),
    })
    .required(),
};

export const receiveBoxes = {
  body: Joi.object()
    .keys({
      barcodes: Joi.array().items(Joi.string().trim()).min(1).required(),
      toStorageLocation: Joi.string().trim().required(),
      receivingNote: Joi.string().trim().allow('').max(2000).optional(),
    })
    .required(),
};

export const voidShipment = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

export const getShipment = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

export const listShipments = {
  query: Joi.object().keys({
    status: Joi.string()
      .valid(...yarnVendorShipmentStatuses)
      .optional(),
    supplierId: Joi.string().custom(objectId).optional(),
    sortBy: Joi.string().optional(),
    limit: Joi.number().integer().min(1).max(200).optional().options({ convert: true }),
    page: Joi.number().integer().min(1).optional().options({ convert: true }),
  }),
};

export const listAtVendor = {
  query: Joi.object().keys({
    supplierId: Joi.string().custom(objectId).optional(),
  }),
};
