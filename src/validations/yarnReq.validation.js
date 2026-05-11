import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const getYarnRequisitionList = {
  query: Joi.object()
    .keys({
      startDate: Joi.date().iso().required(),
      endDate: Joi.date().iso().required(),
      poSent: Joi.boolean().truthy('true').falsy('false').optional(),
      draftForPo: Joi.boolean().truthy('true').falsy('false').optional(),
      alertStatus: Joi.string().valid('below_minimum', 'overbooked', 'has_alert').optional(),
      page: Joi.number().integer().min(1).optional(),
      limit: Joi.number().integer().min(1).max(200).optional(),
      skipRecalculation: Joi.string().valid('true', 'false').optional(),
      yarnName: Joi.string().trim().max(200).allow('').optional(),
      lastUpdatedFrom: Joi.date().iso().optional(),
      lastUpdatedTo: Joi.date().iso().optional(),
      sortBy: Joi.string()
        .valid('yarnName', 'created', 'lastUpdated', 'minQty', 'availableQty', 'blockedQty')
        .optional(),
      sortOrder: Joi.string().valid('asc', 'desc').optional(),
      workflowStage: Joi.string()
        .valid('in_requisition', 'sent_to_draft', 'order_placed', 'dismissed')
        .optional(),
      includeDismissed: Joi.boolean().truthy('true').falsy('false').optional(),
      preferredSupplierId: Joi.string().custom(objectId).optional(),
      supplierName: Joi.string().trim().max(200).allow('').optional(),
    })
    .with('startDate', 'endDate')
    .with('endDate', 'startDate')
    .custom((value, helpers) => {
      const { startDate, endDate } = value;
      if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'start and end date validation')
    .custom((value, helpers) => {
      const { lastUpdatedFrom, lastUpdatedTo } = value;
      if (lastUpdatedFrom && lastUpdatedTo && new Date(lastUpdatedFrom) > new Date(lastUpdatedTo)) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'lastUpdated range validation'),
};

export const createYarnRequisition = {
  body: Joi.object()
    .keys({
      yarnName: Joi.string().trim().required(),
      yarnCatalogId: Joi.string().custom(objectId),
      yarn: Joi.string().custom(objectId),
      minQty: Joi.number().min(0).required(),
      availableQty: Joi.number().min(0).required(),
      blockedQty: Joi.number().min(0).required(),
      alertStatus: Joi.string().valid('below_minimum', 'overbooked').optional(),
      poSent: Joi.boolean().default(false),
      draftForPo: Joi.boolean().default(false),
    })
    .custom((value, helpers) => {
      const id = value.yarnCatalogId || value.yarn;
      if (!id) {
        return helpers.error('any.custom', { message: 'yarnCatalogId (or legacy yarn) is required' });
      }
      return { ...value, yarnCatalogId: id };
    })
    .required(),
};

export const patchYarnRequisition = {
  params: Joi.object().keys({
    yarnRequisitionId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      poSent: Joi.boolean().truthy('true').falsy('false').optional(),
      draftForPo: Joi.boolean().truthy('true').falsy('false').optional(),
      preferredSupplierId: Joi.string()
        .allow(null, '')
        .custom((value, helpers) => {
          if (value === null || value === undefined || value === '') return value;
          return objectId(value, helpers);
        }),
      preferredSupplierName: Joi.string().trim().max(200).allow('').optional(),
    })
    .min(1)
    .required(),
};

/** @deprecated alias */
export const updateYarnRequisitionStatus = patchYarnRequisition;

export const dismissRequisition = {
  params: Joi.object().keys({
    yarnRequisitionId: Joi.string().custom(objectId).required(),
  }),
};

export const clearRequisitionDraft = {
  body: Joi.object()
    .keys({
      requisitionIds: Joi.array().items(Joi.string().custom(objectId)).min(1).required(),
      linkedPurchaseOrderId: Joi.string().custom(objectId).optional(),
    })
    .required(),
};
