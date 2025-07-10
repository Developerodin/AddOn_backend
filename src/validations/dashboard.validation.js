import Joi from 'joi';

const getDashboardData = {
  query: Joi.object().keys({
    period: Joi.string().valid('week', 'month', 'quarter').default('week'),
  }),
};

const getSalesAnalytics = {
  query: Joi.object().keys({
    period: Joi.string().valid('week', 'month', 'quarter').default('week'),
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')),
  }),
};

const getStorePerformance = {
  query: Joi.object().keys({
    limit: Joi.number().integer().min(1).max(50).default(5),
  }),
};

const getCategoryAnalytics = {
  query: Joi.object().keys({
    period: Joi.string().valid('week', 'month', 'quarter').default('month'),
  }),
};

const getCityPerformance = {
  query: Joi.object().keys({}),
};

const getDemandForecast = {
  query: Joi.object().keys({
    period: Joi.string().valid('week', 'month', 'quarter').default('month'),
  }),
};

const getTopProducts = {
  query: Joi.object().keys({
    limit: Joi.number().integer().min(1).max(50).default(5),
    period: Joi.string().valid('week', 'month', 'quarter').default('month'),
  }),
};

export default {
  getDashboardData,
  getSalesAnalytics,
  getStorePerformance,
  getCategoryAnalytics,
  getCityPerformance,
  getDemandForecast,
  getTopProducts,
}; 