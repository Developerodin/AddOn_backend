import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as teamMasterValidation from '../../validations/teamMaster.validation.js';
import * as teamMasterController from '../../controllers/production/teamMaster.controller.js';

const router = express.Router();

router
  .route('/')
  .post(auth(), validate(teamMasterValidation.createTeamMaster), teamMasterController.createTeamMaster)
  .get(auth(), validate(teamMasterValidation.getTeamMasters), teamMasterController.getTeamMasters);

router
  .route('/barcode/:barcode')
  .get(auth(), validate(teamMasterValidation.getTeamMemberByBarcode), teamMasterController.getTeamMemberByBarcode);

router
  .route('/:teamMemberId')
  .get(auth(), validate(teamMasterValidation.getTeamMaster), teamMasterController.getTeamMaster)
  .patch(auth(), validate(teamMasterValidation.updateTeamMaster), teamMasterController.updateTeamMaster)
  .delete(auth(), validate(teamMasterValidation.deleteTeamMaster), teamMasterController.deleteTeamMaster);

export default router;
