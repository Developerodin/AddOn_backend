import catchAsync from '../../utils/catchAsync.js';
import * as orderFlowService from '../../services/whms/orderFlow.service.js';

const transitionFlowStatus = catchAsync(async (req, res) => {
  const order = await orderFlowService.transitionOrder(req.params.orderId, req.body.flowStatus, req.user, {
    remarks: req.body.remarks,
  });
  res.send({
    order,
    allowedNext: orderFlowService.allowedNextStatuses(order, req.user),
  });
});

const getFlowHistory = catchAsync(async (req, res) => {
  const result = await orderFlowService.getFlowHistory(req.params.orderId);
  res.send(result);
});

export { transitionFlowStatus, getFlowHistory };
