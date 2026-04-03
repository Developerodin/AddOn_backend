import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as pickListValidation from '../../../validations/whms/pickList.validation.js';
import * as pickListController from '../../../controllers/whms/pickList.controller.js';

const router = express.Router();

router
  .route('/')
  .get(
    auth('getOrders'),
    validate(pickListValidation.getPickLists),
    pickListController.getPickLists
  );

router
  .route('/order-wise')
  .get(
    auth('getOrders'),
    validate(pickListValidation.getPickListsGroupedByOrder),
    pickListController.getPickListsGroupedByOrder
  );

router
  .route('/order/:orderId')
  .get(
    auth('getOrders'),
    validate(pickListValidation.getPickListsByOrder),
    pickListController.getPickListsByOrder
  )
  .delete(
    auth('manageOrders'),
    validate(pickListValidation.deletePickListsByOrder),
    pickListController.deletePickListsByOrder
  );

router
  .route('/:pickListId')
  .get(
    auth('getOrders'),
    validate(pickListValidation.getPickList),
    pickListController.getPickList
  )
  .patch(
    auth('manageOrders'),
    validate(pickListValidation.updatePickList),
    pickListController.updatePickList
  )
  .delete(
    auth('manageOrders'),
    validate(pickListValidation.deletePickList),
    pickListController.deletePickList
  );

export default router;
