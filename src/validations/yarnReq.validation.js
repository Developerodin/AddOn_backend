import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const getYarnRequisitionList = {
  query: Joi.object()
    .keys({
      startDate: Joi.date().iso().required(),
      endDate: Joi.date().iso().required(),
      poSent: Joi.boolean().optional(),
      alertStatus: Joi.string().valid('below_minimum', 'overbooked', 'has_alert').optional(),
      page: Joi.number().integer().min(1).optional(),
      limit: Joi.number().integer().min(1).max(200).optional(),
      skipRecalculation: Joi.string().valid('true', 'false').optional(),
    })
    .with('startDate', 'endDate')
    .with('endDate', 'startDate')
    .custom((value, helpers) => {
      const { startDate, endDate } = value;
      if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'start and end date validation'),
};

export const createYarnRequisition = {
  body: Joi.object()
    .keys({
      yarnName: Joi.string().trim().required(),
      yarnCatalogId: Joi.string().custom(objectId),
      yarn: Joi.string().custom(objectId),
      minQty: Joi.number().min(0).required(),
      availableQty: Joi.number().min(0).required(),
      blockedQty: Joi.number().min(0).required(),
      alertStatus: Joi.string().valid('below_minimum', 'overbooked').optional(),
      poSent: Joi.boolean().default(false),
    })
    .custom((value, helpers) => {
      const id = value.yarnCatalogId || value.yarn;
      if (!id) {
        return helpers.error('any.custom', { message: 'yarnCatalogId (or legacy yarn) is required' });
      }
      return { ...value, yarnCatalogId: id };
    })
    .required(),
};

export const updateYarnRequisitionStatus = {
  params: Joi.object().keys({
    yarnRequisitionId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      poSent: Joi.boolean().required(),
    })
    .required(),
};


