import express from 'express';
import validate from '../../middlewares/validate.js';
import * as categoryValidation from '../../validations/category.validation.js';
import * as categoryController from '../../controllers/category.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(categoryValidation.createCategory), categoryController.createCategory)
  .get(validate(categoryValidation.getCategories), categoryController.getCategories);

router
  .route('/:categoryId')
  .get(validate(categoryValidation.getCategory), categoryController.getCategory)
  .patch(validate(categoryValidation.updateCategory), categoryController.updateCategory)
  .delete(validate(categoryValidation.deleteCategory), categoryController.deleteCategory);

export default router; 