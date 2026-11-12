import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as syncValidation from '../../validations/sync.validation.js';
import * as syncReviewController from '../../controllers/syncReview.controller.js';

/**
 * Admin review of sync conflicts. User JWT (manageUsers), not the X-Sync-* site key.
 * Resolve records intent only; nothing is written to orders, planning, PO, GRN, suppliers, settings, or floors.
 */
const router = express.Router();

router.get('/conflicts', auth('manageUsers'), validate(syncValidation.listConflicts), syncReviewController.listConflicts);
router.post(
  '/conflicts/:id/resolve',
  auth('manageUsers'),
  validate(syncValidation.resolveConflict),
  syncReviewController.resolveConflict
);

export default router;
