import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import catchAsync from '../../utils/catchAsync.js';
import * as vendorPurchaseOrderService from '../../services/vendorManagement/vendorPurchaseOrder.service.js';
import * as vendorBoxService from '../../services/vendorManagement/vendorBox.service.js';

export const createVendorPurchaseOrder = catchAsync(async (req, res) => {
  const { year, ...body } = req.body;
  const doc = await vendorPurchaseOrderService.createVendorPurchaseOrder(body, year);
  res.status(httpStatus.CREATED).send(doc);
});

export const bulkCreateVendorPurchaseOrders = catchAsync(async (req, res) => {
  const result = await vendorPurchaseOrderService.bulkCreateVendorPurchaseOrders(req.body);
  res.status(httpStatus.CREATED).send(result);
});

export const getVendorPurchaseOrders = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['vendor', 'vendorName', 'vpoNumber', 'currentStatus']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const { search } = req.query;
  const result = await vendorPurchaseOrderService.queryVendorPurchaseOrders(filter, options, search);
  res.send(result);
});

export const getVendorPurchaseOrder = catchAsync(async (req, res) => {
  const doc = await vendorPurchaseOrderService.getVendorPurchaseOrderById(req.params.vendorPurchaseOrderId);
  if (!doc) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Vendor purchase order not found' });
  }
  return res.send(doc);
});

export const getVendorPurchaseOrderByVpoNumber = catchAsync(async (req, res) => {
  const doc = await vendorPurchaseOrderService.getVendorPurchaseOrderByVpoNumber(req.params.vpoNumber);
  if (!doc) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Vendor purchase order not found' });
  }
  return res.send(doc);
});

export const updateVendorPurchaseOrder = catchAsync(async (req, res) => {
  const doc = await vendorPurchaseOrderService.updateVendorPurchaseOrderById(
    req.params.vendorPurchaseOrderId,
    req.body
  );

  if (doc.receivedLotDetails?.length > 0) {
    const boxResult = await vendorBoxService.bulkCreateVendorBoxes({
      vpoNumber: doc.vpoNumber,
    });
    return res.send({
      purchaseOrder: doc,
      boxProcessing: {
        createdCount: boxResult.createdCount,
        skippedLots: boxResult.skippedLots,
        message: boxResult.message,
      },
    });
  }

  res.send(doc);
});

export const deleteVendorPurchaseOrder = catchAsync(async (req, res) => {
  await vendorPurchaseOrderService.deleteVendorPurchaseOrderById(req.params.vendorPurchaseOrderId);
  res.status(httpStatus.NO_CONTENT).send();
});
