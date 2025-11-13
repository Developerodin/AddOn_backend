import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const getYarnRequisitionList = {
  query: Joi.object()
    .keys({
      startDate: Joi.date().iso().required(),
      endDate: Joi.date().iso().required(),
      poSent: Joi.boolean().optional(),
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
      yarn: Joi.string().custom(objectId).required(),
      minQty: Joi.number().min(0).required(),
      availableQty: Joi.number().min(0).required(),
      blockedQty: Joi.number().min(0).required(),
      alertStatus: Joi.string().valid('below_minimum', 'overbooked').optional(),
      poSent: Joi.boolean().default(false),
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


