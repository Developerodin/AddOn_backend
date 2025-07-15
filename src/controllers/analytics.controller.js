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
 * Get complete time-based sales data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteTimeBasedSalesData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo', 'groupBy']);
  const completeData = await analyticsService.getCompleteTimeBasedSalesData(filter);
  res.send(completeData);
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
 * Get complete product performance data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteProductPerformanceData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo', 'sortBy']);
  const completeData = await analyticsService.getCompleteProductPerformanceData(filter);
  res.send(completeData);
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
 * Get complete store performance data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteStorePerformanceData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo', 'sortBy']);
  const completeData = await analyticsService.getCompleteStorePerformanceData(filter);
  res.send(completeData);
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
 * Get complete store heatmap data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteStoreHeatmapData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo']);
  const completeData = await analyticsService.getCompleteStoreHeatmapData(filter);
  res.send(completeData);
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
 * Get complete brand performance data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteBrandPerformanceData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo']);
  const completeData = await analyticsService.getCompleteBrandPerformanceData(filter);
  res.send(completeData);
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
 * Get complete discount impact data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteDiscountImpactData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo']);
  const completeData = await analyticsService.getCompleteDiscountImpactData(filter);
  res.send(completeData);
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
 * Get complete tax and MRP data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteTaxAndMRPData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo']);
  const completeData = await analyticsService.getCompleteTaxAndMRPData(filter);
  res.send(completeData);
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
 * Get complete summary KPIs data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteSummaryKPIsData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo']);
  const completeData = await analyticsService.getCompleteSummaryKPIsData(filter);
  res.send(completeData);
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

/**
 * Get complete analytics dashboard data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteAnalyticsDashboardData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['dateFrom', 'dateTo']);
  const completeData = await analyticsService.getCompleteAnalyticsDashboardData(filter);
  res.send(completeData);
});

/**
 * Get individual store analysis
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getIndividualStoreAnalysis = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['storeId', 'dateFrom', 'dateTo']);
  const analysis = await analyticsService.getIndividualStoreAnalysis(filter);
  res.send(analysis);
});

/**
 * Get complete individual store analysis data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteIndividualStoreAnalysisData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['storeId', 'dateFrom', 'dateTo']);
  const completeData = await analyticsService.getCompleteIndividualStoreAnalysisData(filter);
  res.send(completeData);
});

/**
 * Get individual product analysis
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getIndividualProductAnalysis = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['productId', 'dateFrom', 'dateTo']);
  const analysis = await analyticsService.getIndividualProductAnalysis(filter);
  res.send(analysis);
});

/**
 * Get complete individual product analysis data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteIndividualProductAnalysisData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['productId', 'dateFrom', 'dateTo']);
  const completeData = await analyticsService.getCompleteIndividualProductAnalysisData(filter);
  res.send(completeData);
});

/**
 * Get store demand forecasting
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getStoreDemandForecasting = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['storeId', 'months']);
  const forecasting = await analyticsService.getStoreDemandForecasting(filter);
  res.send(forecasting);
});

/**
 * Get complete store demand forecasting data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteStoreDemandForecastingData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['storeId', 'months']);
  const completeData = await analyticsService.getCompleteStoreDemandForecastingData(filter);
  res.send(completeData);
});

/**
 * Get product demand forecasting
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getProductDemandForecasting = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['productId', 'months']);
  const forecasting = await analyticsService.getProductDemandForecasting(filter);
  res.send(forecasting);
});

/**
 * Get complete product demand forecasting data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteProductDemandForecastingData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['productId', 'months']);
  const completeData = await analyticsService.getCompleteProductDemandForecastingData(filter);
  res.send(completeData);
});

/**
 * Get store replenishment recommendations
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getStoreReplenishmentRecommendations = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['storeId']);
  const recommendations = await analyticsService.getStoreReplenishmentRecommendations(filter);
  res.send(recommendations);
});

/**
 * Get complete store replenishment data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteStoreReplenishmentData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['storeId']);
  const completeData = await analyticsService.getCompleteStoreReplenishmentData(filter);
  res.send(completeData);
});

/**
 * Get product replenishment recommendations
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getProductReplenishmentRecommendations = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['productId']);
  const recommendations = await analyticsService.getProductReplenishmentRecommendations(filter);
  res.send(recommendations);
});

/**
 * Get complete product replenishment data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getCompleteProductReplenishmentData = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['productId']);
  const completeData = await analyticsService.getCompleteProductReplenishmentData(filter);
  res.send(completeData);
});

// Enhanced Analytics for Replenishment Dashboard

/**
 * Get enhanced trends data for Forecast vs Actual Trends chart
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getEnhancedTrends = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['startMonth', 'endMonth', 'store', 'product']);
  const trends = await analyticsService.getEnhancedTrends(filter);
  res.send(trends);
});

/**
 * Get accuracy distribution data for pie/donut charts
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getAccuracyDistribution = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['store', 'product', 'month']);
  const distribution = await analyticsService.getAccuracyDistribution(filter);
  res.send(distribution);
});

/**
 * Get performance analytics for stores or products
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getPerformanceAnalytics = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['type', 'limit', 'month']);
  const performance = await analyticsService.getPerformanceAnalytics(filter);
  res.send(performance);
});

/**
 * Get replenishment analytics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getReplenishmentAnalytics = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['store', 'product', 'month']);
  const analytics = await analyticsService.getReplenishmentAnalytics(filter);
  res.send(analytics);
});

// Legacy analytics functions (keeping for backward compatibility)
export const getAccuracy = catchAsync(async (req, res) => {
  res.json({ accuracy: 87.5, details: [] });
});

export const getTrends = catchAsync(async (req, res) => {
  res.json({ trends: [] });
});

export const getSummary = catchAsync(async (req, res) => {
  res.json({ totalForecasts: 0, avgAccuracy: 0, totalReplenishment: 0 });
}); 