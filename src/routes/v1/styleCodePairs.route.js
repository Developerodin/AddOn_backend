import express from 'express';
import validate from '../../middlewares/validate.js';
import * as styleCodePairsValidation from '../../validations/styleCodePairs.validation.js';
import * as styleCodePairsController from '../../controllers/styleCodePairs.controller.js';

const router = express.Router();

router
  .route('/')
  .post(
    validate(styleCodePairsValidation.createStyleCodePairs),
    styleCodePairsController.createStyleCodePairs
  )
  .get(
    validate(styleCodePairsValidation.getStyleCodePairsList),
    styleCodePairsController.getStyleCodePairsList
  );

router
  .route('/bulk-import')
  .post(
    validate(styleCodePairsValidation.bulkImportStyleCodePairs),
    styleCodePairsController.bulkImportStyleCodePairs
  );

router
  .route('/bulk-import-bom')
  .post(validate(styleCodePairsValidation.bulkImportBom), styleCodePairsController.bulkImportBom);

router
  .route('/:styleCodePairsId')
  .get(
    validate(styleCodePairsValidation.getStyleCodePairs),
    styleCodePairsController.getStyleCodePairs
  )
  .patch(
    validate(styleCodePairsValidation.updateStyleCodePairs),
    styleCodePairsController.updateStyleCodePairs
  )
  .delete(
    validate(styleCodePairsValidation.deleteStyleCodePairs),
    styleCodePairsController.deleteStyleCodePairs
  );

export default router;
