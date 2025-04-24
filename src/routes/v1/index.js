import express from 'express';
import authRoute from './auth.route.js';
import userRoute from './user.route.js';
import docsRoute from './docs.route.js';
import productAttributeRoute from './productAttribute.route.js';
import rawMaterialRoute from './rawMaterial.route.js';
import categoryRoute from './category.route.js';
import processRoute from './process.route.js';
import productRoute from './product.route.js';
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
