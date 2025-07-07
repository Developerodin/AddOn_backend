import Joi from 'joi';
import { objectId } from './custom.validation.js';

const getTimeBasedSalesTrends = {
  query: Joi.object().keys({
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
    groupBy: Joi.string().valid('day', 'month').default('day'),
  }),
};

const getProductPerformanceAnalysis = {
  query: Joi.object().keys({
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().valid('quantity', 'nsv', 'gsv').default('quantity'),
  }),
};

const getStorePerformanceAnalysis = {
  query: Joi.object().keys({
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
    sortBy: Joi.string().valid('quantity', 'nsv', 'gsv', 'discount', 'tax').default('nsv'),
  }),
};

const getStoreHeatmapData = {
  query: Joi.object().keys({
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
  }),
};

const getBrandPerformanceAnalysis = {
  query: Joi.object().keys({
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
  }),
};

const getDiscountImpactAnalysis = {
  query: Joi.object().keys({
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
  }),
};

const getTaxAndMRPAnalytics = {
  query: Joi.object().keys({
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
  }),
};

const getSummaryKPIs = {
  query: Joi.object().keys({
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
  }),
};

const getAnalyticsDashboard = {
  query: Joi.object().keys({
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
  }),
};

export default {
  getTimeBasedSalesTrends,
  getProductPerformanceAnalysis,
  getStorePerformanceAnalysis,
  getStoreHeatmapData,
  getBrandPerformanceAnalysis,
  getDiscountImpactAnalysis,
  getTaxAndMRPAnalytics,
  getSummaryKPIs,
  getAnalyticsDashboard,
}; 