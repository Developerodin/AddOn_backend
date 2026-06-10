import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { Supplier, YarnCatalog } from '../../../src/models/index.js';
import {
  buildReturnChallanSnapshot,
  buildVendorConsigneeSnapshot,
  resolvePoSupplier,
} from '../../../src/services/yarnManagement/yarnPoReturnChallanSnapshot.builder.js';

const buildPopulatedPo = () => ({
  _id: 'po-id',
  poNumber: 'PO-2026-001',
  supplierName: 'Sutlej Textiles',
  supplier: {
    _id: 'sup-id',
    brandName: 'Sutlej Textiles',
    contactNumber: '+91-9999',
    email: 'sales@sutlej.in',
    address: 'Plot 12, Industrial Area',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
    country: 'India',
    gstNo: '27ABCDE1234F1Z5',
  },
});

const buildVendorReturn = () => ({
  lines: [
    {
      barcode: 'YC-001',
      coneWeight: 1.5,
      tearWeight: 0.1,
      netWeight: 1.4,
      lotNumber: 'LOT-A',
      boxId: 'BOX-1',
    },
  ],
  cancellationIntent: 'partial',
  remark: 'Shade mismatch',
  completedAt: new Date('2026-06-01T00:00:00Z'),
});

describe('yarnPoReturnChallanSnapshot.builder', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolvePoSupplier', () => {
    test('returns embedded supplier when populated doc has no valid ObjectId', async () => {
      const po = buildPopulatedPo();
      const resolved = await resolvePoSupplier(po);
      expect(resolved).toMatchObject({
        brandName: 'Sutlej Textiles',
        address: 'Plot 12, Industrial Area',
      });
    });

    test('fetches supplier by id when PO only stores ObjectId', async () => {
      const supplierId = new mongoose.Types.ObjectId();
      const leanDoc = {
        brandName: 'Fetched Vendor',
        address: 'Remote Road',
        city: 'Pune',
        state: 'Maharashtra',
        gstNo: '27FETCHED123',
        contactNumber: '+91-8888',
      };
      jest.spyOn(Supplier, 'findById').mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(leanDoc),
        }),
      });

      const resolved = await resolvePoSupplier({
        supplierName: 'Fetched Vendor',
        supplier: supplierId,
      });

      expect(Supplier.findById).toHaveBeenCalledWith(String(supplierId));
      expect(resolved).toMatchObject(leanDoc);
    });

    test('prefers DB fetch over partial embedded populate when supplier id is valid', async () => {
      const supplierId = new mongoose.Types.ObjectId();
      const leanDoc = {
        _id: supplierId,
        brandName: 'Sutlej Textiles',
        address: 'Full Address From DB',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        gstNo: '27ABCDE1234F1Z5',
        contactNumber: '+91-9999',
      };
      jest.spyOn(Supplier, 'findById').mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(leanDoc),
        }),
      });

      const resolved = await resolvePoSupplier({
        supplierName: 'Sutlej Textiles',
        supplier: { _id: supplierId, brandName: 'Sutlej Textiles' },
      });

      expect(Supplier.findById).toHaveBeenCalledWith(String(supplierId));
      expect(resolved).toMatchObject({
        address: 'Full Address From DB',
        gstNo: '27ABCDE1234F1Z5',
      });
    });
  });

  describe('buildVendorConsigneeSnapshot', () => {
    test('maps populated vendor fields into consignee shape with supplierId', async () => {
      const consignee = await buildVendorConsigneeSnapshot(buildPopulatedPo());
      expect(consignee).toMatchObject({
        supplierId: 'sup-id',
        name: 'Sutlej Textiles',
        address: 'Plot 12, Industrial Area',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        gstNo: '27ABCDE1234F1Z5',
        contactNumber: '+91-9999',
        stateCode: '27',
      });
    });

    test('stores full snapshot fields even when supplier id resolves from ObjectId ref', async () => {
      const supplierId = new mongoose.Types.ObjectId();
      const leanDoc = {
        _id: supplierId,
        brandName: 'Fetched Vendor',
        address: 'Remote Road',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
        country: 'India',
        gstNo: '27FETCHED123',
        contactNumber: '+91-8888',
        contactPersonName: 'Rep',
        email: 'rep@vendor.in',
      };
      jest.spyOn(Supplier, 'findById').mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(leanDoc),
        }),
      });

      const consignee = await buildVendorConsigneeSnapshot({
        supplierName: 'Fetched Vendor',
        supplier: supplierId,
      });

      expect(consignee).toMatchObject({
        supplierId,
        name: 'Fetched Vendor',
        address: 'Remote Road',
        gstNo: '27FETCHED123',
        contactNumber: '+91-8888',
      });
    });
  });

  describe('buildReturnChallanSnapshot', () => {
    test('sets supplier to ADDON HOLDINGS PRIVATE LIMITED and consignee to vendor', async () => {
      jest.spyOn(YarnCatalog, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      });

      const snapshot = await buildReturnChallanSnapshot(buildVendorReturn(), buildPopulatedPo());

      expect(snapshot.supplier).toMatchObject({
        name: 'ADDON HOLDINGS PRIVATE LIMITED',
        gstNo: '27AAACA8827A1ZZ',
      });
      expect(snapshot.consignee).toMatchObject({
        supplierId: 'sup-id',
        name: 'Sutlej Textiles',
        address: 'Plot 12, Industrial Area',
        gstNo: '27ABCDE1234F1Z5',
        contactNumber: '+91-9999',
      });
      expect(snapshot.totals).toMatchObject({
        coneCount: 1,
        totalNetWeight: 1.4,
        totalGrossWeight: 1.5,
      });
    });
  });
});
