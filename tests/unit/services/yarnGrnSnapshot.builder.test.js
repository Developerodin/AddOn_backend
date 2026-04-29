import {
  buildSnapshot,
  buildSupplierSnapshot,
  buildLotsSnapshot,
  buildItemsSnapshot,
  computeTotals,
  computeSnapshotDiff,
  lotMaterialChange,
  numberToWords,
} from '../../../src/services/yarnManagement/yarnGrnSnapshot.builder.js';

const buildPo = () => ({
  _id: 'po-id',
  poNumber: 'PO-2026-001',
  createDate: new Date('2026-04-01T00:00:00Z'),
  supplierName: 'Sutlej Textiles',
  supplier: {
    _id: 'sup-id',
    brandName: 'Sutlej Textiles',
    contactNumber: '+91-9999',
    email: 'sales@sutlej.in',
    address: 'Mumbai',
    city: 'Mumbai',
    state: 'Maharashtra',
    gstNo: '27ABC',
  },
  poItems: [
    {
      _id: 'pi-1',
      yarnName: '110/70',
      sizeCount: '110/70',
      shadeCode: 'BG-01',
      rate: 100,
      quantity: 50,
      gstRate: 5,
    },
    {
      _id: 'pi-2',
      yarnName: '120/80',
      sizeCount: '120/80',
      shadeCode: 'RD-02',
      rate: 200,
      quantity: 30,
      gstRate: 5,
    },
  ],
  receivedLotDetails: [
    {
      lotNumber: 'LOT-A',
      numberOfCones: 20,
      totalWeight: 100,
      numberOfBoxes: 5,
      poItems: [
        { poItem: 'pi-1', receivedQuantity: 25 },
      ],
    },
    {
      lotNumber: 'LOT-B',
      numberOfCones: 10,
      totalWeight: 50,
      numberOfBoxes: 2,
      poItems: [
        { poItem: 'pi-2', receivedQuantity: 15 },
      ],
    },
  ],
  gst: 187.5,
  total: 3937.5,
  notes: 'Sample',
});

