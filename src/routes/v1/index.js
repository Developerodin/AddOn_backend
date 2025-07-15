import express from 'express';
import authRoute from './auth.route.js';
import userRoute from './user.route.js';
import docsRoute from './docs.route.js';
import productAttributeRoute from './productAttribute.route.js';
import rawMaterialRoute from './rawMaterial.route.js';
import categoryRoute from './category.route.js';
import processRoute from './process.route.js';
import productRoute from './product.route.js';
import storeRoute from './store.route.js';
import commonRoute from './common.route.js';
import sealsExcelMasterRoute from './sealsExcelMaster.route.js';
import salesRoute from './sales.route.js';
import analyticsRoute from './analytics.route.js';
import dashboardRoute from './dashboard.route.js';
import fileManagerRoute from './fileManager.route.js';
import forecastRoute from './forecast.route.js';
import replenishmentRoute from './replenishment.route.js';
import config from '../../config/config.js';

const router = express.Router();

const defaultRoutes = [
  {
    path: '/auth',
    route: authRoute,
  },
  {
    path: '/users',
    route: userRoute,
  },
  {
    path: '/product-attributes',
    route: productAttributeRoute,
  },
  {
    path: '/raw-materials',
    route: rawMaterialRoute,
  },
  {
    path: '/categories',
    route: categoryRoute,
  },
  {
    path: '/processes',
    route: processRoute,
  },
  {
    path: '/products',
    route: productRoute,
  },
  {
    path: '/stores',
    route: storeRoute,
  },
  {
    path: '/common',
    route: commonRoute,
  },
  {
    path: '/seals-excel-master',
    route: sealsExcelMasterRoute,
  },
  {
    path: '/sales',
    route: salesRoute,
  },
  {
    path: '/analytics',
    route: analyticsRoute,
  },
  {
    path: '/dashboard',
    route: dashboardRoute,
  },
  {
    path: '/file-manager',
    route: fileManagerRoute,
  },
  {
    path: '/forecasts',
    route: forecastRoute,
  },
  {
    path: '/replenishment',
    route: replenishmentRoute,
  },
];

const devRoutes = [
  // routes available only in development mode
  {
    path: '/docs',
    route: docsRoute,
  },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

/* istanbul ignore next */
if (config.env === 'development') {
  devRoutes.forEach((route) => {
    router.use(route.path, route.route);
  });
}

export default router;
