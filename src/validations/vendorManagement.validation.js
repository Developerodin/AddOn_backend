import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { RepairStatus } from '../models/production/enums.js';

const PHONE_PATTERN = /^\+?[\d\s\-()]{10,15}$/;

const headerFields = {
  vendorCode: Joi.string().required().trim().uppercase(),
  vendorName: Joi.string().required().trim(),
  status: Joi.string().valid('active', 'inactive').insensitive().required(),
  city: Joi.string().trim().allow('', null),
  state: Joi.string().trim().allow('', null),
  notes: Joi.string().trim().allow('', null),
  address: Joi.string().trim().allow('', null),
  gstin: Joi.string()
    .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .uppercase()
    .allow('', null)
    .messages({
      'string.pattern.base': 'Invalid GSTIN format',
    }),
};

const contactPersonsSchema = Joi.array()
  .items(
    Joi.object({
      contactName: Joi.string().trim().allow(''),
      phone: Joi.string().trim().allow(''),
      email: Joi.string().email().trim().lowercase().allow('', null),
    })
  )
  .min(1)
  .custom((contacts, helpers) => {
    const first = contacts[0];
    if (!first.contactName?.trim()) {
      return helpers.message('Primary contact name is required');
    }
    if (!first.phone?.trim()) {
      return helpers.message('Primary contact phone is required');
    }
    if (!PHONE_PATTERN.test(first.phone.trim())) {
      return helpers.message('Invalid phone number format for primary contact');
    }
    for (let i = 1; i < contacts.length; i += 1) {
      const p = contacts[i].phone?.trim();
      if (p && !PHONE_PATTERN.test(p)) {
        return helpers.message(`Invalid phone number format on contact row ${i + 1}`);
      }
    }
    return contacts;
  });

export const createVendorManagement = {
  body: Joi.object().keys({
    header: Joi.object().keys(headerFields).required(),
    contactPersons: contactPersonsSchema.required(),
    products: Joi.array().items(Joi.string().custom(objectId)).default([]),
  }),
};

export const getVendorManagements = {
  query: Joi.object().keys({
    vendorName: Joi.string(),
    vendorCode: Joi.string(),
    status: Joi.string(),
    city: Joi.string(),
    state: Joi.string(),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    populate: Joi.string().valid('products'),
  }),
};

