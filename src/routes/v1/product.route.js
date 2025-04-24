import express from 'express';
import validate from '../../middlewares/validate.js';
import * as productValidation from '../../validations/product.validation.js';
import * as productController from '../../controllers/product.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(productValidation.createProduct), productController.createProduct)
  .get(validate(productValidation.getProducts), productController.getProducts);

router
  .route('/:productId')
  .get(validate(productValidation.getProduct), productController.getProduct)
  .patch(validate(productValidation.updateProduct), productController.updateProduct)
  .delete(validate(productValidation.deleteProduct), productController.deleteProduct);

export default router; 