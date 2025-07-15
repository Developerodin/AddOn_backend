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

// Complete time-based sales data
router
  .route('/time-based-trends/complete')
  .get(
    validate(analyticsValidation.getTimeBasedSalesTrends),
    analyticsController.getCompleteTimeBasedSalesData
  );

// Product performance analysis
router
  .route('/product-performance')
  .get(
    validate(analyticsValidation.getProductPerformanceAnalysis),
    analyticsController.getProductPerformanceAnalysis
  );

// Complete product performance data
router
  .route('/product-performance/complete')
  .get(
    validate(analyticsValidation.getProductPerformanceAnalysis),
    analyticsController.getCompleteProductPerformanceData
  );

// Store/plant-wise performance
router
  .route('/store-performance')
  .get(
    validate(analyticsValidation.getStorePerformanceAnalysis),
    analyticsController.getStorePerformanceAnalysis
  );

// Complete store performance data
router
  .route('/store-performance/complete')
  .get(
    validate(analyticsValidation.getStorePerformanceAnalysis),
    analyticsController.getCompleteStorePerformanceData
  );

// Store heatmap data
router
  .route('/store-heatmap')
  .get(
    validate(analyticsValidation.getStoreHeatmapData),
    analyticsController.getStoreHeatmapData
  );

// Complete store heatmap data
router
  .route('/store-heatmap/complete')
  .get(
    validate(analyticsValidation.getStoreHeatmapData),
    analyticsController.getCompleteStoreHeatmapData
  );

// Brand/division performance
router
  .route('/brand-performance')
  .get(
    validate(analyticsValidation.getBrandPerformanceAnalysis),
    analyticsController.getBrandPerformanceAnalysis
  );

// Complete brand performance data
router
  .route('/brand-performance/complete')
  .get(
    validate(analyticsValidation.getBrandPerformanceAnalysis),
    analyticsController.getCompleteBrandPerformanceData
  );

// Discount impact analysis
router
  .route('/discount-impact')
  .get(
    validate(analyticsValidation.getDiscountImpactAnalysis),
    analyticsController.getDiscountImpactAnalysis
  );

// Complete discount impact data
router
  .route('/discount-impact/complete')
  .get(
    validate(analyticsValidation.getDiscountImpactAnalysis),
    analyticsController.getCompleteDiscountImpactData
  );

// Tax and MRP analytics
router
  .route('/tax-mrp-analytics')
  .get(
    validate(analyticsValidation.getTaxAndMRPAnalytics),
    analyticsController.getTaxAndMRPAnalytics
  );

// Complete tax and MRP data
router
  .route('/tax-mrp-analytics/complete')
  .get(
    validate(analyticsValidation.getTaxAndMRPAnalytics),
    analyticsController.getCompleteTaxAndMRPData
  );

// Summary KPIs
router
  .route('/summary-kpis')
  .get(
    validate(analyticsValidation.getSummaryKPIs),
    analyticsController.getSummaryKPIs
  );

// Complete summary KPIs data
router
  .route('/summary-kpis/complete')
  .get(
    validate(analyticsValidation.getSummaryKPIs),
    analyticsController.getCompleteSummaryKPIsData
  );

// Comprehensive analytics dashboard
router
  .route('/dashboard')
  .get(
    validate(analyticsValidation.getAnalyticsDashboard),
    analyticsController.getAnalyticsDashboard
  );

// Complete analytics dashboard data
router
  .route('/dashboard/complete')
  .get(
    validate(analyticsValidation.getAnalyticsDashboard),
    analyticsController.getCompleteAnalyticsDashboardData
  );

// Individual store analysis
router
  .route('/store-analysis')
  .get(
    validate(analyticsValidation.getIndividualStoreAnalysis),
    analyticsController.getIndividualStoreAnalysis
  );

// Complete individual store analysis data
router
  .route('/store-analysis/complete')
  .get(
    validate(analyticsValidation.getIndividualStoreAnalysis),
    analyticsController.getCompleteIndividualStoreAnalysisData
  );

// Individual product analysis
router
  .route('/product-analysis')
  .get(
    validate(analyticsValidation.getIndividualProductAnalysis),
    analyticsController.getIndividualProductAnalysis
  );

// Complete individual product analysis data
router
  .route('/product-analysis/complete')
  .get(
    validate(analyticsValidation.getIndividualProductAnalysis),
    analyticsController.getCompleteIndividualProductAnalysisData
  );

// Store demand forecasting
router
  .route('/store-forecasting')
  .get(
    validate(analyticsValidation.getStoreDemandForecasting),
    analyticsController.getStoreDemandForecasting
  );

// Complete store demand forecasting data
router
  .route('/store-forecasting/complete')
  .get(
    validate(analyticsValidation.getStoreDemandForecasting),
    analyticsController.getCompleteStoreDemandForecastingData
  );

// Product demand forecasting
router
  .route('/product-forecasting')
  .get(
    validate(analyticsValidation.getProductDemandForecasting),
    analyticsController.getProductDemandForecasting
  );

// Complete product demand forecasting data
router
  .route('/product-forecasting/complete')
  .get(
    validate(analyticsValidation.getProductDemandForecasting),
    analyticsController.getCompleteProductDemandForecastingData
  );

// Store replenishment recommendations
router
  .route('/store-replenishment')
  .get(
    validate(analyticsValidation.getStoreReplenishmentRecommendations),
    analyticsController.getStoreReplenishmentRecommendations
  );

// Complete store replenishment data
router
  .route('/store-replenishment/complete')
  .get(
    validate(analyticsValidation.getStoreReplenishmentRecommendations),
    analyticsController.getCompleteStoreReplenishmentData
  );

// Product replenishment recommendations
router
  .route('/product-replenishment')
  .get(
    validate(analyticsValidation.getProductReplenishmentRecommendations),
    analyticsController.getProductReplenishmentRecommendations
  );

// Complete product replenishment data
router
  .route('/product-replenishment/complete')
  .get(
    validate(analyticsValidation.getProductReplenishmentRecommendations),
    analyticsController.getCompleteProductReplenishmentData
  );

export default router; 