import {
  buildMonthlySummaryFilter,
  computeMonthlySummaryTotals,
  flattenGrnToSummaryRows,
  flattenGrnsToSummaryRows,
  paginateMonthlySummaryRows,
  sumLotBoxes,
} from '../../../src/services/yarnManagement/yarnGrnMonthlySummary.util.js';
import { istMidnightUtc } from '../../../src/utils/istPeriod.util.js';

const buildGrn = (overrides = {}) => ({
  _id: 'grn-1',
  grnNumber: 'GRN-2026-0001',
  grnDate: new Date('2026-09-15T10:00:00+05:30'),
  poNumber: 'PO-2026-001',
  supplier: { name: 'Sutlej Textiles' },
  lots: [
    { numberOfBoxes: 5, voided: false },
    { numberOfBoxes: 3, voided: false },
  ],
  items: [
    { yarnName: '110/70', shadeCode: 'BG-01', quantity: 25, rate: 100, amount: 2500 },
    { yarnName: '120/80', shadeCode: 'RD-02', quantity: 10, rate: 200, amount: 2000 },
  ],
  totals: { gst: 225, grandTotal: 4725 },
  ...overrides,
});

describe('yarnGrnMonthlySummary.util', () => {
  describe('sumLotBoxes', () => {
    test('sums boxes and skips voided lots', () => {
      expect(
        sumLotBoxes([
          { numberOfBoxes: 5 },
          { numberOfBoxes: 2, voided: true },
          { numberOfBoxes: 3, voided: false },
        ])
      ).toBe(8);
    });
  });

  describe('flattenGrnToSummaryRows', () => {
    test('emits one row per yarn and blanks GST/grand total/boxes on row 2', () => {
      const rows = flattenGrnToSummaryRows(buildGrn());
      expect(rows).toHaveLength(2);

      expect(rows[0]).toMatchObject({
        grnId: 'grn-1',
        grnNumber: 'GRN-2026-0001',
        poNumber: 'PO-2026-001',
        supplier: 'Sutlej Textiles',
        numberOfBoxes: 8,
        yarnName: '110/70',
        shadeCode: 'BG-01',
        qty: 25,
        rate: 100,
        amount: 2500,
        gst: 225,
        grandTotal: 4725,
        isFirstItemOfGrn: true,
      });

      expect(rows[1]).toMatchObject({
        grnNumber: 'GRN-2026-0001',
        yarnName: '120/80',
        shadeCode: 'RD-02',
        qty: 10,
        amount: 2000,
        numberOfBoxes: null,
        gst: null,
        grandTotal: null,
        isFirstItemOfGrn: false,
      });
    });

    test('emits a single blank yarn row when items are empty', () => {
      const rows = flattenGrnToSummaryRows(buildGrn({ items: [] }));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        yarnName: '',
        shadeCode: '',
        qty: 0,
        rate: 0,
        amount: 0,
        numberOfBoxes: 8,
        gst: 225,
        grandTotal: 4725,
        isFirstItemOfGrn: true,
      });
    });
  });

  describe('computeMonthlySummaryTotals', () => {
    test('sums qty/amount across lines and GST/boxes/grand total once per GRN', () => {
      const rows = flattenGrnsToSummaryRows([
        buildGrn(),
        buildGrn({
          _id: 'grn-2',
          grnNumber: 'GRN-2026-0002',
          lots: [{ numberOfBoxes: 4 }],
          items: [{ yarnName: '80/20', shadeCode: 'NV-09', quantity: 5, rate: 50, amount: 250 }],
          totals: { gst: 12.5, grandTotal: 262.5 },
        }),
      ]);
      const totals = computeMonthlySummaryTotals(rows);
      expect(totals).toEqual({
        grnCount: 2,
        lineCount: 3,
        boxes: 12,
        qty: 40,
        amount: 4750,
        gst: 237.5,
        grandTotal: 4987.5,
      });
    });
  });

  describe('paginateMonthlySummaryRows', () => {
    test('slices by page and reports totalPages from line count', () => {
      const rows = flattenGrnToSummaryRows(buildGrn());
      const page1 = paginateMonthlySummaryRows(rows, 1, 1);
      expect(page1.results).toHaveLength(1);
      expect(page1.results[0].yarnName).toBe('110/70');
      expect(page1.totalPages).toBe(2);
      expect(page1.totalResults).toBe(2);

      const page2 = paginateMonthlySummaryRows(rows, 2, 1);
      expect(page2.results[0].yarnName).toBe('120/80');
    });
  });

  describe('buildMonthlySummaryFilter IST month bounds', () => {
    test('uses IST midnight of the 1st and exclusive next-month start', () => {
      const { filter, period } = buildMonthlySummaryFilter({ year: 2026, month: 9 });
      expect(period.monthStart.getTime()).toBe(istMidnightUtc(2026, 9, 1).getTime());
      expect(period.monthEndExclusive.getTime()).toBe(istMidnightUtc(2026, 10, 1).getTime());
      expect(filter.status).toBe('active');
      expect(filter.grnDate.$gte).toEqual(period.monthStart);
      expect(filter.grnDate.$lt).toEqual(period.monthEndExclusive);
    });

    test('adds a case-insensitive supplier regex when provided', () => {
      const { filter } = buildMonthlySummaryFilter({
        year: 2026,
        month: 9,
        supplierName: 'Sutlej',
      });
      expect(filter['supplier.name'].$options).toBe('i');
      expect(filter['supplier.name'].$regex).toBe('Sutlej');
    });
  });
});
