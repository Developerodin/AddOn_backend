import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import catchAsync from '../utils/catchAsync.js';
import * as analyticsService from '../services/analytics.service.js';

/**
 * Get time-based sales trends
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getTimeBasedSalesTrends = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo', 'groupBy']);
  const trends = await analyticsService.getTimeBasedSalesTrends(filter);
  res.send(trends);
});

/**
 * Get product performance analysis
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getProductPerformanceAnalysis = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo', 'limit', 'sortBy']);
  const performance = await analyticsService.getProductPerformanceAnalysis(filter);
  res.send(performance);
});

/**
 * Get store/plant-wise performance
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getStorePerformanceAnalysis = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo', 'sortBy']);
  const performance = await analyticsService.getStorePerformanceAnalysis(filter);
  res.send(performance);
});

/**
 * Get store heatmap data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getStoreHeatmapData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo']);
  const heatmapData = await analyticsService.getStoreHeatmapData(filter);
  res.send(heatmapData);
});

/**
 * Get brand/division performance
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getBrandPerformanceAnalysis = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo']);
  const performance = await analyticsService.getBrandPerformanceAnalysis(filter);
  res.send(performance);
});

/**
 * Get discount impact analysis
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getDiscountImpactAnalysis = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo']);
  const impact = await analyticsService.getDiscountImpactAnalysis(filter);
  res.send(impact);
});

/**
 * Get tax and MRP analytics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getTaxAndMRPAnalytics = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo']);
  const analytics = await analyticsService.getTaxAndMRPAnalytics(filter);
  res.send(analytics);
});

/**
 * Get summary KPIs
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getSummaryKPIs = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo']);
  const kpis = await analyticsService.getSummaryKPIs(filter);
  res.send(kpis);
});

/**
 * Get comprehensive analytics dashboard
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getAnalyticsDashboard = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo']);
  const dashboard = await analyticsService.getAnalyticsDashboard(filter);
  res.send(dashboard);
}); 