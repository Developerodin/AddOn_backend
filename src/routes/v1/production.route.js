import express from 'express';
import validate from '../../middlewares/validate.js';
import { bulkImportMiddleware, validateBulkImportSize } from '../../middlewares/bulkImport.js';
import * as productionValidation from '../../validations/production.validation.js';
import * as machineOrderAssignmentValidation from '../../validations/machineOrderAssignment.validation.js';
import * as productionController from '../../controllers/production.controller.js';
import * as dispatchTransferNoteController from '../../controllers/production/dispatchTransferNote.controller.js';

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
  .route('/machine-order-assignments/top-items')
  .get(productionController.getMachineOrderAssignmentsTopItems);

router
  .route('/machine-order-assignments/completed-items')
  .get(productionController.getMachineOrderAssignmentsCompletedItems);

router
  .route('/machine-order-assignments/yarn-issue-pending-summary')
  .get(productionController.getYarnIssuePendingSummary);

router
  .route('/machine-order-assignments/machines/pending-quantities')
  .get(
    validate(machineOrderAssignmentValidation.getMachinePendingQuantities),
    productionController.getMachinePendingQuantities
  );

router
  .route('/machine-order-assignments/machines/:machineId/pending-quantity')
  .get(
    validate(machineOrderAssignmentValidation.getMachinePendingQuantity),
    productionController.getMachinePendingQuantity
  );

router
  .route('/machine-order-assignments/:assignmentId/reset')
  .post(validate(machineOrderAssignmentValidation.resetMachineOrderAssignment), productionController.resetMachineOrderAssignment);

router
  .route('/machine-order-assignments/:assignmentId/items')
  .patch(
    validate(machineOrderAssignmentValidation.updateProductionOrderItemPriorities),
    productionController.updateMachineOrderItemPriorities
  );

router
  .route('/machine-order-assignments/:assignmentId/items/:itemId')
  .patch(
    validate(machineOrderAssignmentValidation.updateProductionOrderItemPriority),
    productionController.updateMachineOrderItemPriority
  )
  .delete(
    validate(machineOrderAssignmentValidation.deleteProductionOrderItem),
    productionController.deleteMachineOrderItem
  );

router
  .route('/machine-order-assignments/:assignmentId/items/:itemId/status')
  .patch(
    validate(machineOrderAssignmentValidation.updateProductionOrderItemStatus),
    productionController.updateMachineOrderItemStatus
  );

router
  .route('/machine-order-assignments/:assignmentId/items/:itemId/yarn-issue-status')
  .patch(
    validate(machineOrderAssignmentValidation.updateProductionOrderItemYarnIssueStatus),
    productionController.updateMachineOrderItemYarnIssueStatus
  );

router
  .route('/machine-order-assignments/:assignmentId/items/:itemId/yarn-return-status')
  .patch(
    validate(machineOrderAssignmentValidation.updateProductionOrderItemYarnReturnStatus),
    productionController.updateMachineOrderItemYarnReturnStatus
  );

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
  .route('/floors/:floor/orders/pending-warehouse-print')
  .get(
    validate(productionValidation.getDispatchPendingWarehousePrintOrders),
    productionController.getDispatchPendingWarehousePrintOrders
  );

router
  .route('/floors/Dispatch/transfer-notes/report')
  .get(
    validate(productionValidation.getDispatchTransferNoteReport),
    dispatchTransferNoteController.getDispatchTransferNoteReport
  );

router
  .route('/floors/Dispatch/transfer-notes/preview')
  .get(
    validate(productionValidation.previewDispatchTransferNote),
    dispatchTransferNoteController.previewDispatchTransferNote
  );

router
  .route('/floors/Dispatch/transfer-notes/:transferNoteId')
  .get(
    validate(productionValidation.getDispatchTransferNote),
    dispatchTransferNoteController.getDispatchTransferNote
  );

router
  .route('/floors/Dispatch/transfer-notes')
  .get(
    validate(productionValidation.getDispatchTransferNotes),
    dispatchTransferNoteController.getDispatchTransferNotes
  )
  .post(
    validate(productionValidation.createDispatchTransferNote),
    dispatchTransferNoteController.createDispatchTransferNote
  );

