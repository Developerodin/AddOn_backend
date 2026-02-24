import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as pickPackValidation from '../../../validations/whms/pickPack.validation.js';
import * as pickPackController from '../../../controllers/whms/pickPack.controller.js';

const router = express.Router();

// Pick list
router
  .route('/pick-list')
  .get(
    auth('getOrders'),
    validate(pickPackValidation.getPickList),
    pickPackController.getPickList
  )
  .post(
    auth('manageOrders'),
    validate(pickPackValidation.generatePickList),
    pickPackController.generatePickList
  );

router
  .route('/pick-list/:listId/items/:itemId')
  .patch(
    auth('manageOrders'),
    validate(pickPackValidation.updatePickListItem),
    pickPackController.updatePickListItem
  );

router
  .route('/pick-list/confirm-pick')
  .patch(
    auth('manageOrders'),
    validate(pickPackValidation.confirmPick),
    pickPackController.confirmPick
  );

router
  .route('/pick-list/skip')
  .post(
    auth('manageOrders'),
    validate(pickPackValidation.skipPickItem),
    pickPackController.skipPickItem
  );

router
  .route('/scan/pick')
  .post(
    auth('getOrders'),
    validate(pickPackValidation.scanPick),
    pickPackController.scanPick
  );

// Pack list
router
  .route('/pack-list')
  .get(
    auth('getOrders'),
    validate(pickPackValidation.getPackList),
    pickPackController.getPackList
  );

router
  .route('/pack-list/batches')
  .post(
    auth('manageOrders'),
    validate(pickPackValidation.createPackBatch),
    pickPackController.createPackBatch
  );

router
  .route('/pack-list/batches/:batchId')
  .get(
    auth('getOrders'),
    validate(pickPackValidation.getPackBatch),
    pickPackController.getPackBatch
  );

router
  .route('/pack-list/batches/:batchId/orders/:orderId/items/:itemId')
  .patch(
    auth('manageOrders'),
    validate(pickPackValidation.updatePackItemQty),
    pickPackController.updatePackItemQty
  );

router
  .route('/pack-list/batches/:batchId/cartons')
  .post(
    auth('manageOrders'),
    validate(pickPackValidation.addCarton),
    pickPackController.addCarton
  );

router
  .route('/pack-list/batches/:batchId/cartons/:cartonId')
  .patch(
    auth('manageOrders'),
    validate(pickPackValidation.updateCarton),
    pickPackController.updateCarton
  );

router
  .route('/pack-list/batches/:batchId/complete')
  .post(
    auth('manageOrders'),
    validate(pickPackValidation.completePackBatch),
    pickPackController.completePackBatch
  );

// Barcode
router
  .route('/barcode/generate')
  .post(
    auth('manageOrders'),
    validate(pickPackValidation.generateBarcodes),
    pickPackController.generateBarcodes
  );

// Damage/Missing
router
  .route('/reports/damage-missing')
  .post(
    auth('manageOrders'),
    validate(pickPackValidation.createDamageMissingReport),
    pickPackController.createDamageMissingReport
  )
  .get(
    auth('getOrders'),
    validate(pickPackValidation.getDamageMissingReports),
    pickPackController.getDamageMissingReports
  );

// Scan pack
router
  .route('/scan/pack')
  .post(
    auth('getOrders'),
    validate(pickPackValidation.scanPack),
    pickPackController.scanPack
  );

export default router;
