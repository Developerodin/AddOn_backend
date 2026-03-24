import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as vendorBoxValidation from '../../validations/vendorBox.validation.js';
import * as vendorBoxController from '../../controllers/vendorManagement/vendorBox.controller.js';

const router = express.Router();

router
  .route('/bulk')
  .post(auth(), validate(vendorBoxValidation.bulkCreateVendorBoxes), vendorBoxController.bulkCreateVendorBoxes);

router
  .route('/')
  .get(auth(), validate(vendorBoxValidation.getVendorBoxes), vendorBoxController.getVendorBoxes)
  .post(auth(), validate(vendorBoxValidation.createVendorBox), vendorBoxController.createVendorBox);

router
  .route('/:vendorBoxId')
  .get(auth(), validate(vendorBoxValidation.getVendorBoxById), vendorBoxController.getVendorBox)
  .patch(auth(), validate(vendorBoxValidation.updateVendorBox), vendorBoxController.updateVendorBox)
  .delete(auth(), validate(vendorBoxValidation.deleteVendorBox), vendorBoxController.deleteVendorBox);

export default router;
