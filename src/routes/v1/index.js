import express from 'express';
import authRoute from './auth.route.js';
import userRoute from './user.route.js';
import docsRoute from './docs.route.js';
import productAttributeRoute from './productAttribute.route.js';
import rawMaterialRoute from './rawMaterial.route.js';
import categoryRoute from './category.route.js';
import processRoute from './process.route.js';
import productRoute from './product.route.js';
import styleCodeRoute from './styleCode.route.js';
import storeRoute from './store.route.js';
import commonRoute from './common.route.js';
import sealsExcelMasterRoute from './sealsExcelMaster.route.js';
import salesRoute from './sales.route.js';
import analyticsRoute from './analytics.route.js';
import dashboardRoute from './dashboard.route.js';
import fileManagerRoute from './fileManager.route.js';
import forecastRoute from './forecast.route.js';
import replenishmentRoute from './replenishment.route.js';
import chatbotRoute from './chatbot.route.js';
import faqRoute from './faq.route.js';
import productionRoute from './production.route.js';
import machineRoute from './machine.route.js';
import orderRoute from './order.route.js';
import colorRoute from './color.route.js';
import countSizeRoute from './countSize.route.js';
import blendRoute from './blend.route.js';
import yarnReceivingRoute from './yarn/yarnReceiving.route.js';
import yarnTypeRoute from './yarnType.route.js';
import supplierRoute from './supplier.route.js';
import yarnCatalogRoute from './yarnCatalog.route.js';
import yarnPurchaseOrderRoute from './yarn/yarnPurchaseOrder.route.js';
import yarnBoxRoute from './yarn/yarnBox.route.js';
import yarnConeRoute from './yarn/yarnCone.route.js';
import yarnTransactionRoute from './yarn/yarnTransaction.route.js';
import yarnInventoryRoute from './yarn/yarnInventory.route.js';
import storageRoute from './storage.route.js';
import yarnReqRoute from './yarn/yarnReq.route.js';
import vendorRoute from './vendor.route.js';
import teamMasterRoute from './teamMaster.route.js';
import containersMasterRoute from './containersMaster.route.js';
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
    path: '/style-codes',
    route: styleCodeRoute,
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
  {
    path: '/chatbot',
    route: chatbotRoute,
  },
  {
    path: '/faq',
    route: faqRoute,
  },
  {
    path: '/production',
    route: productionRoute,
  },
  {
    path: '/machines',
    route: machineRoute,
  },
  {
    path: '/orders',
    route: orderRoute,
  },
  {
    path: '/yarn-management/colors',
    route: colorRoute,
  },
  {
    path: '/yarn-management/count-sizes',
    route: countSizeRoute,
  },
  {
    path: '/yarn-management/blends',
    route: blendRoute,
  },
  {
    path: '/yarn-management/yarn-types',
    route: yarnTypeRoute,
  },
  {
    path: '/yarn-management/suppliers',
    route: supplierRoute,
  },
  {
    path: '/yarn-management/yarn-catalogs',
    route: yarnCatalogRoute,
  },
  {
    path: '/yarn-management/yarn-requisitions',
    route: yarnReqRoute,
  },
  {
    path: '/yarn-management/yarn-purchase-orders',
    route: yarnPurchaseOrderRoute,
  },
  {
    path: '/yarn-management/yarn-boxes',
    route: yarnBoxRoute,
  },
  {
    path: '/yarn-management/yarn-cones',
    route: yarnConeRoute,
  },
  {
    path: '/yarn-management/yarn-transactions',
    route: yarnTransactionRoute,
  },
  {
    path: '/yarn-management/yarn-inventories',
    route: yarnInventoryRoute,
  },
   {
    path: '/yarn-management/yarn-receiving',
    route: yarnReceivingRoute,
  },
  {
    path: '/storage',
    route: storageRoute,
  },
  {
    path: '/vendors',
    route: vendorRoute,
  },
  {
    path: '/team-masters',
    route: teamMasterRoute,
  },
  {
    path: '/containers-masters',
    route: containersMasterRoute,
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
