import Joi from 'joi';
import { objectId } from './custom.validation.js';

const processStepSchema = Joi.object().keys({
  stepTitle: Joi.string().required(),
  stepDescription: Joi.string().required(),
  duration: Joi.number().required().min(0),
  _id: Joi.string().custom(objectId), // For updates
});

export const createProcess = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    type: Joi.string().required(),
    description: Joi.string().required(),
    sortOrder: Joi.number().integer(),
    status: Joi.string().valid('active', 'inactive'),
    image: Joi.string(),
    steps: Joi.array().items(processStepSchema).min(1).required(),
  }),
};

export const getProcesses = {
  query: Joi.object().keys({
    name: Joi.string(),
    type: Joi.string(),
    status: Joi.string(),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getProcess = {
  params: Joi.object().keys({
    processId: Joi.string().custom(objectId),
  }),
};

export const updateProcess = {
  params: Joi.object().keys({
    processId: Joi.string().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      type: Joi.string(),
      description: Joi.string(),
      sortOrder: Joi.number().integer(),
      status: Joi.string().valid('active', 'inactive'),
      image: Joi.string(),
      steps: Joi.array().items(processStepSchema).min(1),
    })
    .min(1),
};

export const deleteProcess = {
  params: Joi.object().keys({
    processId: Joi.string().custom(objectId),
  }),
}; 