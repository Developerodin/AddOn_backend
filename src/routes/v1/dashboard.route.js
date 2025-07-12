import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import dashboardValidation from '../../validations/dashboard.validation.js';
import dashboardController from '../../controllers/dashboard.controller.js';

const router = express.Router();

router
  .route('/')
  .get(

    validate(dashboardValidation.getDashboardData),
    dashboardController.getDashboardData
  );

router
  .route('/sales-analytics')
  .get(

    validate(dashboardValidation.getSalesAnalytics),
    dashboardController.getSalesAnalytics
  );

router
  .route('/store-performance')
  .get(
 
    validate(dashboardValidation.getStorePerformance),
    dashboardController.getStorePerformance
  );

router
  .route('/category-analytics')
  .get(
 
    validate(dashboardValidation.getCategoryAnalytics),
    dashboardController.getCategoryAnalytics
  );

router
  .route('/city-performance')
  .get(

    validate(dashboardValidation.getCityPerformance),
    dashboardController.getCityPerformance
  );

router
  .route('/demand-forecast')
  .get(

    validate(dashboardValidation.getDemandForecast),
    dashboardController.getDemandForecast
  );

router
  .route('/top-products')
  .get(
 
    validate(dashboardValidation.getTopProducts),
    dashboardController.getTopProducts
  );

router
  .route('/all-stores-performance')
  .get(
    validate(dashboardValidation.getAllStoresPerformance),
    dashboardController.getAllStoresPerformance
  );

router
  .route('/all-products-performance')
  .get(
    validate(dashboardValidation.getAllProductsPerformance),
    dashboardController.getAllProductsPerformance
  );

router
  .route('/all-sales-data')
  .get(
    validate(dashboardValidation.getAllSalesData),
    dashboardController.getAllSalesData
  );

router
  .route('/all-categories-analytics')
  .get(
    validate(dashboardValidation.getAllCategoriesAnalytics),
    dashboardController.getAllCategoriesAnalytics
  );

router
  .route('/all-cities-performance')
  .get(
    validate(dashboardValidation.getAllCitiesPerformance),
    dashboardController.getAllCitiesPerformance
  );

export default router; 