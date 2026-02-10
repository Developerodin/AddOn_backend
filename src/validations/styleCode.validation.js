import Joi from 'joi';
import { objectId } from './custom.validation.js';

const baseFields = {
  styleCode: Joi.string().trim().required(),
  eanCode: Joi.string().trim().required(),
  mrp: Joi.number().required().min(0),
  brand: Joi.string().trim().allow(''),
  pack: Joi.string().trim().allow(''),
  status: Joi.string().valid('active', 'inactive'),
};

const createStyleCode = {
  body: Joi.object().keys(baseFields),
};

const getStyleCodes = {
  query: Joi.object().keys({
    styleCode: Joi.string(),
    eanCode: Joi.string(),
    brand: Joi.string(),
    pack: Joi.string(),
    status: Joi.string().valid('active', 'inactive'),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getStyleCode = {
  params: Joi.object().keys({
    styleCodeId: Joi.string().custom(objectId),
  }),
};

const updateStyleCode = {
  params: Joi.object().keys({
    styleCodeId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      styleCode: Joi.string().trim(),
      eanCode: Joi.string().trim(),
      mrp: Joi.number().min(0),
      brand: Joi.string().trim().allow(''),
      pack: Joi.string().trim().allow(''),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

const deleteStyleCode = {
  params: Joi.object().keys({
    styleCodeId: Joi.string().custom(objectId),
  }),
};

const bulkImportStyleCodes = {
  body: Joi.object().keys({
    styleCodes: Joi.array()
      .items(
        Joi.object().keys({
          styleCode: Joi.string().trim().required(),
          eanCode: Joi.string().trim().required(),
          mrp: Joi.number().required().min(0),
          brand: Joi.string().trim().allow(''),
          pack: Joi.string().trim().allow(''),
          status: Joi.string().valid('active', 'inactive').default('active'),
        })
      )
      .min(1)
      .max(10000)
      .required(),
    batchSize: Joi.number().integer().min(1).max(500).default(50),
  }),
};

export default {
  createStyleCode,
  getStyleCodes,
  getStyleCode,
  updateStyleCode,
  deleteStyleCode,
  bulkImportStyleCodes,
};
