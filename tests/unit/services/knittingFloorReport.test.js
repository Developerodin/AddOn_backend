import {
  mergeKnittingReportBuckets,
  finalizeKnittingReportRows,
  computeKnittingReportColumnTotals,
  filterKnittingReportRows,
  bucketKey,
} from '../../../src/services/production/knittingFloorReport.merge.js';
import { resolveKnittingReportIstRange } from '../../../src/services/production/knittingFloorReport.service.js';
import ApiError from '../../../src/utils/ApiError.js';

describe('knittingFloorReport.merge', () => {
  it('merges knit and m4 aggregates on the same bucket key', () => {
    const knitAgg = [
      {
        _id: { orderId: 'o1', articleId: 'a1', machineId: 'm1' },
        knittingOutput: 100,
      },
    ];
    const m4Agg = [
      {
        _id: { orderId: 'o1', articleId: 'a1', machineId: 'm1' },
        m4Qty: 5,
        machineCode: 'K-12',
      },
    ];
    const buckets = mergeKnittingReportBuckets(knitAgg, m4Agg);
    const row = buckets.get(bucketKey('o1', 'a1', 'm1'));
    expect(row.knittingOutput).toBe(100);
    expect(row.m4Qty).toBe(5);
    expect(row.machineCode).toBe('K-12');
  });

  it('keeps separate rows per machine on the same article', () => {
    const knitAgg = [
      { _id: { orderId: 'o1', articleId: 'a1', machineId: 'm1' }, knittingOutput: 10 },
      { _id: { orderId: 'o1', articleId: 'a1', machineId: 'm2' }, knittingOutput: 20 },
    ];
    const buckets = mergeKnittingReportBuckets(knitAgg, []);
    expect(buckets.size).toBe(2);
  });

  it('includes m4-only rows when filtering finalized output', () => {
    const buckets = mergeKnittingReportBuckets(
      [],
      [{ _id: { orderId: 'o1', articleId: 'a1', machineId: '' }, m4Qty: 3 }]
    );
    const rows = finalizeKnittingReportRows(
      new Map([...buckets.entries()].map(([k, v]) => {
        v.orderNumber = 'ORD-1';
        v.articleNumber = 'A100';
        return [k, v];
      }))
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].m4Qty).toBe(3);
    expect(rows[0].knittingOutput).toBe(0);
  });

  it('sums column totals without double-counting order qty across machines', () => {
    const totals = computeKnittingReportColumnTotals([
      {
        orderId: 'o1',
        articleId: 'a1',
        plannedQuantity: 100,
        knittingOutput: 10,
        m4Qty: 1,
      },
      {
        orderId: 'o1',
        articleId: 'a1',
        plannedQuantity: 100,
        knittingOutput: 20,
        m4Qty: 2,
      },
    ]);
    expect(totals.plannedQuantity).toBe(100);
    expect(totals.knittingOutput).toBe(30);
    expect(totals.m4Qty).toBe(3);
  });

  it('filterKnittingReportRows matches order, article, or machine code', () => {
    const rows = [
      {
        orderNumber: 'ORD-100',
        articleNumber: 'A1',
        machineCode: 'K-01',
      },
      {
        orderNumber: 'ORD-200',
        articleNumber: 'B22',
        machineCode: 'K-02',
      },
    ];
    expect(filterKnittingReportRows(rows, 'ord-1')).toHaveLength(1);
    expect(filterKnittingReportRows(rows, 'b22')).toHaveLength(1);
    expect(filterKnittingReportRows(rows, 'k-02')).toHaveLength(1);
    expect(filterKnittingReportRows(rows, '')).toHaveLength(2);
  });

  it('excludes buckets with zero knit and zero m4', () => {
    const buckets = new Map([
      [
        'x',
        {
          orderId: 'o1',
          articleId: 'a1',
          machineId: '',
          knittingOutput: 0,
          m4Qty: 0,
          machineCode: '—',
          orderNumber: 'ORD-1',
          articleNumber: 'A1',
        },
      ],
    ]);
    expect(finalizeKnittingReportRows(buckets)).toHaveLength(0);
  });
});

describe('resolveKnittingReportIstRange', () => {
  it('parses inclusive IST window', () => {
    const { rangeStart, rangeEndExclusive, startKey, endKey } = resolveKnittingReportIstRange(
      '2025-11-01',
      '2025-11-15'
    );
    expect(startKey).toBe('2025-11-01');
    expect(endKey).toBe('2025-11-15');
    expect(rangeStart.toISOString()).toBe('2025-10-31T18:30:00.000Z');
    expect(rangeEndExclusive.toISOString()).toBe('2025-11-15T18:30:00.000Z');
  });

  it('rejects end before start', () => {
    expect(() => resolveKnittingReportIstRange('2025-11-10', '2025-11-01')).toThrow(ApiError);
  });
});