import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { ContainerStatus, ContainerType } from '../models/production/enums.js';

const statusValues = Object.values(ContainerStatus);
const typeValues = Object.values(ContainerType);

const activeItemSchema = Joi.object().keys({
  article: Joi.string().custom(objectId).required(),
  quantity: Joi.number().min(0.0001).required(),
});

export const createContainersMaster = {
  body: Joi.object().keys({
    containerName: Joi.string().trim().allow('', null),
    status: Joi.string()
      .valid(...statusValues)
      .default(ContainerStatus.ACTIVE),
    activeFloor: Joi.string().trim().allow('', null),
    activeItems: Joi.array().items(activeItemSchema),
    type: Joi.string().valid(...typeValues),
    tearWeight: Joi.number().min(0),
  }),
};

export const getContainersMasters = {
  query: Joi.object().keys({
    containerName: Joi.string().trim(),
    status: Joi.string().valid(...statusValues),
    type: Joi.string().valid(...typeValues),
    activeArticle: Joi.string().trim(),
    activeFloor: Joi.string().trim(),
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

/** Update container's activeFloor, activeItems, addItem, type, tearWeight by barcode */
export const updateContainerByBarcode = {
  params: Joi.object().keys({
    barcode: Joi.string().trim().required(),
  }),
  body: Joi.object()
    .keys({
      activeFloor: Joi.string().trim().allow('', null),
      activeItems: Joi.array().items(activeItemSchema),
      addItem: Joi.object().keys({
        article: Joi.string().custom(objectId).required(),
        quantity: Joi.number().min(0.0001).required(),
      }),
      type: Joi.string().valid(...typeValues),
      tearWeight: Joi.number().min(0),
    })
    .min(1),
};

/** Accept container on receiving floor - updates article floor received from container data */
export const acceptContainerByBarcode = {
  params: Joi.object().keys({
    barcode: Joi.string().trim().required(),
  }),
};

/** Clear activeArticle and activeFloor for container by barcode */
export const clearActiveByBarcode = {
  params: Joi.object().keys({
    barcode: Joi.string().trim().required(),
  }),
};

/** Reset activeArticle and activeFloor for all containers */
export const resetAllActive = {};

export const updateContainersMaster = {
  params: Joi.object().keys({
    containerId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      containerName: Joi.string().trim().allow('', null),
      status: Joi.string().valid(...statusValues),
      type: Joi.string().valid(...typeValues),
      tearWeight: Joi.number().min(0),
      activeFloor: Joi.string().trim().allow('', null),
      activeItems: Joi.array().items(activeItemSchema),
    })
    .min(1),
};

export const deleteContainersMaster = {
  params: Joi.object().keys({
    containerId: Joi.string().custom(objectId).required(),
  }),
};
