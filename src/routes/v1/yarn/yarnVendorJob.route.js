import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnVendorJobValidation from '../../../validations/yarnVendorJob.validation.js';
import * as yarnVendorJobController from '../../../controllers/yarnManagement/yarnVendorJob.controller.js';

const router = express.Router();

router
  .route('/preview')
  .post(validate(yarnVendorJobValidation.previewBox), yarnVendorJobController.previewBox);

router
  .route('/send')
  .post(validate(yarnVendorJobValidation.sendBoxes), yarnVendorJobController.sendBoxes);

router
  .route('/receive')
  .post(validate(yarnVendorJobValidation.receiveBoxes), yarnVendorJobController.receiveBoxes);

router
  .route('/at-vendor')
  .get(validate(yarnVendorJobValidation.listAtVendor), yarnVendorJobController.listAtVendor);

router
  .route('/')
  .get(validate(yarnVendorJobValidation.listShipments), yarnVendorJobController.listShipments);

router
  .route('/:id/void')
  .post(validate(yarnVendorJobValidation.voidShipment), yarnVendorJobController.voidShipment);

router
  .route('/:id')
  .get(validate(yarnVendorJobValidation.getShipment), yarnVendorJobController.getShipment);

export default router;
