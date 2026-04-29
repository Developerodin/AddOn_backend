import mongoose from 'mongoose';
import setupTestDB from '../utils/setupTestDB.js';
import { YarnGrn, YarnPurchaseOrder } from '../../src/models/index.js';
import * as yarnGrnService from '../../src/services/yarnManagement/yarnGrn.service.js';

setupTestDB();

const buildPoSeed = (overrides = {}) => ({
  poNumber: 'PO-2026-TEST-001',
  supplierName: 'Test Supplier',
  supplier: mongoose.Types.ObjectId(),
  poItems: [
    {
      yarnName: 'Test Yarn 110/70',
      yarnCatalogId: mongoose.Types.ObjectId(),
      sizeCount: '110/70',
      shadeCode: 'BG-01',
      rate: 100,
      quantity: 50,
      gstRate: 5,
    },
  ],
  subTotal: 5000,
  gst: 250,
  total: 5250,
  currentStatus: 'in_transit',
  receivedLotDetails: [],
  ...overrides,
});

const buildLot = (lotNumber, poItemId, overrides = {}) => ({
  lotNumber,
  numberOfCones: 20,
  totalWeight: 100,
  numberOfBoxes: 5,
  poItems: [{ poItem: poItemId, receivedQuantity: 25 }],
  status: 'lot_qc_pending',
  ...overrides,
});

const reloadPo = async (id) => {
  const po = await YarnPurchaseOrder.findById(id)
    .populate('poItems.yarnCatalogId')
    .populate('supplier')
    .lean();
  return po;
};

