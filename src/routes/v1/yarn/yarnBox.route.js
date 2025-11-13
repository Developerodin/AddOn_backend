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
  .route('/bulk')
  .post(
    validate(yarnBoxValidation.bulkCreateYarnBoxes),
    yarnBoxController.bulkCreateYarnBoxes
  );

router
  .route('/update-qc-status')
  .patch(
    validate(yarnBoxValidation.updateQcStatusByPoNumber),
    yarnBoxController.updateQcStatusByPoNumber
  );

router
  .route('/barcode/:barcode')
  .get(
    validate(yarnBoxValidation.getYarnBoxByBarcode),
    yarnBoxController.getYarnBoxByBarcode
  );

router
  .route('/:yarnBoxId')
  .get(
    validate(yarnBoxValidation.getYarnBoxById),
    yarnBoxController.getYarnBox
  )
  .patch(
    validate(yarnBoxValidation.updateYarnBox),
    yarnBoxController.updateYarnBox
  );

export default router;


