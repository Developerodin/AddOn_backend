import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnBoxValidation from '../../../validations/yarnBox.validation.js';
import * as yarnBoxController from '../../../controllers/yarnManagement/yarnBox.controller.js';

const router = express.Router();

router
  .route('/')
  .get(
    validate(yarnBoxValidation.getYarnBoxes),
    yarnBoxController.getYarnBoxes
  )
  .post(
    validate(yarnBoxValidation.createYarnBox),
    yarnBoxController.createYarnBox
  );

router
  .route('/:yarnBoxId')
  .patch(
    validate(yarnBoxValidation.updateYarnBox),
    yarnBoxController.updateYarnBox
  );

export default router;


