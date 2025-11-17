import Joi from 'joi';
import { STORAGE_ZONES } from '../models/storageManagement/storageSlot.model.js';

const zoneField = Joi.string()
  .valid(...Object.values(STORAGE_ZONES))
  .uppercase();

export const listStorageSlots = {
  query: Joi.object().keys({
    zone: zoneField.optional(),
    shelf: Joi.number().integer().min(1).max(150).optional(),
    floor: Joi.number().integer().min(1).max(4).optional(),
    isActive: Joi.boolean().optional(),
    limit: Joi.number().integer().min(1).max(500).default(200),
    page: Joi.number().integer().min(1).default(1),
  }),
};

export const getStorageSlotsByZone = {
  params: Joi.object().keys({
    zone: zoneField.required(),
  }),
  query: Joi.object().keys({
    shelf: Joi.number().integer().min(1).max(150).optional(),
    floor: Joi.number().integer().min(1).max(4).optional(),
    isActive: Joi.boolean().optional(),
    limit: Joi.number().integer().min(1).max(500).default(200),
    page: Joi.number().integer().min(1).default(1),
  }),
};


