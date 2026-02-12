import express from 'express';
import validate from '../../middlewares/validate.js';
import { bulkImportMiddleware, validateBulkImportSize } from '../../middlewares/bulkImport.js';
import * as productionValidation from '../../validations/production.validation.js';
import * as machineOrderAssignmentValidation from '../../validations/machineOrderAssignment.validation.js';
import * as productionController from '../../controllers/production.controller.js';

const router = express.Router();

// ==================== MACHINE ORDER ASSIGNMENTS ====================

router
  .route('/machine-order-assignments')
  .post(validate(machineOrderAssignmentValidation.createMachineOrderAssignment), productionController.createMachineOrderAssignment)
  .get(validate(machineOrderAssignmentValidation.getMachineOrderAssignments), productionController.getMachineOrderAssignments);

router
  .route('/machine-order-assignments/logs/user/:userId')
  .get(validate(machineOrderAssignmentValidation.getAssignmentLogsByUser), productionController.getAssignmentLogsByUser);

router
  .route('/machine-order-assignments/:assignmentId/reset')
  .post(validate(machineOrderAssignmentValidation.resetMachineOrderAssignment), productionController.resetMachineOrderAssignment);

router
  .route('/machine-order-assignments/:assignmentId')
  .get(validate(machineOrderAssignmentValidation.getMachineOrderAssignment), productionController.getMachineOrderAssignment)
  .patch(validate(machineOrderAssignmentValidation.updateMachineOrderAssignment), productionController.updateMachineOrderAssignment)
  .delete(validate(machineOrderAssignmentValidation.deleteMachineOrderAssignment), productionController.deleteMachineOrderAssignment);

router
  .route('/machine-order-assignments/:assignmentId/logs')
  .get(validate(machineOrderAssignmentValidation.getAssignmentLogs), productionController.getAssignmentLogs);

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

// ==================== UTILITY ROUTES ====================

router
  .route('/fix-completion-status')
  .post(productionController.fixCompletionStatus);

router
  .route('/fix-completion-status/:orderId')
  .post(productionController.fixCompletionStatusForOrder);

// ==================== QUALITY CONTROL ROUTES ====================

// Quality categories update for both Checking and Final Checking floors
router
  .route('/floors/:floor/quality/:articleId')
  .patch(validate(productionValidation.updateQualityCategories), productionController.updateQualityCategories);

// M2 repair transfer (transfer M2 back to previous floor for repair)
router
  .route('/floors/:floor/repair/:orderId/articles/:articleId')
  .post(validate(productionValidation.transferM2ForRepair), productionController.transferM2ForRepair);

// M2 shifting (primarily for Final Checking, but can work for Checking too)
router
  .route('/floors/:floor/shift-m2')
  .post(validate(productionValidation.shiftM2Items), productionController.shiftM2Items);

// Final quality confirmation (Final Checking only)
router
  .route('/floors/final-checking/confirm-quality')
  .post(validate(productionValidation.confirmFinalQuality), productionController.confirmFinalQuality);

// Forward to warehouse (Final Checking only)
router
  .route('/floors/final-checking/forward-to-warehouse')
  .post(validate(productionValidation.forwardToWarehouse), productionController.forwardToWarehouse);

// Direct article quality inspection (works for any floor)
router
  .route('/articles/:articleId/quality-inspection')
  .post(validate(productionValidation.qualityInspection), productionController.qualityInspection);

// Fix data corruption for specific article
router
  .route('/articles/:articleId/fix-corruption')
  .post(productionController.fixDataCorruption);

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

router
  .route('/reports/article-wise')
  .get(validate(productionValidation.getArticleWiseData), productionController.getArticleWiseData);

// ==================== LOGGING AND AUDIT ROUTES ====================

router
  .route('/logs/article/:articleId')
  .get(validate(productionValidation.getArticleLogs), productionController.getArticleLogs);

// Test log creation endpoint
router
  .route('/logs/test')
  .post(productionController.createTestLog);

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
