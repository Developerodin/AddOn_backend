import Joi from 'joi';
import { objectId } from '../custom.validation.js';
import { WarehouseOrderFlowStatus } from '../../models/whms/warehouseOrder.model.js';

const flowStatuses = Object.values(WarehouseOrderFlowStatus);

export const transitionFlowStatus = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    flowStatus: Joi.string()
      .valid(...flowStatuses)
      .required(),
    remarks: Joi.string().allow('').trim().max(1000),
  }),
};

export const getFlowHistory = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
};
