import Joi from 'joi';
import { STORAGE_ZONES } from '../models/storageManagement/storageSlot.model.js';

const MAX_RACKS_PER_ADD = 50;

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

export const getStorageContentsByBarcode = {
  params: Joi.object().keys({
    barcode: Joi.string().required().trim(),
  }),
};

/** POST body: add racks to a section (longterm or shortterm). */
export const addRacksToSection = {
  body: Joi.object()
    .keys({
      storageType: Joi.string()
        .valid('longterm', 'shortterm', 'LT', 'ST')
        .required()
        .insensitive(),
      sectionCode: Joi.string().required().trim(),
      numberOfRacksToAdd: Joi.number().integer().min(1).max(MAX_RACKS_PER_ADD).required(),
    })
    .required(),
};

/** POST body: bulk assign boxes to storage slots by rack barcode + box barcodes. */
export const bulkAssignBoxesToSlots = {
  body: Joi.object()
    .keys({
      assignments: Joi.array()
        .items(
          Joi.object()
            .keys({
              rackBarcode: Joi.string().trim().required(),
              boxBarcodes: Joi.array().items(Joi.string().trim()).min(1).required(),
            })
            .required()
        )
        .min(1)
        .required(),
    })
    .required(),
};

