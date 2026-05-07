import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { yarnPurchaseOrderStatuses } from '../models/yarnReq/yarnPurchaseOrder.model.js';

export const getYarnReportSnapshotBounds = {
  query: Joi.object().unknown(false),
};

/** Match calendar keys used by YarnDailyClosingSnapshot (avoid Joi Date coercion / UTC drift). */
const isoCalendarDate = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ 'string.pattern.base': '{{#label}} must be YYYY-MM-DD' });

export const getYarnReport = {
  query: Joi.object()
    .keys({
      start_date: isoCalendarDate.required(),
      end_date: isoCalendarDate.required(),
    })
    .custom((value, helpers) => {
      if (value.end_date < value.start_date) {
        return helpers.error('any.custom', { message: 'end_date must be >= start_date' });
      }
      return value;
    }, 'date range validation'),
};

export const getPoShortTermStorageReport = {
  params: Joi.object().keys({
    poNumber: Joi.string().trim().min(1).required(),
  }),
};

export const getPoBoxAuditReport = {
  params: Joi.object().keys({
    poNumber: Joi.string().trim().min(1).required(),
  }),
};

/** Comma-separated PO statuses → array; empty → undefined */
const optionalStatusList = Joi.string()
  .trim()
  .optional()
  .allow('')
  .custom((value, helpers) => {
    if (!value || !String(value).trim()) return undefined;
    const parts = String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const invalid = parts.filter((p) => !yarnPurchaseOrderStatuses.includes(p));
    if (invalid.length) {
      return helpers.error('any.invalid', { message: `Invalid status: ${invalid.join(', ')}` });
    }
    return parts;
  });

const dateRangeWithOrder = (extra = {}) =>
  Joi.object()
    .keys({
      start_date: isoCalendarDate.required(),
      end_date: isoCalendarDate.required(),
      ...extra,
    })
    .custom((value, helpers) => {
      if (value.end_date < value.start_date) {
        return helpers.error('any.custom', { message: 'end_date must be >= start_date' });
      }
      return value;
    }, 'date range validation')
    .prefs({ convert: true });

export const getPoAnalytics = {
  query: dateRangeWithOrder({
    date_mode: Joi.string().valid('created', 'received').required(),
    supplier_id: Joi.string().custom(objectId).optional(),
    yarn_catalog_id: Joi.string().custom(objectId).optional(),
    status: optionalStatusList,
    include_draft: Joi.string().valid('true', 'false').optional(),
  }),
};

export const getPoAnalyticsLines = {
  query: dateRangeWithOrder({
    date_mode: Joi.string().valid('created', 'received').required(),
    supplier_id: Joi.string().custom(objectId).optional(),
    yarn_catalog_id: Joi.string().custom(objectId).optional(),
    status: optionalStatusList,
    include_draft: Joi.string().valid('true', 'false').optional(),
    group_by: Joi.string().valid('supplier', 'status', 'yarn').optional(),
    group_id: Joi.string().trim().optional().allow(''),
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
  }),
};

export const getYarnClosingTrend = {
  query: Joi.object()
    .keys({
      yarn_catalog_id: Joi.string().custom(objectId).required(),
      start_date: isoCalendarDate.required(),
      end_date: isoCalendarDate.required(),
    })
    .custom((value, helpers) => {
      if (value.end_date < value.start_date) {
        return helpers.error('any.custom', { message: 'end_date must be >= start_date' });
      }
      return value;
    }, 'date range validation')
    .prefs({ convert: true }),
};

export const getYarnTransactionAnalytics = {
  query: dateRangeWithOrder({
    yarn_catalog_id: Joi.string().custom(objectId).optional(),
  }),
};
