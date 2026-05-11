import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnConeValidation from '../../../validations/yarnCone.validation.js';
import * as yarnConeController from '../../../controllers/yarnManagement/yarnCone.controller.js';

const router = express.Router();

router
  .route('/')
  .get(
    validate(yarnConeValidation.getYarnCones),
    yarnConeController.getYarnCones
  )
  .post(
    validate(yarnConeValidation.createYarnCone),
    yarnConeController.createYarnCone
  );

// Match boxId that may contain slashes; capture full path after prefix
router.get(
  /^\/short-term\/by-box\/(.+)$/,
  (req, res, next) => {
    req.params = { boxId: req.params[0] };
    next();
  },
  validate(yarnConeValidation.getShortTermConesByBoxId),
  yarnConeController.getShortTermConesByBoxId
);

// Match boxId that may contain slashes (e.g. BOX-PO-2026-997-CN/2067-...); capture full path after prefix
router.post(
  /^\/generate-by-box\/(.+)$/,
  (req, res, next) => {
    req.params = { boxId: req.params[0] };
    next();
  },
  validate(yarnConeValidation.generateConesByBox),
  yarnConeController.generateConesByBox
);

router
  .route('/barcode/:barcode')
  .get(
    validate(yarnConeValidation.getYarnConeByBarcode),
    yarnConeController.getYarnConeByBarcode
  )
  .post(
    validate(yarnConeValidation.returnYarnCone),
    yarnConeController.returnYarnCone
  );

router
  .route('/by-storage-location/:storageLocation')
  .get(
    validate(yarnConeValidation.getConesByStorageLocation),
    yarnConeController.getConesByStorageLocation
  );

router
  .route('/without-storage-location')
  .get(yarnConeController.getConesWithoutStorageLocation);

router
  .route('/set-storage-location')
  .patch(
    validate(yarnConeValidation.bulkSetConeStorageLocation),
    yarnConeController.bulkSetConeStorageLocation
  );

router.post(
  '/floor-issue-batch',
  validate(yarnConeValidation.createFloorIssueBatch),
  yarnConeController.createFloorIssueBatch
);

router.post(
  '/issue-for-floor',
  validate(yarnConeValidation.issueConeForFloor),
  yarnConeController.issueConeForFloor
);

router
  .route('/:yarnConeId')
  .patch(
    validate(yarnConeValidation.updateYarnCone),
    yarnConeController.updateYarnCone
  );

export default router;