describe('yarnGrnSnapshot.builder', () => {
  describe('numberToWords', () => {
    test('handles zero', () => {
      expect(numberToWords(0)).toBe('Zero Rupees');
    });
    test('formats simple numbers', () => {
      expect(numberToWords(1)).toMatch(/^One Rupees$/);
      expect(numberToWords(21)).toMatch(/^Twenty One Rupees$/);
      expect(numberToWords(100)).toMatch(/^One Hundred Rupees$/);
    });
    test('formats lakh and crore values', () => {
      expect(numberToWords(150000)).toMatch(/Lakh/);
      expect(numberToWords(15000000)).toMatch(/Crore/);
    });
  });

  describe('buildSupplierSnapshot', () => {
    test('extracts populated supplier fields verbatim', () => {
      const sup = buildSupplierSnapshot(buildPo());
      expect(sup).toMatchObject({
        name: 'Sutlej Textiles',
        contactNumber: '+91-9999',
        email: 'sales@sutlej.in',
        state: 'Maharashtra',
        gstNo: '27ABC',
      });
    });
  });

  describe('buildLotsSnapshot', () => {
    test('returns only requested lots, hydrated with item details', () => {
      const lots = buildLotsSnapshot(buildPo(), ['LOT-A']);
      expect(lots).toHaveLength(1);
      expect(lots[0]).toMatchObject({
        lotNumber: 'LOT-A',
        numberOfCones: 20,
        totalWeight: 100,
        numberOfBoxes: 5,
        voided: false,
      });
      expect(lots[0].poItems[0]).toMatchObject({
        receivedQuantity: 25,
        yarnName: '110/70',
        shadeCode: 'BG-01',
        rate: 100,
      });
    });

    test('returns empty when no lot numbers match', () => {
      expect(buildLotsSnapshot(buildPo(), ['DOES-NOT-EXIST'])).toEqual([]);
    });
  });

  describe('buildItemsSnapshot', () => {
    test('aggregates received quantities across multiple lots', () => {
      const po = buildPo();
      // Both lots feed into pi-1 (synthetic merge to test aggregation)
      po.receivedLotDetails[1].poItems = [{ poItem: 'pi-1', receivedQuantity: 5 }];
      const lots = buildLotsSnapshot(po, ['LOT-A', 'LOT-B']);
      const items = buildItemsSnapshot(po, lots);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        yarnName: '110/70',
        quantity: 30,
        rate: 100,
        amount: 3000,
      });
    });

    test('falls back to all PO items when lots have no breakdown', () => {
      const po = buildPo();
      const lots = buildLotsSnapshot(po, ['LOT-A']).map((l) => ({ ...l, poItems: [] }));
      const items = buildItemsSnapshot(po, lots);
      expect(items).toHaveLength(2);
    });
  });

  describe('computeTotals', () => {
    test('splits GST evenly for in-state suppliers and labels GST', () => {
      const po = buildPo();
      const supplier = buildSupplierSnapshot(po);
      const items = [{ amount: 1000, quantity: 10, gstRate: 5 }];
      const t = computeTotals(items, po, supplier);
      expect(t.subTotal).toBe(1000);
      expect(t.totalQty).toBe(10);
      expect(t.taxLabel).toBe('GST 5.0%');
      expect(t.sgst).toBeCloseTo(po.gst / 2);
      expect(t.cgst).toBeCloseTo(po.gst / 2);
      expect(t.igst).toBe(0);
      expect(t.amountInWords).toMatch(/Rupees/);
    });

    test('uses IGST for out-of-state suppliers', () => {
      const po = buildPo();
      po.supplier.state = 'Delhi';
      const supplier = buildSupplierSnapshot(po);
      const t = computeTotals([{ amount: 100, quantity: 1, gstRate: 5 }], po, supplier);
      expect(t.taxLabel).toBe('IGST 5.0%');
      expect(t.sgst).toBe(0);
      expect(t.cgst).toBe(0);
      expect(t.igst).toBeCloseTo(po.gst);
    });
  });

  describe('lotMaterialChange', () => {
    const baseLot = {
      lotNumber: 'L1',
      numberOfCones: 10,
      totalWeight: 50,
      numberOfBoxes: 2,
      poItems: [{ poItem: 'pi-1', receivedQuantity: 25 }],
    };

    test('false when lots are identical', () => {
      expect(lotMaterialChange(baseLot, { ...baseLot })).toBe(false);
    });
    test('true when totalWeight changes', () => {
      expect(lotMaterialChange(baseLot, { ...baseLot, totalWeight: 60 })).toBe(true);
    });
    test('true when numberOfCones changes', () => {
      expect(lotMaterialChange(baseLot, { ...baseLot, numberOfCones: 11 })).toBe(true);
    });
    test('true when received quantity changes', () => {
      expect(
        lotMaterialChange(baseLot, {
          ...baseLot,
          poItems: [{ poItem: 'pi-1', receivedQuantity: 30 }],
        })
      ).toBe(true);
    });
    test('true when poItems set differs', () => {
      expect(
        lotMaterialChange(baseLot, {
          ...baseLot,
          poItems: [
            { poItem: 'pi-1', receivedQuantity: 25 },
            { poItem: 'pi-2', receivedQuantity: 5 },
          ],
        })
      ).toBe(true);
    });
    test('false when status flips only (status not on schema diff)', () => {
      expect(
        lotMaterialChange(
          { ...baseLot, status: 'lot_pending' },
          { ...baseLot, status: 'lot_accepted' }
        )
      ).toBe(false);
    });
  });

  describe('buildSnapshot', () => {
    test('combines supplier, consignee, lots, items and totals', () => {
      const snap = buildSnapshot(buildPo(), ['LOT-A']);
      expect(snap.supplier.name).toBe('Sutlej Textiles');
      expect(snap.consignee.stateCode).toBe('27');
      expect(snap.lots).toHaveLength(1);
      expect(snap.items).toHaveLength(1);
      expect(snap.totals.subTotal).toBeGreaterThan(0);
    });
  });

  describe('computeSnapshotDiff', () => {
    test('returns empty diff for identical snapshots', () => {
      const a = buildSnapshot(buildPo(), ['LOT-A']);
      const b = buildSnapshot(buildPo(), ['LOT-A']);
      expect(computeSnapshotDiff(a, b)).toEqual([]);
    });
    test('captures totalWeight changes inside a lot', () => {
      const before = buildSnapshot(buildPo(), ['LOT-A']);
      const editedPo = buildPo();
      editedPo.receivedLotDetails[0].totalWeight = 200;
      const after = buildSnapshot(editedPo, ['LOT-A']);
      const diff = computeSnapshotDiff(before, after);
      const lotDiff = diff.find((d) => d.field === 'lots.LOT-A.totalWeight');
      expect(lotDiff).toBeDefined();
      expect(lotDiff.before).toBe(100);
      expect(lotDiff.after).toBe(200);
    });
  });
});
