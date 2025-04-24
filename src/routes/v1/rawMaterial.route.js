import express from 'express';
import validate from '../../middlewares/validate.js';
import rawMaterialValidation from '../../validations/rawMaterial.validation.js';
import rawMaterialController from '../../controllers/rawMaterial.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(rawMaterialValidation.createRawMaterial), rawMaterialController.createRawMaterial)
  .get(validate(rawMaterialValidation.getRawMaterials), rawMaterialController.getRawMaterials);

router
  .route('/:materialId')
  .get(validate(rawMaterialValidation.getRawMaterial), rawMaterialController.getRawMaterial)
  .patch(validate(rawMaterialValidation.updateRawMaterial), rawMaterialController.updateRawMaterial)
  .delete(validate(rawMaterialValidation.deleteRawMaterial), rawMaterialController.deleteRawMaterial);

export default router; 