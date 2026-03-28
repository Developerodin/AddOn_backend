import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const statusValues = ['pending', 'accepted', 'rejected', 'onhold'];

const baseBody = {
  articleId: Joi.string().custom(objectId).required(),
  orderId: Joi.string().custom(objectId).required(),
  articleNumber: Joi.string().required().trim(),
  QuantityFromFactory: Joi.number().min(0).required(),
  receivedQuantity: Joi.number().min(0).default(0),
  styleCode: Joi.string().allow('').trim(),
  brand: Joi.string().allow('').trim(),
  status: Joi.string().valid(...statusValues),
  orderData: Joi.object().unknown(true),
  receivedAt: Joi.date(),
  receivedInContainerId: Joi.string().custom(objectId),
  warehouseReceivedLineId: Joi.string().custom(objectId),
};

export const createInwardReceive = {
  body: Joi.object().keys(baseBody),
};

export const getInwardReceives = {
  query: Joi.object().keys({
    status: Joi.string().valid(...statusValues),
    articleId: Joi.string().custom(objectId),
    orderId: Joi.string().custom(objectId),
    articleNumber: Joi.string().trim(),
    styleCode: Joi.string().trim(),
    brand: Joi.string().trim(),
    /** Filter by createdAt (default) or receivedAt */
    dateField: Joi.string().valid('createdAt', 'receivedAt'),
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    receivedAtFrom: Joi.date(),
    receivedAtTo: Joi.date(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getInwardReceive = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

/** WHMS PATCH — typical: receivedQuantity + status from UI. */
export const updateInwardReceive = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      receivedQuantity: Joi.number().min(0),
      status: Joi.string().valid(...statusValues),
      styleCode: Joi.string().allow('').trim(),
      brand: Joi.string().allow('').trim(),
      QuantityFromFactory: Joi.number().min(0),
      orderData: Joi.object().unknown(true),
      receivedAt: Joi.date(),
    })
    .min(1),
};

export const deleteInwardReceive = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};
