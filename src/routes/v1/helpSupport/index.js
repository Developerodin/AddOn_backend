import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as ticketValidation from '../../../validations/helpSupport/ticket.validation.js';
import * as analyticsController from '../../../controllers/helpSupport/ticketAnalytics.controller.js';
import ticketRoute from './ticket.route.js';

const router = express.Router();

router.use('/tickets', ticketRoute);

router.get(
  '/analytics/summary',
  auth('getHelpSupportAnalytics'),
  validate(ticketValidation.getAnalytics),
  analyticsController.getSummary
);

router.get(
  '/analytics/time-in-status',
  auth('getHelpSupportAnalytics'),
  validate(ticketValidation.getAnalytics),
  analyticsController.getTimeInStatus
);

router.get(
  '/analytics/by-status',
  auth('getHelpSupportAnalytics'),
  validate(ticketValidation.getAnalytics),
  analyticsController.getByStatus
);

router.get(
  '/analytics/by-disposition',
  auth('getHelpSupportAnalytics'),
  validate(ticketValidation.getAnalytics),
  analyticsController.getByDisposition
);

router.get(
  '/analytics/agent-workload',
  auth('getHelpSupportAnalytics'),
  validate(ticketValidation.getAnalytics),
  analyticsController.getAgentWorkload
);

router.get(
  '/analytics/trend',
  auth('getHelpSupportAnalytics'),
  validate(ticketValidation.getAnalytics),
  analyticsController.getTrend
);

export default router;
