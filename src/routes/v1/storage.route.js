import express from 'express';
import validate from '../../middlewares/validate.js';
import * as storageSlotValidation from '../../validations/storageSlot.validation.js';
import * as storageSlotController from '../../controllers/storageManagement/storageSlot.controller.js';

const router = express.Router();

router
  .route('/slots')
  .get(validate(storageSlotValidation.listStorageSlots), storageSlotController.getStorageSlots);

router
  .route('/slots/zone/:zone')
  .get(validate(storageSlotValidation.getStorageSlotsByZone), storageSlotController.getStorageSlotsByZone);

export default router;


