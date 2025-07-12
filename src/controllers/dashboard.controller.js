import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import dashboardService from '../services/dashboard.service.js';

const getDashboardData = catchAsync(async (req, res) => {
  const dashboardData = await dashboardService.getDashboardData(req.query);
  res.status(httpStatus.OK).json({
    status: 'success',
    data: dashboardData,
  });
});

const getSalesAnalytics = catchAsync(async (req, res) => {
  const { period = 'week', startDate, endDate } = req.query;
  const analytics = await dashboardService.getSalesAnalytics(period, startDate, endDate);
  res.status(httpStatus.OK).json({
    status: 'success',
    data: analytics,
  });
});

const getStorePerformance = catchAsync(async (req, res) => {
  const { limit = 5 } = req.query;
  const performance = await dashboardService.getStorePerformance(limit);
  res.status(httpStatus.OK).json({
    status: 'success',
    data: performance,
  });
});

const getCategoryAnalytics = catchAsync(async (req, res) => {
  const { period = 'month' } = req.query;
  const analytics = await dashboardService.getCategoryAnalytics(period);
  res.status(httpStatus.OK).json({
    status: 'success',
    data: analytics,
  });
});

const getCityPerformance = catchAsync(async (req, res) => {
  const performance = await dashboardService.getCityPerformance();
  res.status(httpStatus.OK).json({
    status: 'success',
    data: performance,
  });
});

const getDemandForecast = catchAsync(async (req, res) => {
  const { period = 'month' } = req.query;
  const forecast = await dashboardService.getDemandForecast(period);
  res.status(httpStatus.OK).json({
    status: 'success',
    data: forecast,
  });
});

const getTopProducts = catchAsync(async (req, res) => {
  const { limit = 5, period = 'month' } = req.query;
  const products = await dashboardService.getTopProducts(limit, period);
  res.status(httpStatus.OK).json({
    status: 'success',
    data: products,
  });
});

const getAllStoresPerformance = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;
  const performance = await dashboardService.getAllStoresPerformance(startDate, endDate);
  res.status(httpStatus.OK).json({
    status: 'success',
    data: performance,
  });
});

const getAllProductsPerformance = catchAsync(async (req, res) => {
  const { period = 'month', startDate, endDate } = req.query;
  const performance = await dashboardService.getAllProductsPerformance(period, startDate, endDate);
  res.status(httpStatus.OK).json({
    status: 'success',
    data: performance,
  });
});

const getAllSalesData = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;
  const salesData = await dashboardService.getAllSalesData(startDate, endDate);
  res.status(httpStatus.OK).json({
    status: 'success',
    data: salesData,
  });
});

const getAllCategoriesAnalytics = catchAsync(async (req, res) => {
  const { period = 'month', startDate, endDate } = req.query;
  const analytics = await dashboardService.getAllCategoriesAnalytics(period, startDate, endDate);
  res.status(httpStatus.OK).json({
    status: 'success',
    data: analytics,
  });
});

const getAllCitiesPerformance = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;
  const performance = await dashboardService.getAllCitiesPerformance(startDate, endDate);
  res.status(httpStatus.OK).json({
    status: 'success',
    data: performance,
  });
});

export default {
  getDashboardData,
  getSalesAnalytics,
  getStorePerformance,
  getCategoryAnalytics,
  getCityPerformance,
  getDemandForecast,
  getTopProducts,
  getAllStoresPerformance,
  getAllProductsPerformance,
  getAllSalesData,
  getAllCategoriesAnalytics,
  getAllCitiesPerformance,
}; 