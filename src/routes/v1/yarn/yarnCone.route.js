import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnConeValidation from '../../../validations/yarnCone.validation.js';
import * as yarnConeController from '../../../controllers/yarnManagement/yarnCone.controller.js';

const router = express.Router();

router
  .route('/')
  .get(
    validate(yarnConeValidation.getYarnCones),
    yarnConeController.getYarnCones
  )
  .post(
    validate(yarnConeValidation.createYarnCone),
    yarnConeController.createYarnCone
  );

router
  .route('/generate-by-box/:boxId')
  .post(
    validate(yarnConeValidation.generateConesByBox),
    yarnConeController.generateConesByBox
  );

router
  .route('/barcode/:barcode')
  .get(
    validate(yarnConeValidation.getYarnConeByBarcode),
    yarnConeController.getYarnConeByBarcode
  );

router
  .route('/:yarnConeId')
  .patch(
    validate(yarnConeValidation.updateYarnCone),
    yarnConeController.updateYarnCone
  );

export default router;


