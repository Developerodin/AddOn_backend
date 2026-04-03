import Joi from 'joi';
import { objectId } from './custom.validation.js';

const bomItemSchema = Joi.object().keys({
  rawMaterial: Joi.string().custom(objectId).required(),
  quantity: Joi.number().min(0).required(),
});

const createStyleCodePairs = {
  body: Joi.object().keys({
    pairStyleCode: Joi.string().trim().required(),
    eanCode: Joi.string().trim().required(),
    mrp: Joi.number().required().min(0),
    pack: Joi.number().integer().min(1).required(),
    status: Joi.string().valid('active', 'inactive'),
    styleCodes: Joi.array().items(Joi.string().custom(objectId)),
    bom: Joi.array().items(bomItemSchema),
  }),
};

const getStyleCodePairsList = {
  query: Joi.object().keys({
    pairStyleCode: Joi.string(),
    eanCode: Joi.string(),
    status: Joi.string().valid('active', 'inactive'),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getStyleCodePairs = {
  params: Joi.object().keys({
    styleCodePairsId: Joi.string().custom(objectId).required(),
  }),
};

const updateStyleCodePairs = {
  params: Joi.object().keys({
    styleCodePairsId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      pairStyleCode: Joi.string().trim(),
      eanCode: Joi.string().trim(),
      mrp: Joi.number().min(0),
      pack: Joi.number().integer().min(1),
      status: Joi.string().valid('active', 'inactive'),
      styleCodes: Joi.array().items(Joi.string().custom(objectId)),
      bom: Joi.array().items(bomItemSchema),
    })
    .min(1),
};

const deleteStyleCodePairs = {
  params: Joi.object().keys({
    styleCodePairsId: Joi.string().custom(objectId).required(),
  }),
};

const bulkImportStyleCodePairs = {
  body: Joi.object().keys({
    items: Joi.array()
      .items(
        Joi.object().keys({
          pairStyleCode: Joi.string().trim().required(),
          eanCode: Joi.string().trim().required(),
          mrp: Joi.number().required().min(0),
          pack: Joi.number().integer().min(1).required(),
          status: Joi.string().valid('active', 'inactive'),
          styleCodes: Joi.array().items(Joi.string()),
          bom: Joi.array().items(bomItemSchema),
        })
      )
      .min(1)
      .max(1000)
      .required(),
    batchSize: Joi.number().integer().min(1).max(100).default(50),
  }),
};

const bulkImportBom = {
  body: Joi.object().keys({
    items: Joi.array()
      .items(
        Joi.object().keys({
          styleCodePairsId: Joi.string().custom(objectId).required(),
          bom: Joi.array()
            .items(bomItemSchema)
            .min(1)
            .required(),
        })
      )
      .min(1)
      .max(1000)
      .required(),
    batchSize: Joi.number().integer().min(1).max(100).default(50),
  }),
};

export default {
  createStyleCodePairs,
  getStyleCodePairsList,
  getStyleCodePairs,
  updateStyleCodePairs,
  deleteStyleCodePairs,
  bulkImportStyleCodePairs,
  bulkImportBom,
};
