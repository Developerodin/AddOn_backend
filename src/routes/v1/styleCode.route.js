import express from 'express';
import validate from '../../middlewares/validate.js';
import * as styleCodeValidation from '../../validations/styleCode.validation.js';
import * as styleCodeController from '../../controllers/styleCode.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(styleCodeValidation.createStyleCode), styleCodeController.createStyleCode)
  .get(validate(styleCodeValidation.getStyleCodes), styleCodeController.getStyleCodes);

router
  .route('/bulk-import')
  .post(validate(styleCodeValidation.bulkImportStyleCodes), styleCodeController.bulkImportStyleCodes);

router
  .route('/:styleCodeId')
  .get(validate(styleCodeValidation.getStyleCode), styleCodeController.getStyleCode)
  .patch(validate(styleCodeValidation.updateStyleCode), styleCodeController.updateStyleCode)
  .delete(validate(styleCodeValidation.deleteStyleCode), styleCodeController.deleteStyleCode);

export default router;
