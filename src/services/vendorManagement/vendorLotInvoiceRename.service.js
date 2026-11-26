import httpStatus from 'http-status';
import {
  VendorPurchaseOrder,
  VendorBox,
  VendorProductionFlow,
  VendorGrn,
  VendorPoVendorReturn,
  VendorPoReturnChallan,
} from '../../models/index.js';
import VendorDispatchStockTransferNote from '../../models/vendorManagement/vendorDispatchStockTransferNote.model.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Count of documents actually changed by an updateMany (Mongoose 5 or 6).
 * @param {{ modifiedCount?: number, nModified?: number }|null|undefined} result
 * @returns {number}
 */
const modifiedCount = (result) => Number(result?.modifiedCount ?? result?.nModified ?? 0);

/**
 * Rename nested lotNumber on array paths that match the old invoice.
 * @param {import('mongoose').Model} Model
 * @param {object} parentFilter
 * @param {string} arrayPath
 * @param {string} from
 * @param {string} to
 * @returns {Promise<number>}
 */
const renameNestedLotNumber = async (Model, parentFilter, arrayPath, from, to) => {
  const result = await Model.updateMany(
    { ...parentFilter, [`${arrayPath}.lotNumber`]: from },
    { $set: { [`${arrayPath}.$[row].lotNumber`]: to } },
    { arrayFilters: [{ 'row.lotNumber': from }] }
  );
  return modifiedCount(result);
};

/**
 * Cascade a vendor invoice / lot number rename onto boxes and derived records.
 * @param {object} args
 * @param {import('mongoose').Types.ObjectId} args.poId
 * @param {string} args.vpoNumber
 * @param {string} args.from
 * @param {string} args.to
 * @returns {Promise<{ boxesUpdated: number, flowsUpdated: number, grnsUpdated: number, stnUpdated: number }>}
 */
const cascadeInvoiceRename = async ({ poId, vpoNumber, from, to }) => {
  const lotStatusFrom = `lot:${from}`;
  const lotStatusTo = `lot:${to}`;

  const [boxRes, flowRefRes, flowLotRes, flowStatusRes, grnRes, stnRes] = await Promise.all([
    VendorBox.updateMany({ vpoNumber, lotNumber: from }, { $set: { lotNumber: to } }),
    VendorProductionFlow.updateMany(
      { vendorPurchaseOrder: poId, referenceCode: from },
      { $set: { referenceCode: to } }
    ),
    VendorProductionFlow.updateMany(
      { vendorPurchaseOrder: poId, 'floorQuantities.secondaryChecking.receivedData.lotNumber': from },
      { $set: { 'floorQuantities.secondaryChecking.receivedData.$[row].lotNumber': to } },
      { arrayFilters: [{ 'row.lotNumber': from }] }
    ),
    VendorProductionFlow.updateMany(
      {
        vendorPurchaseOrder: poId,
        'floorQuantities.secondaryChecking.receivedData.receivedStatusFromPreviousFloor': lotStatusFrom,
      },
      {
        $set: {
          'floorQuantities.secondaryChecking.receivedData.$[row].receivedStatusFromPreviousFloor': lotStatusTo,
        },
      },
      { arrayFilters: [{ 'row.receivedStatusFromPreviousFloor': lotStatusFrom }] }
    ),
    VendorGrn.updateMany(
      { vendorPurchaseOrder: poId, 'lots.lotNumber': from },
      { $set: { 'lots.$[lot].lotNumber': to } },
      { arrayFilters: [{ 'lot.lotNumber': from }] }
    ),
    VendorDispatchStockTransferNote.updateMany(
      {
        $or: [{ vendorPurchaseOrderId: poId }, { vpoNumber }],
        'lines.invoiceNumber': from,
      },
      { $set: { 'lines.$[line].invoiceNumber': to } },
      { arrayFilters: [{ 'line.invoiceNumber': from }] }
    ),
  ]);

  await Promise.all([
    renameNestedLotNumber(VendorPoVendorReturn, { vendorPurchaseOrder: poId }, 'boxLines', from, to),
    renameNestedLotNumber(VendorPoVendorReturn, { vendorPurchaseOrder: poId }, 'm4Lines', from, to),
    renameNestedLotNumber(VendorPoVendorReturn, { vendorPurchaseOrder: poId }, 'pendingM4Lines', from, to),
    renameNestedLotNumber(VendorPoVendorReturn, { vendorPurchaseOrder: poId }, 'pendingArticleQtyLines', from, to),
    renameNestedLotNumber(VendorPoVendorReturn, { vendorPurchaseOrder: poId }, 'articleQtyLines', from, to),
    renameNestedLotNumber(VendorPoReturnChallan, { vendorPurchaseOrder: poId }, 'lines', from, to),
  ]);

  return {
    boxesUpdated: modifiedCount(boxRes),
    flowsUpdated: modifiedCount(flowRefRes) + modifiedCount(flowLotRes) + modifiedCount(flowStatusRes),
    grnsUpdated: modifiedCount(grnRes),
    stnUpdated: modifiedCount(stnRes),
  };
};

/**
 * Rename a saved goods-received invoice number on a VPO and rewrite the same
 * value on boxes (lotNumber) plus GRN / STN / production-flow copies.
 * @param {{ vpoNumber: string, fromLotNumber: string, toLotNumber: string }} params
 * @returns {Promise<{ fromLotNumber: string, toLotNumber: string, unchanged: boolean, boxesUpdated: number, flowsUpdated: number, grnsUpdated: number, stnUpdated: number }>}
 */
export const renameVendorLotInvoice = async ({ vpoNumber, fromLotNumber, toLotNumber }) => {
  const vpo = String(vpoNumber || '').trim();
  const from = String(fromLotNumber || '').trim();
  const to = String(toLotNumber || '').trim();

  if (!vpo) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'vpoNumber is required');
  }
  if (!from) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Current invoice number is required');
  }
  if (!to) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'New invoice number is required');
  }

  if (from === to) {
    return {
      fromLotNumber: from,
      toLotNumber: to,
      unchanged: true,
      boxesUpdated: 0,
      flowsUpdated: 0,
      grnsUpdated: 0,
      stnUpdated: 0,
    };
  }

  const po = await VendorPurchaseOrder.findOne({ vpoNumber: vpo });
  if (!po) {
    throw new ApiError(httpStatus.NOT_FOUND, `Vendor purchase order ${vpo} not found`);
  }

  const lots = po.receivedLotDetails || [];
  const fromIdx = lots.findIndex((lot) => String(lot.lotNumber || '').trim() === from);
  if (fromIdx < 0) {
    throw new ApiError(httpStatus.NOT_FOUND, `Invoice "${from}" not found on ${vpo}`);
  }

  const clash = lots.some((lot, idx) => idx !== fromIdx && String(lot.lotNumber || '').trim() === to);
  if (clash) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Invoice "${to}" already exists on this PO`);
  }

  lots[fromIdx].lotNumber = to;
  po.markModified('receivedLotDetails');
  await po.save();

  const cascade = await cascadeInvoiceRename({
    poId: po._id,
    vpoNumber: vpo,
    from,
    to,
  });

  return {
    fromLotNumber: from,
    toLotNumber: to,
    unchanged: false,
    ...cascade,
  };
};
