import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnReportService from '../../services/yarnManagement/yarnReport.service.js';

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
