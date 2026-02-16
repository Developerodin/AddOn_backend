import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as vendorValidation from '../../validations/vendor.validation.js';
import * as vendorController from '../../controllers/vendor.controller.js';

const router = express.Router();

router
  .route('/')
  .post(auth(), validate(vendorValidation.createVendor), vendorController.createVendor)
  .get(auth(), validate(vendorValidation.getVendors), vendorController.getVendors);

router
  .route('/:vendorId')
  .get(auth(), validate(vendorValidation.getVendor), vendorController.getVendor)
  .patch(auth(), validate(vendorValidation.updateVendor), vendorController.updateVendor)
  .delete(auth(), validate(vendorValidation.deleteVendor), vendorController.deleteVendor);

export default router;
