import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import {
  VendorPurchaseOrder,
  VendorBox,
  VendorProductionFlow,
  VendorGrn,
  VendorPoVendorReturn,
  VendorPoReturnChallan,
} from '../../../src/models/index.js';
import VendorDispatchStockTransferNote from '../../../src/models/vendorManagement/vendorDispatchStockTransferNote.model.js';
import { renameVendorLotInvoice } from '../../../src/services/vendorManagement/vendorLotInvoiceRename.service.js';
import ApiError from '../../../src/utils/ApiError.js';

const poId = new mongoose.Types.ObjectId();

/**
 * Mongoose updateMany result in the 5.x nModified shape.
 * @param {number} n
 * @returns {{ nModified: number }}
 */
const updated = (n) => ({ nModified: n });

/**
 * Stub PO lookup and every cascade updateMany used by rename.
 * @param {object} po
 */
function stubRenameDeps(po) {
  jest.spyOn(VendorPurchaseOrder, 'findOne').mockResolvedValue(po);
  jest.spyOn(VendorBox, 'updateMany').mockResolvedValue(updated(4));
  jest.spyOn(VendorProductionFlow, 'updateMany').mockResolvedValue(updated(1));
  jest.spyOn(VendorGrn, 'updateMany').mockResolvedValue(updated(1));
  jest.spyOn(VendorDispatchStockTransferNote, 'updateMany').mockResolvedValue(updated(1));
  jest.spyOn(VendorPoVendorReturn, 'updateMany').mockResolvedValue(updated(0));
  jest.spyOn(VendorPoReturnChallan, 'updateMany').mockResolvedValue(updated(0));
}

describe('renameVendorLotInvoice', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('renames the VPO invoice and rewrites box lotNumber', async () => {
    const po = {
      _id: poId,
      vpoNumber: 'VPO-TEST',
      receivedLotDetails: [{ lotNumber: 'NH/26-27/0403' }, { lotNumber: 'NH/26-27/0404' }],
      markModified: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    stubRenameDeps(po);

    const result = await renameVendorLotInvoice({
      vpoNumber: 'VPO-TEST',
      fromLotNumber: 'NH/26-27/0403',
      toLotNumber: 'NH/26-27/0999',
    });

    expect(po.receivedLotDetails[0].lotNumber).toBe('NH/26-27/0999');
    expect(po.markModified).toHaveBeenCalledWith('receivedLotDetails');
    expect(po.save).toHaveBeenCalled();
    expect(VendorBox.updateMany).toHaveBeenCalledWith(
      { vpoNumber: 'VPO-TEST', lotNumber: 'NH/26-27/0403' },
      { $set: { lotNumber: 'NH/26-27/0999' } }
    );
    expect(result.unchanged).toBe(false);
    expect(result.boxesUpdated).toBe(4);
    expect(result.toLotNumber).toBe('NH/26-27/0999');
  });

  test('rejects a duplicate invoice number on the same PO', async () => {
    const po = {
      _id: poId,
      vpoNumber: 'VPO-TEST',
      receivedLotDetails: [{ lotNumber: 'NH/26-27/0403' }, { lotNumber: 'NH/26-27/0404' }],
      markModified: jest.fn(),
      save: jest.fn(),
    };
    stubRenameDeps(po);

    await expect(
      renameVendorLotInvoice({
        vpoNumber: 'VPO-TEST',
        fromLotNumber: 'NH/26-27/0403',
        toLotNumber: 'NH/26-27/0404',
      })
    ).rejects.toBeInstanceOf(ApiError);

    expect(po.save).not.toHaveBeenCalled();
    expect(VendorBox.updateMany).not.toHaveBeenCalled();
  });

  test('no-ops when from and to are the same', async () => {
    const result = await renameVendorLotInvoice({
      vpoNumber: 'VPO-TEST',
      fromLotNumber: 'NH/26-27/0403',
      toLotNumber: 'NH/26-27/0403',
    });
    expect(result.unchanged).toBe(true);
    expect(result.boxesUpdated).toBe(0);
  });
});
