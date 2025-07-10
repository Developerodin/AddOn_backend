import express from 'express';
import validate from '../../middlewares/validate.js';
import * as analyticsValidation from '../../validations/analytics.validation.js';
import * as analyticsController from '../../controllers/analytics.controller.js';

const router = express.Router();

// Time-based sales trends
router
  .route('/time-based-trends')
  .get(
    validate(analyticsValidation.getTimeBasedSalesTrends),
    analyticsController.getTimeBasedSalesTrends
  );

// Product performance analysis
router
  .route('/product-performance')
  .get(
    validate(analyticsValidation.getProductPerformanceAnalysis),
    analyticsController.getProductPerformanceAnalysis
  );

// Store/plant-wise performance
router
  .route('/store-performance')
  .get(
    validate(analyticsValidation.getStorePerformanceAnalysis),
    analyticsController.getStorePerformanceAnalysis
  );

// Store heatmap data
router
  .route('/store-heatmap')
  .get(
    validate(analyticsValidation.getStoreHeatmapData),
    analyticsController.getStoreHeatmapData
  );

// Brand/division performance
router
  .route('/brand-performance')
  .get(
    validate(analyticsValidation.getBrandPerformanceAnalysis),
    analyticsController.getBrandPerformanceAnalysis
  );

// Discount impact analysis
router
  .route('/discount-impact')
  .get(
    validate(analyticsValidation.getDiscountImpactAnalysis),
    analyticsController.getDiscountImpactAnalysis
  );

// Tax and MRP analytics
router
  .route('/tax-mrp-analytics')
  .get(
    validate(analyticsValidation.getTaxAndMRPAnalytics),
    analyticsController.getTaxAndMRPAnalytics
  );

// Summary KPIs
router
  .route('/summary-kpis')
  .get(
    validate(analyticsValidation.getSummaryKPIs),
    analyticsController.getSummaryKPIs
  );

// Comprehensive analytics dashboard
router
  .route('/dashboard')
  .get(
    validate(analyticsValidation.getAnalyticsDashboard),
    analyticsController.getAnalyticsDashboard
  );

// Individual store analysis
router
  .route('/store-analysis')
  .get(
    validate(analyticsValidation.getIndividualStoreAnalysis),
    analyticsController.getIndividualStoreAnalysis
  );

// Individual product analysis
router
  .route('/product-analysis')
  .get(
    validate(analyticsValidation.getIndividualProductAnalysis),
    analyticsController.getIndividualProductAnalysis
  );

// Store demand forecasting
router
  .route('/store-forecasting')
  .get(
    validate(analyticsValidation.getStoreDemandForecasting),
    analyticsController.getStoreDemandForecasting
  );

// Product demand forecasting
router
  .route('/product-forecasting')
  .get(
    validate(analyticsValidation.getProductDemandForecasting),
    analyticsController.getProductDemandForecasting
  );

// Store replenishment recommendations
router
  .route('/store-replenishment')
  .get(
    validate(analyticsValidation.getStoreReplenishmentRecommendations),
    analyticsController.getStoreReplenishmentRecommendations
  );

// Product replenishment recommendations
router
  .route('/product-replenishment')
  .get(
    validate(analyticsValidation.getProductReplenishmentRecommendations),
    analyticsController.getProductReplenishmentRecommendations
  );

export default router; 