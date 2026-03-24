import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { yarnTransactionTypes } from '../models/yarnReq/yarnTransaction.model.js';

const transactionTypeField = Joi.string().valid(...yarnTransactionTypes);

export const createYarnTransaction = {
  body: Joi.object()
    .keys({
      yarnCatalogId: Joi.string().custom(objectId),
      yarn: Joi.string().custom(objectId),
      yarnName: Joi.string().trim().required(),
      transactionType: transactionTypeField.required(),
      transactionDate: Joi.date().iso().required(),
      transactionNetWeight: Joi.number().min(0).allow(null),
      transactionTotalWeight: Joi.number().min(0).allow(null),
      transactionTearWeight: Joi.number().min(0).allow(null),
      transactionConeCount: Joi.number().min(0).allow(null),
      totalWeight: Joi.number().min(0).allow(null),
      totalNetWeight: Joi.number().min(0).allow(null),
      totalTearWeight: Joi.number().min(0).allow(null),
      numberOfCones: Joi.number().min(0).allow(null),
      totalBlockedWeight: Joi.number().min(0).allow(null),
      orderId: Joi.string().custom(objectId).allow(null, ''),
      orderno: Joi.string().trim().allow(null, ''),
      articleId: Joi.string().custom(objectId).allow(null, ''),
      articleNumber: Joi.string().trim().allow(null, ''),
      machineId: Joi.string().custom(objectId).allow(null, ''),
      boxIds: Joi.array().items(Joi.string()).optional(),
      conesIdsArray: Joi.array().items(Joi.string().custom(objectId)).optional(),
    })
    .custom((value, helpers) => {
      const catalogId = value.yarnCatalogId || value.yarn;
      if (!catalogId) {
        return helpers.error('any.custom', { message: 'yarnCatalogId (or legacy yarn) is required' });
      }
      const valueWithId = { ...value, yarnCatalogId: catalogId };
      const type = valueWithId.transactionType;
      const isBlocked = type === 'yarn_blocked';

      if (isBlocked) {
        if (valueWithId.totalBlockedWeight === undefined && valueWithId.transactionNetWeight === undefined) {
          return helpers.error('any.custom', { message: 'totalBlockedWeight is required when transactionType is yarn_blocked' });
        }
        return valueWithId;
      }

      const requiredFields = [
        ['transactionTotalWeight', 'totalWeight'],
        ['transactionNetWeight', 'totalNetWeight'],
        ['transactionTearWeight', 'totalTearWeight'],
        ['transactionConeCount', 'numberOfCones'],
      ];

      const missing = requiredFields.filter(
        ([primary, fallback]) =>
          valueWithId[primary] === undefined && valueWithId[fallback] === undefined
      );

      if (missing.length) {
        return helpers.error('any.custom', {
          message: `Missing required inventory metrics for ${type}: please provide ${missing
            .map(([primary, fallback]) => primary ?? fallback)
            .join(', ')}`,
        });
      }

      return valueWithId;
    }, 'transaction payload completeness validation')
    .required(),
};

export const getYarnTransactions = {
  query: Joi.object().keys({
    start_date: Joi.date().iso().optional(),
    end_date: Joi.date().iso().optional(),
    transaction_type: transactionTypeField.optional(),
    yarn_id: Joi.string().custom(objectId).optional(),
    yarn_name: Joi.string().trim().optional(),
    order_id: Joi.string().custom(objectId).optional(),
    orderno: Joi.string().trim().optional(),
    article_id: Joi.string().custom(objectId).optional(),
    article_number: Joi.string().trim().optional(),
    group_by: Joi.string().valid('article', 'yarn').optional(),
  }),
};

export const getYarnIssuedByOrder = {
  params: Joi.object().keys({
    orderno: Joi.string().trim().required(),
  }),
};

export const getAllYarnIssued = {
  query: Joi.object().keys({
    start_date: Joi.date().iso().optional(),
    end_date: Joi.date().iso().optional(),
  }),
};

export const getYarnTransactionById = {
  params: Joi.object().keys({
    transactionId: Joi.string().custom(objectId).required(),
  }),
};


