import Joi from 'joi';
import { objectId } from './custom.validation.js';

const createRawMaterial = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    groupName: Joi.string().required(),
    type: Joi.string().required(),
    description: Joi.string().required(),
    brand: Joi.string().required(),
    countSize: Joi.string().required(),
    material: Joi.string().required(),
    color: Joi.string().required(),
    shade: Joi.string().required(),
    unit: Joi.string().required(),
    mrp: Joi.string().required(),
    hsnCode: Joi.string().required(),
    gst: Joi.string().required(),
    articleNo: Joi.string().required(),
    image: Joi.string().allow(null),
  }),
};

const getRawMaterials = {
  query: Joi.object().keys({
    name: Joi.string(),
    groupName: Joi.string(),
    type: Joi.string(),
    brand: Joi.string(),
    countSize: Joi.string(),
    material: Joi.string(),
    color: Joi.string(),
    shade: Joi.string(),
    unit: Joi.string(),
    mrp: Joi.string(),
    hsnCode: Joi.string(),
    gst: Joi.string(),
    articleNo: Joi.string(),
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
      name: Joi.string(),
      groupName: Joi.string(),
      type: Joi.string(),
      description: Joi.string(),
      brand: Joi.string(),
      countSize: Joi.string(),
      material: Joi.string(),
      color: Joi.string(),
      shade: Joi.string(),
      unit: Joi.string(),
      mrp: Joi.string(),
      hsnCode: Joi.string(),
      gst: Joi.string(),
      articleNo: Joi.string(),
      image: Joi.string().allow(null),
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