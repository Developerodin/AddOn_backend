import express from 'express';
import validate from '../../middlewares/validate.js';
import * as blendValidation from '../../validations/blend.validation.js';
import * as blendController from '../../controllers/yarnManagement/blend.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(blendValidation.createBlend), blendController.createBlend)
  .get(validate(blendValidation.getBlends), blendController.getBlends);

router
  .route('/:blendId')
  .get(validate(blendValidation.getBlend), blendController.getBlend)
  .patch(validate(blendValidation.updateBlend), blendController.updateBlend)
  .delete(validate(blendValidation.deleteBlend), blendController.deleteBlend);

export default router;

