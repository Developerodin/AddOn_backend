import Joi from 'joi';
import { objectId } from './custom.validation.js';

const yarnTypeDetailSchema = Joi.object().keys({
  subtype: Joi.string().required().trim(),
  countSize: Joi.array().items(Joi.string().custom(objectId)),
  tearWeight: Joi.string().trim().allow('', null),
});

export const createYarnType = {
  body: Joi.object().keys({
    name: Joi.string().required().trim(),
    details: Joi.array().items(yarnTypeDetailSchema),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getYarnTypes = {
  query: Joi.object().keys({
    name: Joi.string(),
    status: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getYarnType = {
  params: Joi.object().keys({
    yarnTypeId: Joi.string().custom(objectId).required(),
  }),
};

export const updateYarnType = {
  params: Joi.object().keys({
    yarnTypeId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string().trim(),
      details: Joi.array().items(yarnTypeDetailSchema),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteYarnType = {
  params: Joi.object().keys({
    yarnTypeId: Joi.string().custom(objectId).required(),
  }),
};

export const bulkImportYarnTypes = {
  body: Joi.object().keys({
    yarnTypes: Joi.array().items(
      Joi.object().keys({
        id: Joi.string().custom(objectId).optional().description('MongoDB ObjectId for updating existing yarn type'),
        name: Joi.string().required().trim().messages({
          'string.empty': 'Yarn type name is required',
          'any.required': 'Yarn type name is required'
        }),
        details: Joi.array().items(yarnTypeDetailSchema),
        status: Joi.string().valid('active', 'inactive').default('active'),
      })
    ).min(1).max(1000).messages({
      'array.min': 'At least one yarn type is required',
      'array.max': 'Maximum 1000 yarn types allowed per request'
    }),
    batchSize: Joi.number().integer().min(1).max(100).default(50).messages({
      'number.min': 'Batch size must be at least 1',
      'number.max': 'Batch size cannot exceed 100'
    }),
  }),
};

