import express from 'express';
import validate from '../../middlewares/validate.js';
import syncSiteAuth, { syncEnabledGate } from '../../middlewares/syncSiteAuth.js';
import * as syncValidation from '../../validations/sync.validation.js';
import * as syncController from '../../controllers/sync.controller.js';

/**
 * Factory sync transport (shadow only). Site-to-site auth via X-Sync-* headers; user JWTs do not apply.
 * Order: enabled gate (404 when SYNC_ENABLED=false) → site auth (401) → Joi (400) → handler (422/409 policy).
 */
const router = express.Router();

router.use(syncEnabledGate);
router.use(syncSiteAuth);

router
  .route('/events')
  .post(validate(syncValidation.postEvents), syncController.postEvents)
  .get(validate(syncValidation.getEvents), syncController.getEvents);

router.post('/events/ack', validate(syncValidation.ackEvents), syncController.ackEvents);
router.get('/status', validate(syncValidation.getStatus), syncController.getStatus);
router.post('/conflicts/:id/resolve', validate(syncValidation.resolveConflict), syncController.resolveConflict);

export default router;
