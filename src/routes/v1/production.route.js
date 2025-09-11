import express from 'express';
import validate from '../../middlewares/validate.js';
import { bulkImportMiddleware, validateBulkImportSize } from '../../middlewares/bulkImport.js';
import * as productionValidation from '../../validations/production.validation.js';
import * as productionController from '../../controllers/production.controller.js';

const router = express.Router();

// ==================== ORDER MANAGEMENT ROUTES ====================

router
  .route('/orders')
  .post(validate(productionValidation.createProductionOrder), productionController.createProductionOrder)
  .get(validate(productionValidation.getProductionOrders), productionController.getProductionOrders);

router
  .route('/orders/bulk-create')
  .post(
    bulkImportMiddleware,
    validateBulkImportSize,
    validate(productionValidation.bulkCreateOrders),
    productionController.bulkCreateOrders
  );

router
  .route('/orders/:orderId')
  .get(validate(productionValidation.getProductionOrder), productionController.getProductionOrder)
  .patch(validate(productionValidation.updateProductionOrder), productionController.updateProductionOrder)
  .delete(validate(productionValidation.deleteProductionOrder), productionController.deleteProductionOrder);

// ==================== FLOOR OPERATIONS ROUTES ====================

router
  .route('/floors/:floor/orders')
  .get(validate(productionValidation.getFloorOrders), productionController.getFloorOrders);

router
  .route('/floors/:floor/orders/:orderId/articles/:articleId')
  .patch(validate(productionValidation.updateArticleProgress), productionController.updateArticleProgress);

router
  .route('/floors/:floor/transfer')
  .post(validate(productionValidation.transferArticle), productionController.transferArticle);

router
  .route('/floors/:floor/statistics')
  .get(validate(productionValidation.getFloorStatistics), productionController.getFloorStatistics);

// ==================== QUALITY CONTROL ROUTES ====================

router
  .route('/floors/final-checking/quality/:articleId')
  .patch(validate(productionValidation.updateQualityCategories), productionController.updateQualityCategories);

router
  .route('/floors/final-checking/shift-m2')
  .post(validate(productionValidation.shiftM2Items), productionController.shiftM2Items);

router
  .route('/floors/final-checking/confirm-quality')
  .post(validate(productionValidation.confirmFinalQuality), productionController.confirmFinalQuality);

router
  .route('/floors/final-checking/forward-to-warehouse')
  .post(validate(productionValidation.forwardToWarehouse), productionController.forwardToWarehouse);

// ==================== REPORTS AND ANALYTICS ROUTES ====================

router
  .route('/dashboard')
  .get(validate(productionValidation.getProductionDashboard), productionController.getProductionDashboard);

router
  .route('/reports/efficiency')
  .get(validate(productionValidation.getEfficiencyReport), productionController.getEfficiencyReport);

router
  .route('/reports/quality')
  .get(validate(productionValidation.getQualityReport), productionController.getQualityReport);

router
  .route('/reports/order-tracking/:orderId')
  .get(validate(productionValidation.getOrderTrackingReport), productionController.getOrderTrackingReport);

// ==================== LOGGING AND AUDIT ROUTES ====================

router
  .route('/logs/article/:articleId')
  .get(validate(productionValidation.getArticleLogs), productionController.getArticleLogs);

router
  .route('/logs/order/:orderId')
  .get(validate(productionValidation.getOrderLogs), productionController.getOrderLogs);

router
  .route('/logs/floor/:floor')
  .get(validate(productionValidation.getFloorLogs), productionController.getFloorLogs);

router
  .route('/logs/user/:userId')
  .get(validate(productionValidation.getUserLogs), productionController.getUserLogs);

router
  .route('/logs/statistics')
  .get(validate(productionValidation.getLogStatistics), productionController.getLogStatistics);

router
  .route('/logs/audit-trail/:orderId')
  .get(validate(productionValidation.getAuditTrail), productionController.getAuditTrail);


// ==================== BULK OPERATIONS ROUTES ====================

router
  .route('/bulk/update-articles')
  .post(
    bulkImportMiddleware,
    validateBulkImportSize,
    validate(productionValidation.bulkUpdateArticles),
    productionController.bulkUpdateArticles
  );

export default router;
