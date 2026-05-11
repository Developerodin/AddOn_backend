import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnReqValidation from '../../../validations/yarnReq.validation.js';
import * as yarnReqController from '../../../controllers/yarnManagement/yarnReq.controller.js';

const router = express.Router();

router
  .route('/clear-draft')
  .patch(validate(yarnReqValidation.clearRequisitionDraft), yarnReqController.clearRequisitionDraftFlags);

router
  .route('/')
  .get(
    validate(yarnReqValidation.getYarnRequisitionList),
    yarnReqController.getYarnRequisitionList
  )
  .post(
    validate(yarnReqValidation.createYarnRequisition),
    yarnReqController.createYarnRequisition
  );

router.route('/:yarnRequisitionId/dismiss').patch(
  validate(yarnReqValidation.dismissRequisition),
  yarnReqController.dismissYarnRequisition
);

router
  .route('/:yarnRequisitionId/status')
  .patch(
    validate(yarnReqValidation.patchYarnRequisition),
    yarnReqController.patchYarnRequisition
  );

export default router;

