import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnReportService from '../../services/yarnManagement/yarnReport.service.js';
import * as yarnSnapshotBoundsService from '../../services/yarnManagement/yarnSnapshotBounds.service.js';
import * as yarnPoStorageReportService from '../../services/yarnManagement/yarnPoStorageReport.service.js';
import * as yarnPoBoxAuditService from '../../services/yarnManagement/yarnPoBoxAudit.service.js';
import * as yarnReportAnalyticsService from '../../services/yarnManagement/yarnReportAnalytics.service.js';

/**
 * GET /yarn-management/yarn-report
 * Query: start_date, end_date (ISO date strings)
 * Returns yarn report for the date range.
 */
export const getYarnReport = catchAsync(async (req, res) => {
  const { start_date, end_date } = req.query;
  const report = await yarnReportService.getYarnReportByDateRange({
    startDate: start_date,
    endDate: end_date,
  });
  res.status(httpStatus.OK).send(report);
});

/**
 * GET /yarn-management/yarn-report/snapshot-bounds
 * Snapshot coverage for Yarn Report date pickers (earliest/latest keys, suggested range).
 */
export const getYarnReportSnapshotBounds = catchAsync(async (req, res) => {
  const payload = await yarnSnapshotBoundsService.getYarnReportSnapshotBounds();
  res.status(httpStatus.OK).send(payload);
});

/**
 * GET /yarn-management/yarn-report/po-short-term/:poNumber
 * Returns all boxes for a PO and cones currently in short-term storage with weights.
 */
export const getPoShortTermStorageReport = catchAsync(async (req, res) => {
  const { poNumber } = req.params;
  const report = await yarnPoStorageReportService.getPoBoxesAndShortTermConesReport({ poNumber });
  res.status(httpStatus.OK).send(report);
});

/**
 * GET /yarn-management/yarn-report/po-audit/:poNumber
 * Audit boxes vs ST cones and highlight inconsistent records.
 */
export const getPoBoxAuditReport = catchAsync(async (req, res) => {
  const { poNumber } = req.params;
  const report = await yarnPoBoxAuditService.getPoBoxAuditReport({ poNumber });
  res.status(httpStatus.OK).send(report);
});

/**
 * GET /yarn-management/yarn-report/po-analytics
 * Aggregated PO metrics for analytics charts (created vs received date mode).
 */
export const getPoAnalytics = catchAsync(async (req, res) => {
  const q = req.query;
  const payload = await yarnReportAnalyticsService.getPoAnalytics({
    startDate: q.start_date,
    endDate: q.end_date,
    dateMode: q.date_mode,
    supplierId: q.supplier_id,
    yarnCatalogId: q.yarn_catalog_id,
    statuses: q.status,
    includeDraft: q.include_draft === 'true',
  });
  res.status(httpStatus.OK).send(payload);
});

/**
 * GET /yarn-management/yarn-report/po-analytics/lines
 * Paginated PO rows for drill-down tables.
 */
export const getPoAnalyticsLines = catchAsync(async (req, res) => {
  const q = req.query;
  const payload = await yarnReportAnalyticsService.getPoAnalyticsLines({
    startDate: q.start_date,
    endDate: q.end_date,
    dateMode: q.date_mode,
    supplierId: q.supplier_id,
    yarnCatalogId: q.yarn_catalog_id,
    statuses: q.status,
    includeDraft: q.include_draft === 'true',
    groupBy: q.group_by,
    groupId: q.group_id || undefined,
    page: q.page,
    limit: q.limit,
  });
  res.status(httpStatus.OK).send(payload);
});

/**
 * GET /yarn-management/yarn-report/yarn-closing-trend
 * Daily closing kg from YarnDailyClosingSnapshot for one yarn catalog id.
 */
export const getYarnClosingTrend = catchAsync(async (req, res) => {
  const q = req.query;
  const payload = await yarnReportAnalyticsService.getYarnClosingTrend({
    yarnCatalogId: q.yarn_catalog_id,
    startDate: q.start_date,
    endDate: q.end_date,
  });
  res.status(httpStatus.OK).send(payload);
});

/**
 * GET /yarn-management/yarn-report/transaction-analytics
 * YarnTransaction kg totals by type for a date range.
 */
export const getYarnTransactionAnalytics = catchAsync(async (req, res) => {
  const q = req.query;
  const payload = await yarnReportAnalyticsService.getTransactionAnalytics({
    startDate: q.start_date,
    endDate: q.end_date,
    yarnCatalogId: q.yarn_catalog_id,
  });
  res.status(httpStatus.OK).send(payload);
});
