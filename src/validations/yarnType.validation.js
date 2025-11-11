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
    yarnName: Joi.string().trim().allow('', null),
    details: Joi.array().items(yarnTypeDetailSchema),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getYarnTypes = {
  query: Joi.object().keys({
    name: Joi.string(),
    yarnName: Joi.string(),
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
      yarnName: Joi.string().trim().allow('', null),
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

