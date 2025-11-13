import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { yarnTransactionTypes } from '../models/yarnReq/yarnTransaction.model.js';

const transactionTypeField = Joi.string().valid(...yarnTransactionTypes);

export const createYarnTransaction = {
  body: Joi.object()
    .keys({
      yarn: Joi.string().custom(objectId).required(),
      yarnName: Joi.string().trim().required(),
      transactionType: transactionTypeField.required(),
      transactionDate: Joi.date().iso().required(),
      transactionNetWeight: Joi.number().min(0).allow(null),
      transactionTotalWeight: Joi.number().min(0).allow(null),
      transactionTearWeight: Joi.number().min(0).allow(null),
    })
    .required(),
};

export const getYarnTransactions = {
  query: Joi.object().keys({
    start_date: Joi.date().iso().optional(),
    end_date: Joi.date().iso().optional(),
    transaction_type: transactionTypeField.optional(),
    yarn_id: Joi.string().custom(objectId).optional(),
    yarn_name: Joi.string().trim().optional(),
  }),
};


