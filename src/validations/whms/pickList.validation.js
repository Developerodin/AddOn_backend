import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const pickListStatuses = ['pending', 'partial', 'picked'];

export const getPickLists = {
  query: Joi.object().keys({
    orderId: Joi.string().custom(objectId),
    orderNumber: Joi.string().trim(),
    skuCode: Joi.string().trim(),
    styleCode: Joi.string().trim(),
    status: Joi.string().valid(...pickListStatuses),
    q: Joi.string().trim(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getPickList = {
  params: Joi.object().keys({
    pickListId: Joi.string().custom(objectId).required(),
  }),
};

export const getPickListsByOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
};

export const updatePickList = {
  params: Joi.object().keys({
    pickListId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      size: Joi.string().allow('').trim(),
      steCodeNew: Joi.string().allow('').trim(),
      shade: Joi.string().allow('').trim(),
      nih: Joi.string().allow('').trim(),
      asst: Joi.string().allow('').trim(),
      sapStock: Joi.number().min(0),
      pickupQuantity: Joi.number().min(0),
    })
    .min(1),
};

export const deletePickList = {
  params: Joi.object().keys({
    pickListId: Joi.string().custom(objectId).required(),
  }),
};

export const deletePickListsByOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
};
