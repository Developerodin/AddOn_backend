import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as validation from '../../validations/vendorPoReturnChallan.validation.js';
import * as controller from '../../controllers/vendorManagement/vendorPoReturnChallan.controller.js';

const router = express.Router();

router.route('/').get(auth(), validate(validation.listVendorPoReturnChallans), controller.listChallans);

router
  .route('/by-number/:challanNumber')
  .get(auth(), validate(validation.getVendorPoReturnChallanByNumber), controller.getChallanByNumber);

router
  .route('/by-vpo/:vpoId')
  .get(auth(), validate(validation.getVendorPoReturnChallansByVpo), controller.getChallansByVpo);

router
  .route('/:challanId/transport')
  .patch(auth(), validate(validation.patchVendorPoReturnChallanTransport), controller.patchTransport);

router
  .route('/:challanId/boxes')
  .patch(auth(), validate(validation.patchVendorPoReturnChallanBoxes), controller.patchBoxes);

router.route('/:challanId').get(auth(), validate(validation.getVendorPoReturnChallan), controller.getChallan);

export default router;
