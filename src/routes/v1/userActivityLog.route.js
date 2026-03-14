import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as userActivityLogValidation from '../../validations/userActivityLog.validation.js';
import * as userActivityLogController from '../../controllers/userActivityLog.controller.js';

const router = express.Router();

// Admin: list all logs (optional userId filter) - must be before /:userId
router.get(
  '/',
  auth('getUserActivityLogs'),
  validate(userActivityLogValidation.getAllLogs),
  userActivityLogController.getAllLogs
);

// Own logs - any authenticated user
router.get('/me', auth(), validate(userActivityLogValidation.getActivityLogs), userActivityLogController.getMyLogs);
router.get('/me/stats', auth(), validate(userActivityLogValidation.getActivityStats), userActivityLogController.getMyStats);

// User logs - admin only (getUserActivityLogs)
router.get(
  '/:userId',
  auth('getUserActivityLogs'),
  validate(userActivityLogValidation.getUserLogs),
  userActivityLogController.getUserLogs
);
router.get(
  '/:userId/stats',
  auth('getUserActivityLogs'),
  validate(userActivityLogValidation.getUserStats),
  userActivityLogController.getUserStats
);

export default router;