router
  .route('/floors/:floor/orders')
  .get(validate(productionValidation.getFloorOrders), productionController.getFloorOrders);

router
  .route('/floors/:floor/orders/:orderId/articles/:articleId')
  .patch(validate(productionValidation.updateArticleProgress), productionController.updateArticleProgress)
  .post(validate(productionValidation.transferArticle), productionController.transferArticle);

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

// Get article by id
router
  .route('/articles/:articleId')
  .get(validate(productionValidation.getArticle), productionController.getArticle);

// Get processes for article (from Product via articleNumber = factoryCode)
router
  .route('/articles/:articleId/processes')
  .get(validate(productionValidation.getArticle), productionController.getArticleProcesses);

// Direct article quality inspection (works for any floor)
router
  .route('/articles/:articleId/quality-inspection')
  .post(validate(productionValidation.qualityInspection), productionController.qualityInspection);

// Update floor receivedData (receivedStatusFromPreviousFloor, receivedInContainerId, receivedTimestamp)
router
  .route('/articles/:articleId/floor-received-data')
  .patch(validate(productionValidation.updateArticleFloorReceivedData), productionController.updateArticleFloorReceivedData);

// Instant branding type update (Heat Transfer | Embroidery)
router
  .route('/articles/:articleId/branding-type')
  .patch(validate(productionValidation.updateArticleBrandingType), productionController.updateArticleBrandingType);

router
  .route('/articles/:articleId/revert-floor-transfer')
  .post(validate(productionValidation.revertFloorTransfer), productionController.revertFloorTransfer);

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

// ==================== M4 MANAGEMENT ====================

router
  .route('/m4/articles')
  .get(validate(productionValidation.getM4Articles), productionController.getM4Articles);

router
  .route('/m4/logs')
  .get(validate(productionValidation.getM4Logs), productionController.getM4Logs);

router
  .route('/m4/statistics')
  .get(productionController.getM4Statistics);

router
  .route('/m4/articles/:articleId/summary')
  .get(validate(productionValidation.getM4ArticleSummary), productionController.getM4ArticleSummary);

router
  .route('/m4/articles/:articleId/outward')
  .post(validate(productionValidation.markM4Outward), productionController.markM4Outward);

// ==================== M2 MANAGEMENT ====================

router
  .route('/m2/entries')
  .get(validate(productionValidation.getM2Entries), productionController.getM2Entries);

router
  .route('/m2/logs')
  .get(validate(productionValidation.getM2Logs), productionController.getM2Logs);

router
  .route('/m2/statistics')
  .get(productionController.getM2Statistics);

router
  .route('/m2/articles/:articleId/summary')
  .get(validate(productionValidation.getM2ArticleSummary), productionController.getM2ArticleSummary);

router
  .route('/m2/entries/:entryId/merge-to-m1')
  .post(validate(productionValidation.markM2MergeToM1), productionController.markM2MergeToM1);

router
  .route('/m2/entries/:entryId/transfer-to-m3')
  .post(validate(productionValidation.markM2TransferToM3), productionController.markM2TransferToM3);

router
  .route('/m2/entries/:entryId/transfer-to-m4')
  .post(validate(productionValidation.markM2TransferToM4), productionController.markM2TransferToM4);

// ==================== M3 MANAGEMENT ====================

router
  .route('/m3/articles')
  .get(validate(productionValidation.getM3Articles), productionController.getM3Articles);

router
  .route('/m3/logs')
  .get(validate(productionValidation.getM3Logs), productionController.getM3Logs);

router
  .route('/m3/statistics')
  .get(productionController.getM3Statistics);

router
  .route('/m3/articles/:articleId/summary')
  .get(validate(productionValidation.getM3ArticleSummary), productionController.getM3ArticleSummary);

router
  .route('/m3/articles/:articleId/outward')
  .post(validate(productionValidation.markM3Outward), productionController.markM3Outward);


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
