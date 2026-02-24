import Joi from 'joi';
import { objectId } from '../custom.validation.js';

export const getVarianceApprovals = {
  query: Joi.object().keys({
    type: Joi.string().valid('order', 'grn'),
    status: Joi.string().valid('pending', 'approved', 'rejected'),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const createVarianceApproval = {
  body: Joi.object().keys({
    reference: Joi.string().custom(objectId).required(),
    type: Joi.string().valid('order', 'grn').required(),
    variance: Joi.string().allow(''),
    requestedBy: Joi.string().allow(''),
  }),
};

export const updateVarianceApproval = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    status: Joi.string().valid('pending', 'approved', 'rejected').required(),
  }),
};

export const getDispatchApprovals = {
  query: Joi.object().keys({
    status: Joi.string().valid('pending', 'approved', 'rejected'),
    orderId: Joi.string().custom(objectId),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const createDispatchApproval = {
  body: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
    channel: Joi.string().allow(''),
    requestedBy: Joi.string().allow(''),
    pendingApprover: Joi.string().valid('sales', 'accounts', 'both'),
  }),
};

export const updateDispatchApproval = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    status: Joi.string().valid('pending', 'approved', 'rejected').required(),
  }),
};
