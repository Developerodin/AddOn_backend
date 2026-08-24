import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as productionDashboardService from '../../services/production/productionDashboard.service.js';

/**
 * Parse filter parameters from query string
 */
const parseFilters = (query) => {
  const filters = {};
  
  // Date range
  if (query.from) filters.from = query.from;
  if (query.to) filters.to = query.to;
  if (query.compare) filters.compare = query.compare;
  
  // Array filters (convert string to array if needed)
  ['order', 'article', 'floor', 'machine', 'linkingType', 'brandingType', 'priority', 'shift'].forEach(key => {
    if (query[key]) {
      filters[key] = Array.isArray(query[key]) ? query[key] : [query[key]];
    }
  });
  
  return filters;
};

/**
 * Build response envelope
 */
const buildEnvelope = (data, meta = {}) => {
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      cached: meta.cached || false,
      cacheAgeMs: meta.cacheAgeMs || 0,
      durationMs: meta.durationMs || 0,
      ...meta
    },
    data,
    warnings: meta.warnings || []
  };
};

/**
 * Get dashboard summary (Zones A + B)
 * Headline KPIs + Order funnel
 */
export const getSummary = catchAsync(async (req, res) => {
  const startTime = Date.now();
  const filters = parseFilters(req.query);
  
  const result = await productionDashboardService.getDashboardSummary(filters);
  
  res.status(httpStatus.OK).json(buildEnvelope(result.data, {
    cached: result.cached,
    cacheAgeMs: result.cacheAgeMs,
    durationMs: Date.now() - startTime,
    range: result.range,
    asOf: result.asOf
  }));
});

/**
 * Get floor heatstrip data (Zone C)
 * 12 floors x 9 metrics
 */
export const getFloors = catchAsync(async (req, res) => {
  const startTime = Date.now();
  const filters = parseFilters(req.query);
  
  const result = await productionDashboardService.getFloorHeatstrip(filters);
  
  res.status(httpStatus.OK).json(buildEnvelope(result.data, {
    cached: result.cached,
    cacheAgeMs: result.cacheAgeMs,
    durationMs: Date.now() - startTime,
    asOf: result.asOf,
    warnings: result.warnings
  }));
});

/**
 * Get throughput and cycle time trends (Zone D)
 */
export const getTrends = catchAsync(async (req, res) => {
  const startTime = Date.now();
  const filters = parseFilters(req.query);
  const granularity = req.query.granularity || 'daily';
  
  const result = await productionDashboardService.getThroughputTrends(filters, granularity);
  
  res.status(httpStatus.OK).json(buildEnvelope(result.data, {
    cached: result.cached,
    cacheAgeMs: result.cacheAgeMs,
    durationMs: Date.now() - startTime,
    range: result.range
  }));
});

/**
 * Get quality metrics (Zone E)
 * FPY, RTY, M-mix, Pareto, M2 recovery
 */
export const getQuality = catchAsync(async (req, res) => {
  const startTime = Date.now();
  const filters = parseFilters(req.query);
  const qcFloor = req.query.qcFloor;
  
  const result = await productionDashboardService.getQualityMetrics(filters, qcFloor);
  
  res.status(httpStatus.OK).json(buildEnvelope(result.data, {
    cached: result.cached,
    cacheAgeMs: result.cacheAgeMs,
    durationMs: Date.now() - startTime,
    asOf: result.asOf
  }));
});

/**
 * Get machine utilization data (Zone F)
 * Capacity vs load, status, maintenance
 */
export const getMachines = catchAsync(async (req, res) => {
  const startTime = Date.now();
  const filters = parseFilters(req.query);
  const status = req.query.status;
  const limit = parseInt(req.query.limit) || 20;
  
  const result = await productionDashboardService.getMachineUtilization(filters, { status, limit });
  
  res.status(httpStatus.OK).json(buildEnvelope(result.data, {
    cached: result.cached,
    cacheAgeMs: result.cacheAgeMs,
    durationMs: Date.now() - startTime,
    asOf: result.asOf
  }));
});

/**
 * Get people and shift metrics (Zone G)
 * Supervisor/shift performance
 */
export const getPeople = catchAsync(async (req, res) => {
  const startTime = Date.now();
  const filters = parseFilters(req.query);
  const groupBy = req.query.groupBy || 'supervisor';
  
  const result = await productionDashboardService.getPeopleMetrics(filters, groupBy);
  
  res.status(httpStatus.OK).json(buildEnvelope(result.data, {
    cached: result.cached,
    cacheAgeMs: result.cacheAgeMs,
    durationMs: Date.now() - startTime,
    range: result.range
  }));
});

