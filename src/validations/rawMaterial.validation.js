import Joi from 'joi';
import { objectId } from './custom.validation.js';

const createRawMaterial = {
  body: Joi.object().keys({
    itemName: Joi.string().required(),
    printName: Joi.string().required(),
    color: Joi.string().required(),
    unit: Joi.string().required(),
    description: Joi.string().required(),
    image: Joi.string(),
  }),
};

const getRawMaterials = {
  query: Joi.object().keys({
    itemName: Joi.string(),
    color: Joi.string(),
    unit: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getRawMaterial = {
  params: Joi.object().keys({
    materialId: Joi.string().custom(objectId),
  }),
};

const updateRawMaterial = {
  params: Joi.object().keys({
    materialId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      itemName: Joi.string(),
      printName: Joi.string(),
      color: Joi.string(),
      unit: Joi.string(),
      description: Joi.string(),
      image: Joi.string(),
    })
    .min(1),
};

const deleteRawMaterial = {
  params: Joi.object().keys({
    materialId: Joi.string().custom(objectId),
  }),
};

export default {
  createRawMaterial,
  getRawMaterials,
  getRawMaterial,
  updateRawMaterial,
  deleteRawMaterial,
}; 