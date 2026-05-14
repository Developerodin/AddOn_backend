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
    transaction_type: Joi.string()
      .optional()
      .custom((value, helpers) => {
        if (value === undefined || value === null || value === '') {
          return value;
        }
        const parts = String(value)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        for (const p of parts) {
          if (!yarnTransactionTypes.includes(p)) {
            return helpers.error('any.only', { valids: yarnTransactionTypes });
          }
        }
        return value;
      }),
    yarn_id: Joi.string().custom(objectId).optional(),
    yarn_name: Joi.string().trim().optional(),
    order_id: Joi.string().custom(objectId).optional(),
    orderno: Joi.string().trim().optional(),
    article_id: Joi.string().custom(objectId).optional(),
    article_number: Joi.string().trim().optional(),
    issue_batch_id: Joi.string().trim().optional(),
    group_by: Joi.string().valid('article', 'yarn').optional(),
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    paged: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().valid('0', '1', 'true', 'false'))
      .optional(),
    light: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().valid('0', '1', 'true', 'false'))
      .optional(),
  }),
};

export const getYarnIssuedByOrder = {
  params: Joi.object().keys({
    orderno: Joi.string().trim().required(),
  }),
  query: Joi.object().keys({
    include_returns: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().trim().valid('', 'true', 'false', '0', '1', 'yes', 'no'))
      .optional(),
    include_floor_issue: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().trim().valid('', 'true', 'false', '0', '1', 'yes', 'no'))
      .optional(),
  }),
};

export const getAllYarnIssued = {
  query: Joi.object().keys({
    start_date: Joi.date().iso().optional(),
    end_date: Joi.date().iso().optional(),
  }),
};

/** Per-article yarn issue/return cone merge for Yarn Return UI; requires PO id + article id or article_number. */
export const getArticleReturnSlice = {
  query: Joi.object()
    .keys({
      order_id: Joi.string().custom(objectId).required(),
      article_id: Joi.string().custom(objectId).optional(),
      article_number: Joi.string().trim().optional(),
    })
    .or('article_id', 'article_number')
    .messages({
      'object.missing':
        '"article_id" is required unless "article_number" is provided (legacy rows)',
    }),
};

export const getYarnTransactionById = {
  params: Joi.object().keys({
    transactionId: Joi.string().custom(objectId).required(),
  }),
};


