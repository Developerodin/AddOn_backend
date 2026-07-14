import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import * as pickListBatchService from '../../services/whms/pickListBatch.service.js';

const createBatch = catchAsync(async (req, res) => {
  const batch = await pickListBatchService.createBatch({
    orderIds: req.body.orderIds,
    user: req.user,
  });
  res.status(httpStatus.CREATED).send(batch);
});

const getBatches = catchAsync(async (req, res) => {
  const filter = pickListBatchService.buildBatchFilter(
    pick(req.query, ['status', 'type', 'orderId', 'q'])
  );
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await pickListBatchService.queryBatches(filter, options);
  res.send(result);
});

const getBatch = catchAsync(async (req, res) => {
  const batch = await pickListBatchService.getBatchById(req.params.batchId);
  res.send(batch);
});

const updateBatchItem = catchAsync(async (req, res) => {
  const batch = await pickListBatchService.updateBatchItemPickedQty(
    req.params.batchId,
    req.params.itemKey,
    req.body.pickedQty,
    req.user
  );
  res.send(batch);
});

const saveBatchPicks = catchAsync(async (req, res) => {
  const batch = await pickListBatchService.saveBatchPicks(
    req.params.batchId,
    req.body.picks,
    req.user
  );
  res.send(batch);
});

const setBatchPicker = catchAsync(async (req, res) => {
  const batch = await pickListBatchService.setBatchPickerName(
    req.params.batchId,
    req.body.pickerName
  );
  res.send(batch);
});

const getBatchBarcodes = catchAsync(async (req, res) => {
  const payload = await pickListBatchService.buildBarcodePayload(req.params.batchId, {
    styleCode: req.query.styleCode,
    extraQty: req.query.extraQty,
  });
  res.send(payload);
});

const sendBatchToScanning = catchAsync(async (req, res) => {
  const batch = await pickListBatchService.sendBatchToScanning(req.params.batchId, req.user);
  res.send(batch);
});

const cancelBatch = catchAsync(async (req, res) => {
  const batch = await pickListBatchService.cancelBatch(req.params.batchId, req.user);
  res.send(batch);
});

const getBatchForOrder = catchAsync(async (req, res) => {
  const batch = await pickListBatchService.getBatchForOrder(req.params.orderId);
  res.send(batch);
});

export {
  createBatch,
  getBatches,
  getBatch,
  updateBatchItem,
  saveBatchPicks,
  setBatchPicker,
  getBatchBarcodes,
  sendBatchToScanning,
  cancelBatch,
  getBatchForOrder,
};
