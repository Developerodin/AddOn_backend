import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { ContainerStatus } from '../models/production/enums.js';

const statusValues = Object.values(ContainerStatus);

export const createContainersMaster = {
  body: Joi.object().keys({
    containerName: Joi.string().trim().allow('', null),
    status: Joi.string()
      .valid(...statusValues)
      .default(ContainerStatus.ACTIVE),
  }),
};

export const getContainersMasters = {
  query: Joi.object().keys({
    containerName: Joi.string().trim(),
    status: Joi.string().valid(...statusValues),
    search: Joi.string().trim(),
    sortBy: Joi.string(),
    limit: Joi.number().integer().min(1),
    page: Joi.number().integer().min(1),
  }),
};

export const getContainersMaster = {
  params: Joi.object().keys({
    containerId: Joi.string().custom(objectId).required(),
  }),
};

export const getContainerByBarcode = {
  params: Joi.object().keys({
    barcode: Joi.string().trim().required(),
  }),
};

export const updateContainersMaster = {
  params: Joi.object().keys({
    containerId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      containerName: Joi.string().trim().allow('', null),
      status: Joi.string().valid(...statusValues),
    })
    .min(1),
};

export const deleteContainersMaster = {
  params: Joi.object().keys({
    containerId: Joi.string().custom(objectId).required(),
  }),
};
