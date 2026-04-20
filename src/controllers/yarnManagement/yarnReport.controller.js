import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnReportService from '../../services/yarnManagement/yarnReport.service.js';
import * as yarnPoStorageReportService from '../../services/yarnManagement/yarnPoStorageReport.service.js';
import * as yarnPoBoxAuditService from '../../services/yarnManagement/yarnPoBoxAudit.service.js';

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