/**
 * Get order ageing data (Zone H)
 * Age buckets for orders and articles
 */
export const getAgeing = catchAsync(async (req, res) => {
  const startTime = Date.now();
  const filters = parseFilters(req.query);
  const type = req.query.type || 'orders';
  
  const result = await productionDashboardService.getOrderAgeing(filters, type);
  
  res.status(httpStatus.OK).json(buildEnvelope(result.data, {
    cached: result.cached,
    cacheAgeMs: result.cacheAgeMs,
    durationMs: Date.now() - startTime,
    asOf: result.asOf
  }));
});

/**
 * Get yarn readiness data (Zone I)
 * Cross-module yarn blocking info
 */
export const getYarnReadiness = catchAsync(async (req, res) => {
  const startTime = Date.now();
  const filters = parseFilters(req.query);
  
  const result = await productionDashboardService.getYarnReadiness(filters);
  
  res.status(httpStatus.OK).json(buildEnvelope(result.data, {
    cached: result.cached,
    cacheAgeMs: result.cacheAgeMs,
    durationMs: Date.now() - startTime,
    asOf: result.asOf
  }));
});

/**
 * Get article performance data (Zone J)
 * Top/slowest/highest-defect articles
 */
export const getArticles = catchAsync(async (req, res) => {
  const startTime = Date.now();
  const filters = parseFilters(req.query);
  const sortBy = req.query.sortBy || 'volume';
  const limit = parseInt(req.query.limit) || 20;
  
  const result = await productionDashboardService.getArticlePerformance(filters, { sortBy, limit });
  
  res.status(httpStatus.OK).json(buildEnvelope(result.data, {
    cached: result.cached,
    cacheAgeMs: result.cacheAgeMs,
    durationMs: Date.now() - startTime,
    range: result.range
  }));
});

/**
 * Get alerts (Zone 0)
 * Exception alerts with severity levels
 */
export const getAlerts = catchAsync(async (req, res) => {
  const startTime = Date.now();
  const filters = parseFilters(req.query);
  const severity = req.query.severity ? (Array.isArray(req.query.severity) ? req.query.severity : [req.query.severity]) : undefined;
  const category = req.query.category ? (Array.isArray(req.query.category) ? req.query.category : [req.query.category]) : undefined;
  
  const result = await productionDashboardService.getAlerts(filters, { severity, category });
  
  res.status(httpStatus.OK).json(buildEnvelope(result.data, {
    cached: result.cached,
    cacheAgeMs: result.cacheAgeMs,
    durationMs: Date.now() - startTime,
    asOf: result.asOf
  }));
});

/**
 * Get exception worklist (Zone K)
 * Paginated list of exceptions by type
 */
export const getExceptions = catchAsync(async (req, res) => {
  const startTime = Date.now();
  const filters = parseFilters(req.query);
  const type = req.query.type;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  
  const result = await productionDashboardService.getExceptions(filters, { type, page, limit });
  
  res.status(httpStatus.OK).json(buildEnvelope(result.data, {
    cached: result.cached,
    cacheAgeMs: result.cacheAgeMs,
    durationMs: Date.now() - startTime,
    asOf: result.asOf,
    pagination: result.pagination
  }));
});

/**
 * Get reconciliation ledger (Zone L)
 * Identity checks and unaccounted calculation
 */
export const getReconciliation = catchAsync(async (req, res) => {
  const startTime = Date.now();
  const filters = parseFilters(req.query);
  
  const result = await productionDashboardService.getReconciliation(filters);
  
  res.status(httpStatus.OK).json(buildEnvelope(result.data, {
    cached: result.cached,
    cacheAgeMs: result.cacheAgeMs,
    durationMs: Date.now() - startTime,
    asOf: result.asOf
  }));
});

/**
 * Export dashboard data
 */
export const getExport = catchAsync(async (req, res) => {
  const filters = parseFilters(req.query);
  const format = req.query.format;
  const sections = req.query.sections ? (Array.isArray(req.query.sections) ? req.query.sections : [req.query.sections]) : undefined;
  
  const result = await productionDashboardService.exportDashboard(filters, { format, sections });
  
  if (format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="production-dashboard-${new Date().toISOString().split('T')[0]}.xlsx"`);
  } else {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="production-dashboard-${new Date().toISOString().split('T')[0]}.pdf"`);
  }
  
  res.send(result.buffer);
});

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
