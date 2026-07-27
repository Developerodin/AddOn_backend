import catchAsync from '../../utils/catchAsync.js';
import * as dispatchService from '../../services/whms/dispatch.service.js';

const setDispatchDetails = catchAsync(async (req, res) => {
  const order = await dispatchService.setDispatchDetails(req.params.orderId, req.user, req.body);
  res.send(order);
});

const dispatchOrder = catchAsync(async (req, res) => {
  const order = await dispatchService.dispatchOrder(req.params.orderId, req.user, req.body);
  res.send(order);
});

const setDeliveryStatus = catchAsync(async (req, res) => {
  const order = await dispatchService.setDeliveryStatus(req.params.orderId, req.user, req.body);
  res.send(order);
});

const getShippingLabel = catchAsync(async (req, res) => {
  const payload = await dispatchService.buildShippingLabelPayload(req.params.orderId);
  res.send(payload);
});

const getPackingList = catchAsync(async (req, res) => {
  const payload = await dispatchService.buildPackingListPayload(req.params.orderId);
  res.send(payload);
});

const bulkImportDispatchDetails = catchAsync(async (req, res) => {
  const result = await dispatchService.bulkSetDispatchDetails(req.user, req.body.rows);
  res.send(result);
});

export { setDispatchDetails, dispatchOrder, setDeliveryStatus, getShippingLabel, getPackingList, bulkImportDispatchDetails };
