import express from 'express';
import validate from '../../middlewares/validate.js';
import * as processValidation from '../../validations/process.validation.js';
import * as processController from '../../controllers/process.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(processValidation.createProcess), processController.createProcess)
  .get(validate(processValidation.getProcesses), processController.getProcesses);

router
  .route('/:processId')
  .get(validate(processValidation.getProcess), processController.getProcess)
  .patch(validate(processValidation.updateProcess), processController.updateProcess)
  .delete(validate(processValidation.deleteProcess), processController.deleteProcess);

export default router; 