export const getVendorProductionFlows = {
  query: Joi.object().keys({
    vendor: Joi.string().custom(objectId),
    vendorPurchaseOrder: Joi.string().custom(objectId),
    product: Joi.string().custom(objectId),
    currentFloorKey: Joi.string().valid('secondaryChecking', 'washing', 'boarding', 'branding', 'finalChecking', 'dispatch'),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getVendorProductionFlow = {
  params: Joi.object().keys({
    vendorProductionFlowId: Joi.string().custom(objectId).required(),
  }),
};

export const updateVendorProductionFlowFloor = {
  params: Joi.object().keys({
    vendorProductionFlowId: Joi.string().custom(objectId).required(),
    floorKey: Joi.string().valid('secondaryChecking', 'washing', 'boarding', 'branding', 'finalChecking', 'dispatch').required(),
  }),
  body: Joi.object()
    .keys({
      /** Ignored by the server — patch mode is derived from *Delta fields only. */
      mode: Joi.string().valid('increment', 'replace'),

      // Increment mode (idempotent cumulative semantics)
      receivedDelta: Joi.number().min(0),
      /** On `secondaryChecking` only: ignored — server sets `completed = m1Quantity`. */
      completedDelta: Joi.number().min(0),
      transferredDelta: Joi.number().min(0),
      m1Delta: Joi.number().min(0),
      m2Delta: Joi.number().min(0),
      m4Delta: Joi.number().min(0),

      // Backward compatibility (replace semantics)
      received: Joi.number().min(0),
      /** On `secondaryChecking` only: ignored — server sets `completed = m1Quantity`. */
      completed: Joi.number().min(0),
      remaining: Joi.number().min(0),
      transferred: Joi.number().min(0),
      m1Quantity: Joi.number().min(0),
      m2Quantity: Joi.number().min(0),
      m4Quantity: Joi.number().min(0),
      m1Transferred: Joi.number().min(0),
      m1Remaining: Joi.number().min(0),
      m2Transferred: Joi.number().min(0),
      m2Remaining: Joi.number().min(0),
      repairStatus: Joi.string().valid(...Object.values(RepairStatus)),
      repairRemarks: Joi.string().allow('', null),
      autoTransferToNextFloor: Joi.boolean(),
      /** Required when auto-transfer targets branding or final checking — physical container barcode (already exists). */
      existingContainerBarcode: Joi.string().trim().allow('', null),
      /** Clears M1–M4, transfers, completed, repair fields on secondary checking; keeps `received`. */
      resetSecondaryChecking: Joi.boolean(),
    })
    .min(1)
    .unknown(true),
};

const vendorTransferItemSchema = Joi.object().keys({
  transferred: Joi.number().min(0).required(),
  styleCode: Joi.string().allow('', null),
  brand: Joi.string().allow('', null),
});

export const transferVendorProductionFlow = {
  params: Joi.object().keys({
    vendorProductionFlowId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      fromFloorKey: Joi.string()
        .valid('secondaryChecking', 'branding', 'finalChecking', 'dispatch')
        .required(),
      toFloorKey: Joi.string().valid('branding', 'finalChecking', 'dispatch', 'warehouse').required(),
      quantity: Joi.number().min(1).required(),
      /** Required for secondary→branding and branding→final checking — physical container that already exists */
      existingContainerBarcode: Joi.string().trim().allow('', null),
      /** Required when fromFloorKey=branding and toFloorKey=finalChecking — sum must equal quantity */
      transferItems: Joi.array().items(vendorTransferItemSchema),
    })
    .custom((value) => {
      if (value.toFloorKey === 'warehouse' && value.fromFloorKey !== 'dispatch') {
        throw new Error('warehouse destination is only valid when fromFloorKey is dispatch');
      }
      if (value.fromFloorKey === 'dispatch' && value.toFloorKey !== 'warehouse') {
        throw new Error('From dispatch, toFloorKey must be warehouse');
      }
      if (value.fromFloorKey === 'dispatch' && value.toFloorKey === 'warehouse') {
        if (!value.existingContainerBarcode || !String(value.existingContainerBarcode).trim()) {
          throw new Error(
            'existingContainerBarcode is required for dispatch → warehouse (stage a container for the WHMS scan)'
          );
        }
        if (Array.isArray(value.transferItems) && value.transferItems.length > 0) {
          const sum = value.transferItems.reduce((s, row) => s + Math.max(0, Number(row?.transferred || 0)), 0);
          if (Math.abs(sum - value.quantity) > 0.0001) {
            throw new Error(`transferItems sum (${sum}) must equal quantity (${value.quantity})`);
          }
        }
        return value;
      }

      const usesContainer =
        (value.fromFloorKey === 'secondaryChecking' && value.toFloorKey === 'branding') ||
        (value.fromFloorKey === 'branding' && value.toFloorKey === 'finalChecking');
      if (usesContainer) {
        if (!value.existingContainerBarcode || !String(value.existingContainerBarcode).trim()) {
          throw new Error(
            'existingContainerBarcode is required for this transfer (reuse an existing container; the backend does not create a new one)'
          );
        }
      }
      if (value.fromFloorKey === 'branding' && value.toFloorKey === 'finalChecking') {
        if (!Array.isArray(value.transferItems) || value.transferItems.length === 0) {
          throw new Error('transferItems is required when transferring from branding to final checking');
        }
      }
      return value;
    }),
};

export const confirmVendorProductionFlow = {
  params: Joi.object().keys({
    vendorProductionFlowId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      remarks: Joi.string().allow('', null),
    })
    .unknown(true),
};

export const transferFinalCheckingM2ForRework = {
  params: Joi.object().keys({
    vendorProductionFlowId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    toFloorKey: Joi.string().valid('washing', 'boarding', 'branding').required(),
    quantity: Joi.number().min(1).required(),
    remarks: Joi.string().allow('', null),
  }),
};

export const getVendorManagement = {
  params: Joi.object().keys({
    vendorManagementId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    populate: Joi.string().valid('products'),
  }),
};

const headerUpdateFields = {
  vendorCode: Joi.string().trim().uppercase(),
  vendorName: Joi.string().trim(),
  status: Joi.string().valid('active', 'inactive').insensitive(),
  city: Joi.string().trim().allow('', null),
  state: Joi.string().trim().allow('', null),
  notes: Joi.string().trim().allow('', null),
  address: Joi.string().trim().allow('', null),
  gstin: Joi.string()
    .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .uppercase()
    .allow('', null)
    .messages({
      'string.pattern.base': 'Invalid GSTIN format',
    }),
};

export const updateVendorManagement = {
  params: Joi.object().keys({
    vendorManagementId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      header: Joi.object().keys(headerUpdateFields).min(1),
      contactPersons: contactPersonsSchema,
      products: Joi.array().items(Joi.string().custom(objectId)),
    })
    .min(1),
};

export const deleteVendorManagement = {
  params: Joi.object().keys({
    vendorManagementId: Joi.string().custom(objectId).required(),
  }),
};

export const addVendorProducts = {
  params: Joi.object().keys({
    vendorManagementId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    productIds: Joi.array().items(Joi.string().custom(objectId)).min(1).required(),
  }),
};

export const removeVendorProducts = {
  params: Joi.object().keys({
    vendorManagementId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    productIds: Joi.array().items(Joi.string().custom(objectId)).min(1).required(),
  }),
};
