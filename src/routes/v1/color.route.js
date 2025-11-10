import express from 'express';
import validate from '../../middlewares/validate.js';
import * as colorValidation from '../../validations/color.validation.js';
import * as colorController from '../../controllers/yarnManagement/color.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(colorValidation.createColor), colorController.createColor)
  .get(validate(colorValidation.getColors), colorController.getColors);

router
  .route('/:colorId')
  .get(validate(colorValidation.getColor), colorController.getColor)
  .patch(validate(colorValidation.updateColor), colorController.updateColor)
  .delete(validate(colorValidation.deleteColor), colorController.deleteColor);

export default router;

