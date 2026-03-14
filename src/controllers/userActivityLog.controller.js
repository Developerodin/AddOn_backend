import catchAsync from '../utils/catchAsync.js';
import * as userActivityLogService from '../services/userActivityLog.service.js';

/**
 * Get activity logs for current user
 */
const getMyLogs = catchAsync(async (req, res) => {
  const logs = await userActivityLogService.getUserActivityLogs(req.user._id, req.query);
  res.send(logs);
});

/**
 * Get activity stats for current user
 */
const getMyStats = catchAsync(async (req, res) => {
  const stats = await userActivityLogService.getUserActivityStats(req.user._id, req.query);
  res.send(stats);
});

/**
 * Get activity logs for a user (admin only, or self)
 */
const getUserLogs = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const logs = await userActivityLogService.getUserActivityLogs(userId, req.query);
  res.send(logs);
});

/**
 * Get activity stats for a user (admin only)
 */
const getUserStats = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const stats = await userActivityLogService.getUserActivityStats(userId, req.query);
  res.send(stats);
});

/**
 * Get all activity logs (admin only) - optional userId filter
 */
const getAllLogs = catchAsync(async (req, res) => {
  const logs = await userActivityLogService.getAllActivityLogs(req.query);
  res.send(logs);
});

export { getMyLogs, getMyStats, getUserLogs, getUserStats, getAllLogs };
