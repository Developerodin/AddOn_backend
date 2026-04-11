import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const getYarnEstimationByOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    include_transactions: Joi.string().valid('true', 'false').optional(),
  }),
};

export const getYarnEstimationByArticle = {
  params: Joi.object().keys({
    articleId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    include_transactions: Joi.string().valid('true', 'false').optional(),
  }),
};

export const getYarnEstimationSummary = {
  query: Joi.object().keys({
    status: Joi.string().optional(),
    search: Joi.string().trim().optional(),
    limit: Joi.number().integer().min(1).max(200).optional(),
    page: Joi.number().integer().min(1).optional(),
  }),
};
