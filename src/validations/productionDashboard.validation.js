import Joi from 'joi';

/**
 * Common date range validation
 */
const dateRangeSchema = {
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
  compare: Joi.string().valid('prev', 'yoy', 'none').optional().default('prev')
};

/**
 * Common filter options
 */
const filterSchema = {
  order: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  article: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  floor: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  machine: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  linkingType: Joi.alternatives().try(
    Joi.string().valid('Auto Linking', 'Hand Linking', 'Rosso Linking'),
    Joi.array().items(Joi.string().valid('Auto Linking', 'Hand Linking', 'Rosso Linking'))
  ).optional(),
  brandingType: Joi.alternatives().try(
    Joi.string().valid('Heat Transfer', 'Embroidery'),
    Joi.array().items(Joi.string().valid('Heat Transfer', 'Embroidery'))
  ).optional(),
  priority: Joi.alternatives().try(
    Joi.string().valid('Urgent', 'High', 'Medium', 'Low'),
    Joi.array().items(Joi.string().valid('Urgent', 'High', 'Medium', 'Low'))
  ).optional(),
  shift: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional()
};

/**
 * Validation for dashboard summary endpoint
 */
export const getSummary = {
  query: Joi.object().keys({
    ...dateRangeSchema,
    ...filterSchema
  })
};

/**
 * Validation for floors heatstrip endpoint
 */
export const getFloors = {
  query: Joi.object().keys({
    ...dateRangeSchema,
    ...filterSchema
  })
};

/**
 * Validation for trends endpoint
 */
export const getTrends = {
  query: Joi.object().keys({
    ...dateRangeSchema,
    ...filterSchema,
    granularity: Joi.string().valid('daily', 'weekly', 'monthly').optional().default('daily')
  })
};

/**
 * Validation for quality endpoint
 */
export const getQuality = {
  query: Joi.object().keys({
    ...dateRangeSchema,
    ...filterSchema,
    qcFloor: Joi.string().valid('Checking', 'Secondary Checking', 'Final Checking').optional()
  })
};

/**
 * Validation for machines endpoint
 */
export const getMachines = {
  query: Joi.object().keys({
    ...dateRangeSchema,
    ...filterSchema,
    status: Joi.string().valid('Active', 'Idle', 'Under Maintenance').optional(),
    limit: Joi.number().integer().min(1).max(100).optional().default(20)
  })
};

/**
 * Validation for people/shift endpoint
 */
export const getPeople = {
  query: Joi.object().keys({
    ...dateRangeSchema,
    ...filterSchema,
    groupBy: Joi.string().valid('supervisor', 'shift', 'user').optional().default('supervisor')
  })
};

/**
 * Validation for ageing endpoint
 */
export const getAgeing = {
  query: Joi.object().keys({
    ...dateRangeSchema,
    ...filterSchema,
    type: Joi.string().valid('orders', 'articles').optional().default('orders')
  })
};

/**
 * Validation for yarn readiness endpoint
 */
export const getYarnReadiness = {
  query: Joi.object().keys({
    ...dateRangeSchema,
    ...filterSchema
  })
};

/**
 * Validation for articles performance endpoint
 */
export const getArticles = {
  query: Joi.object().keys({
    ...dateRangeSchema,
    ...filterSchema,
    sortBy: Joi.string().valid('volume', 'defects', 'cycleTime').optional().default('volume'),
    limit: Joi.number().integer().min(1).max(50).optional().default(20)
  })
};

/**
 * Validation for alerts endpoint
 */
export const getAlerts = {
  query: Joi.object().keys({
    ...dateRangeSchema,
    severity: Joi.alternatives().try(
      Joi.string().valid('critical', 'warning', 'info'),
      Joi.array().items(Joi.string().valid('critical', 'warning', 'info'))
    ).optional(),
    category: Joi.alternatives().try(
      Joi.string().valid('throughput', 'quality', 'machine', 'material', 'delivery', 'integrity'),
      Joi.array().items(Joi.string().valid('throughput', 'quality', 'machine', 'material', 'delivery', 'integrity'))
    ).optional()
  })
};

/**
 * Validation for exceptions endpoint
 */
export const getExceptions = {
  query: Joi.object().keys({
    ...dateRangeSchema,
    ...filterSchema,
    type: Joi.string().valid(
      'stalled-orders',
      'bottleneck',
      'idle-machines',
      'overloaded-machines',
      'stuck-containers',
      'open-m2-aged',
      'repair-rejected',
      'yarn-blocked',
      'yarn-return-pending',
      'maintenance-due',
      'data-integrity'
    ).required(),
    page: Joi.number().integer().min(1).optional().default(1),
    limit: Joi.number().integer().min(1).max(50).optional().default(20)
  })
};

/**
 * Validation for reconciliation endpoint
 */
export const getReconciliation = {
  query: Joi.object().keys({
    ...dateRangeSchema,
    ...filterSchema
  })
};

/**
 * Validation for export endpoint
 */
export const getExport = {
  query: Joi.object().keys({
    ...dateRangeSchema,
    ...filterSchema,
    format: Joi.string().valid('xlsx', 'pdf').required(),
    sections: Joi.alternatives().try(
      Joi.string(),
      Joi.array().items(Joi.string())
    ).optional()
  })
};

export default {
  getSummary,
  getFloors,
  getTrends,
  getQuality,
  getMachines,
  getPeople,
  getAgeing,
  getYarnReadiness,
  getArticles,
  getAlerts,
  getExceptions,
  getReconciliation,
  getExport
};
