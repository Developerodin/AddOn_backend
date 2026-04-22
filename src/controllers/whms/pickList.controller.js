import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as pickListService from '../../services/whms/pickList.service.js';

const getPickLists = catchAsync(async (req, res) => {
  const filter = pickListService.buildPickListFilter(
    pick(req.query, ['orderId', 'orderNumber', 'skuCode', 'styleCode', 'status', 'q'])
  );
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await pickListService.queryPickLists(filter, options);
  res.send(result);
});

const getPickList = catchAsync(async (req, res) => {
  const record = await pickListService.getPickListById(req.params.pickListId);
  if (!record) throw new ApiError(httpStatus.NOT_FOUND, 'Pick list entry not found');
  res.send(record);
});

const getPickListsByOrder = catchAsync(async (req, res) => {
  const records = await pickListService.getPickListsByOrderId(req.params.orderId);
  res.send(records);
});

const updatePickList = catchAsync(async (req, res) => {
  const record = await pickListService.updatePickListById(req.params.pickListId, req.body);
  res.send(record);
});

const deletePickList = catchAsync(async (req, res) => {
  await pickListService.deletePickListById(req.params.pickListId);
  res.status(httpStatus.NO_CONTENT).send();
});

const deletePickListsByOrder = catchAsync(async (req, res) => {
  await pickListService.deletePickListsByOrderId(req.params.orderId);
  res.status(httpStatus.NO_CONTENT).send();
});

const getPickListsGroupedByOrder = catchAsync(async (req, res) => {
  const filter = pickListService.buildPickListAggFilter(
    pick(req.query, ['orderId', 'orderNumber', 'skuCode', 'styleCode', 'status', 'q'])
  );
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await pickListService.queryPickListsGroupedByOrder(filter, options);
  res.send(result);
});

const setPickerNameForOrder = catchAsync(async (req, res) => {
  const result = await pickListService.setPickerNameForOrder(req.params.orderId, req.body.pickerName);
  res.status(httpStatus.OK).send(result);
});

export {
  getPickLists,
  getPickList,
  getPickListsByOrder,
  getPickListsGroupedByOrder,
  setPickerNameForOrder,
  updatePickList,
  deletePickList,
  deletePickListsByOrder,
};
