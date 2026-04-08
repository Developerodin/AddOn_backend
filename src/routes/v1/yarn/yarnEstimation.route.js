import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnEstimationValidation from '../../../validations/yarnEstimation.validation.js';
import * as yarnEstimationController from '../../../controllers/yarnManagement/yarnEstimation.controller.js';

const router = express.Router();

router
  .route('/summary')
  .get(
    validate(yarnEstimationValidation.getYarnEstimationSummary),
    yarnEstimationController.getYarnEstimationSummary
  );

router
  .route('/order/:orderId')
  .get(
    validate(yarnEstimationValidation.getYarnEstimationByOrder),
    yarnEstimationController.getYarnEstimationByOrder
  );

router
  .route('/article/:articleId')
  .get(
    validate(yarnEstimationValidation.getYarnEstimationByArticle),
    yarnEstimationController.getYarnEstimationByArticle
  );

export default router;
