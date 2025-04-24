import express from 'express';
import validate from '../../middlewares/validate.js';
import productAttributeValidation from '../../validations/productAttribute.validation.js';
import productAttributeController from '../../controllers/productAttribute.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(productAttributeValidation.createProductAttribute), productAttributeController.createProductAttribute)
  .get(validate(productAttributeValidation.getProductAttributes), productAttributeController.getProductAttributes);

router
  .route('/:attributeId')
  .get(validate(productAttributeValidation.getProductAttribute), productAttributeController.getProductAttribute)
  .patch(validate(productAttributeValidation.updateProductAttribute), productAttributeController.updateProductAttribute)
  .delete(validate(productAttributeValidation.deleteProductAttribute), productAttributeController.deleteProductAttribute);

export default router; 