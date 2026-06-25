import catchAsync from '../../utils/catchAsync.js';
import * as analyticsService from '../../services/helpSupport/ticketAnalytics.service.js';

/**
 * Analytics summary cards.
 */
const getSummary = catchAsync(async (req, res) => {
  const summary = await analyticsService.getAnalyticsSummary(req.query);
  res.send(summary);
});

/**
 * Time-in-status aggregates.
 */
const getTimeInStatus = catchAsync(async (req, res) => {
  const data = await analyticsService.getTimeInStatusAnalytics(req.query);
  res.send(data);
});

/**
 * Tickets grouped by status.
 */
const getByStatus = catchAsync(async (req, res) => {
  const data = await analyticsService.getByStatus(req.query);
  res.send(data);
});

/**
 * Tickets grouped by disposition.
 */
const getByDisposition = catchAsync(async (req, res) => {
  const data = await analyticsService.getByDisposition(req.query);
  res.send(data);
});

/**
 * Agent workload breakdown.
 */
const getAgentWorkload = catchAsync(async (req, res) => {
  const data = await analyticsService.getAgentWorkload(req.query);
  res.send(data);
});

/**
 * Created vs resolved trend.
 */
const getTrend = catchAsync(async (req, res) => {
  const data = await analyticsService.getTrend(req.query);
  res.send(data);
});

export { getSummary, getTimeInStatus, getByStatus, getByDisposition, getAgentWorkload, getTrend };
