import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as containersMasterValidation from '../../validations/containersMaster.validation.js';
import * as containersMasterController from '../../controllers/production/containersMaster.controller.js';

const router = express.Router();

router
  .route('/')
  .post(auth(), validate(containersMasterValidation.createContainersMaster), containersMasterController.createContainersMaster)
  .get(auth(), validate(containersMasterValidation.getContainersMasters), containersMasterController.getContainersMasters);

router
  .route('/barcode/:barcode')
  .get(auth(), validate(containersMasterValidation.getContainerByBarcode), containersMasterController.getContainerByBarcode);

router
  .route('/:containerId')
  .get(auth(), validate(containersMasterValidation.getContainersMaster), containersMasterController.getContainersMaster)
  .patch(auth(), validate(containersMasterValidation.updateContainersMaster), containersMasterController.updateContainersMaster)
  .delete(auth(), validate(containersMasterValidation.deleteContainersMaster), containersMasterController.deleteContainersMaster);

export default router;