describe('yarnGrn.service (integration)', () => {
  describe('generateGrnNumber', () => {
    test('mints GRN-YYYY-0001 when no GRN exists', async () => {
      const number = await yarnGrnService.generateGrnNumber();
      expect(number).toMatch(new RegExp(`^GRN-${new Date().getFullYear()}-0001$`));
    });

    test('increments sequentially per call', async () => {
      const a = await yarnGrnService.generateGrnNumber();
      // Simulate a doc using that number so the next call sees it
      const po = await YarnPurchaseOrder.create(buildPoSeed());
      await YarnGrn.create({
        grnNumber: a,
        baseGrnNumber: a,
        purchaseOrder: po._id,
        poNumber: po.poNumber,
        lots: [],
        items: [],
        totals: {},
        supplier: { name: 'x' },
        consignee: {},
      });
      const b = await yarnGrnService.generateGrnNumber();
      expect(b).not.toBe(a);
      expect(parseInt(b.split('-')[2], 10)).toBe(parseInt(a.split('-')[2], 10) + 1);
    });

    test('skips revision suffixes when scanning highest', async () => {
      const po = await YarnPurchaseOrder.create(buildPoSeed());
      await YarnGrn.create({
        grnNumber: 'GRN-2026-0050',
        baseGrnNumber: 'GRN-2026-0050',
        purchaseOrder: po._id,
        poNumber: po.poNumber,
        lots: [],
        items: [],
        totals: {},
        supplier: { name: 'x' },
        consignee: {},
      });
      await YarnGrn.create({
        grnNumber: 'GRN-2026-0050-R1',
        baseGrnNumber: 'GRN-2026-0050',
        revisionNo: 1,
        purchaseOrder: po._id,
        poNumber: po.poNumber,
        lots: [],
        items: [],
        totals: {},
        supplier: { name: 'x' },
        consignee: {},
      });
      const next = await yarnGrnService.generateGrnNumber();
      expect(next).toBe('GRN-2026-0051');
    });
  });

  describe('createGrnFromNewLots', () => {
    test('creates a GRN, links it to the PO, and snapshots supplier/items', async () => {
      const seed = buildPoSeed();
      seed.receivedLotDetails = [buildLot('LOT-1', seed.poItems[0]._id || mongoose.Types.ObjectId())];
      const po = await YarnPurchaseOrder.create(seed);
      const populated = await reloadPo(po._id);

      const grn = await yarnGrnService.createGrnFromNewLots(populated, ['LOT-1'], { username: 'tester', email: 't@e' });
      expect(grn).toBeTruthy();
      expect(grn.grnNumber).toMatch(/^GRN-\d{4}-\d{4}$/);
      expect(grn.revisionNo).toBe(0);
      expect(grn.lots).toHaveLength(1);
      expect(grn.poNumber).toBe(populated.poNumber);

      const refreshed = await YarnPurchaseOrder.findById(po._id).lean();
      expect(refreshed.grnHistory).toHaveLength(1);
      expect(refreshed.grnHistory[0].toString()).toBe(grn._id.toString());
    });

    test('returns null when no new lot numbers supplied', async () => {
      const populated = await reloadPo((await YarnPurchaseOrder.create(buildPoSeed()))._id);
      const grn = await yarnGrnService.createGrnFromNewLots(populated, [], {});
      expect(grn).toBeNull();
    });
  });

  describe('reviseAffectedGrns', () => {
    test('issues GRN-XXXX-R1 and supersedes the parent when a lot field is edited', async () => {
      const seed = buildPoSeed();
      const lot = buildLot('LOT-1', mongoose.Types.ObjectId());
      seed.receivedLotDetails = [lot];
      const po = await YarnPurchaseOrder.create(seed);
      const populated = await reloadPo(po._id);
      const original = await yarnGrnService.createGrnFromNewLots(populated, ['LOT-1'], { username: 't' });

      // Simulate weight correction on the lot
      await YarnPurchaseOrder.updateOne(
        { _id: po._id, 'receivedLotDetails.lotNumber': 'LOT-1' },
        { $set: { 'receivedLotDetails.$.totalWeight': 200 } }
      );
      const updated = await reloadPo(po._id);

      const revisions = await yarnGrnService.reviseAffectedGrns(updated, ['LOT-1'], { username: 't' }, 'Weight correction');
      expect(revisions).toHaveLength(1);
      const r1 = revisions[0];
      expect(r1.grnNumber).toBe(`${original.grnNumber}-R1`);
      expect(r1.revisionNo).toBe(1);
      expect(r1.revisionReason).toBe('Weight correction');
      expect((r1.revisionDiff || []).some((d) => d.field === 'lots.LOT-1.totalWeight')).toBe(true);

      const reloadedOriginal = await YarnGrn.findById(original._id).lean();
      expect(reloadedOriginal.status).toBe('superseded');
      expect(reloadedOriginal.supersededByGrn.toString()).toBe(r1._id.toString());

      const refreshedPo = await YarnPurchaseOrder.findById(po._id).lean();
      expect(refreshedPo.grnHistory).toHaveLength(2);
    });

    test('a second edit issues R2 against the latest active revision', async () => {
      const seed = buildPoSeed();
      seed.receivedLotDetails = [buildLot('LOT-X', mongoose.Types.ObjectId())];
      const po = await YarnPurchaseOrder.create(seed);
      let populated = await reloadPo(po._id);
      await yarnGrnService.createGrnFromNewLots(populated, ['LOT-X'], { username: 't' });

      await YarnPurchaseOrder.updateOne(
        { _id: po._id, 'receivedLotDetails.lotNumber': 'LOT-X' },
        { $set: { 'receivedLotDetails.$.totalWeight': 150 } }
      );
      populated = await reloadPo(po._id);
      await yarnGrnService.reviseAffectedGrns(populated, ['LOT-X'], { username: 't' }, 'first');

      await YarnPurchaseOrder.updateOne(
        { _id: po._id, 'receivedLotDetails.lotNumber': 'LOT-X' },
        { $set: { 'receivedLotDetails.$.totalWeight': 200 } }
      );
      populated = await reloadPo(po._id);
      const r2s = await yarnGrnService.reviseAffectedGrns(populated, ['LOT-X'], { username: 't' }, 'second');
      expect(r2s).toHaveLength(1);
      expect(r2s[0].revisionNo).toBe(2);
      expect(r2s[0].grnNumber).toMatch(/-R2$/);
    });
  });

  describe('queryGrns and getters', () => {
    test('paginate filters by poNumber and excludes superseded by default', async () => {
      const seed = buildPoSeed();
      seed.receivedLotDetails = [buildLot('LOT-Q', mongoose.Types.ObjectId())];
      const po = await YarnPurchaseOrder.create(seed);
      const populated = await reloadPo(po._id);
      await yarnGrnService.createGrnFromNewLots(populated, ['LOT-Q'], { username: 't' });

      const page = await yarnGrnService.queryGrns({ poNumber: po.poNumber, status: 'active' }, {});
      expect(page.totalResults).toBe(1);
      expect(page.results[0].poNumber).toBe(po.poNumber);
    });

    test('getRevisionsOf returns parent + revisions sorted oldest→newest', async () => {
      const seed = buildPoSeed();
      seed.receivedLotDetails = [buildLot('LOT-Z', mongoose.Types.ObjectId())];
      const po = await YarnPurchaseOrder.create(seed);
      let populated = await reloadPo(po._id);
      const original = await yarnGrnService.createGrnFromNewLots(populated, ['LOT-Z'], { username: 't' });

      await YarnPurchaseOrder.updateOne(
        { _id: po._id, 'receivedLotDetails.lotNumber': 'LOT-Z' },
        { $set: { 'receivedLotDetails.$.totalWeight': 150 } }
      );
      populated = await reloadPo(po._id);
      await yarnGrnService.reviseAffectedGrns(populated, ['LOT-Z'], { username: 't' }, 'fix');

      const chain = await yarnGrnService.getRevisionsOf(original._id);
      expect(chain).toHaveLength(2);
      expect(chain[0].revisionNo).toBe(0);
      expect(chain[1].revisionNo).toBe(1);
    });
  });
});
