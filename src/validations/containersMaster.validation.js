import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { ContainerStatus, ContainerType } from '../models/production/enums.js';

const statusValues = Object.values(ContainerStatus);
const typeValues = Object.values(ContainerType);

/** Query: Active, ACTIVE, inactive, etc. → canonical Active | Inactive (Joi 17: no .transform after .valid) */
const containerStatusFlexible = Joi.string().trim().custom((value, helpers) => {
  const v = String(value).toLowerCase();
  if (v === 'active') return ContainerStatus.ACTIVE;
  if (v === 'inactive') return ContainerStatus.INACTIVE;
  return helpers.error('any.only', { valids: [...statusValues, 'ACTIVE', 'INACTIVE'] });
});

const transferItemRowSchema = Joi.object().keys({
  transferred: Joi.number().min(0).required(),
  styleCode: Joi.string().allow('', null),
  brand: Joi.string().allow('', null),
});

/** Factory article XOR vendor production flow per row */
const activeItemSchema = Joi.object()
  .keys({
    article: Joi.string().custom(objectId),
    vendorProductionFlow: Joi.string().custom(objectId),
    quantity: Joi.number().min(0.0001).required(),
    transferItems: Joi.array().items(transferItemRowSchema),
  })
  .xor('article', 'vendorProductionFlow');

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
    status: containerStatusFlexible,
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

/** List containers on a floor (activeFloor) with populated articles */
export const getContainersByFloorWithArticles = {
  params: Joi.object().keys({
    activeFloor: Joi.string().trim().required().min(1),
  }),
  query: Joi.object().keys({
    status: containerStatusFlexible,
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
      addItem: Joi.object()
        .keys({
          article: Joi.string().custom(objectId),
          vendorProductionFlow: Joi.string().custom(objectId),
          quantity: Joi.number().min(0.0001).required(),
          transferItems: Joi.array().items(transferItemRowSchema),
        })
        .xor('article', 'vendorProductionFlow'),
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
