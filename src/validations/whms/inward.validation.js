import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const inwardItem = Joi.object({
  sku: Joi.string().required(),
  name: Joi.string().allow(''),
  productId: Joi.string().custom(objectId),
  orderedQty: Joi.number().min(0).required(),
  receivedQty: Joi.number().min(0),
  acceptedQty: Joi.number().min(0),
  rejectedQty: Joi.number().min(0),
  unit: Joi.string().allow(''),
});

export const createInward = {
  body: Joi.object().keys({
    grnNumber: Joi.string().allow(''),
    reference: Joi.string().allow(''),
    date: Joi.date(),
    supplier: Joi.string().allow(''),
    status: Joi.string().valid('pending', 'partial', 'received', 'qc-pending', 'completed'),
    items: Joi.array().items(inwardItem).min(1).required(),
    totalItems: Joi.number().min(0),
    notes: Joi.string().allow(''),
  }),
};

export const getInwardList = {
  query: Joi.object().keys({
    status: Joi.string().valid('pending', 'partial', 'received', 'qc-pending', 'completed'),
    supplier: Joi.string(),
    reference: Joi.string(),
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getInward = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

export const updateInward = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      reference: Joi.string(),
      date: Joi.date(),
      supplier: Joi.string(),
      status: Joi.string().valid('pending', 'partial', 'received', 'qc-pending', 'completed'),
      items: Joi.array().items(inwardItem),
      notes: Joi.string(),
    })
    .min(1),
};
