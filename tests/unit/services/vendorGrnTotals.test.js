import {
  applyHeaderPatch,
  applyLineCommercial,
  attachFinancialTotals,
  backfillLotsFromVpo,
  computeVendorGrnFinancials,
  hydrateGrnCommercial,
  qtyTotalsEqual,
} from '../../../src/services/vendorManagement/vendorGrnTotals.js';

describe('vendorGrnTotals financial math', () => {
  const items = [{ amount: 39800, verifiedQty: 100, gstRate: 5 }];
  const outOfState = { state: 'Gujarat' };
  const inState = { state: 'Maharashtra' };

  test('applies rupee discount then GST on taxable value (IGST out of state)', () => {
    const t = computeVendorGrnFinancials(
      items,
      outOfState,
      { discountAmount: 300 },
      { applyAutoRoundOff: true }
    );
    expect(t.subTotal).toBe(39800);
    expect(t.discountAmount).toBe(300);
    expect(t.taxableValue).toBe(39500);
    expect(t.itemGst).toBeCloseTo(1975);
    expect(t.sgst).toBe(0);
    expect(t.cgst).toBe(0);
    expect(t.igst).toBeCloseTo(1975);
    expect(t.grandTotal).toBeCloseTo(41475);
    expect(t.taxLabel).toBe('IGST 5.0%');
  });

  test('adds freight with GST matching client GRN example', () => {
    const t = computeVendorGrnFinancials(
      items,
      outOfState,
      { discountAmount: 300, freightAmount: 1520, freightGstPercent: 5, roundOff: 0 },
      { applyAutoRoundOff: true }
    );
    expect(t.freightAmount).toBe(1520);
    expect(t.freightGst).toBeCloseTo(76);
    expect(t.roundOff).toBe(0);
    expect(t.grandTotal).toBeCloseTo(43071);
  });

  test('splits SGST/CGST for Maharashtra vendor', () => {
    const t = computeVendorGrnFinancials(
      [{ amount: 1000, verifiedQty: 10, gstRate: 5 }],
      inState,
      {},
      { applyAutoRoundOff: true }
    );
    expect(t.sgst).toBeCloseTo(25);
    expect(t.cgst).toBeCloseTo(25);
    expect(t.igst).toBe(0);
    expect(t.taxLabel).toBe('GST 5.0%');
  });

  test('caps discount at basic value', () => {
    const t = computeVendorGrnFinancials(
      [{ amount: 100, verifiedQty: 1, gstRate: 0 }],
      outOfState,
      { discountAmount: 500 },
      { applyAutoRoundOff: true }
    );
    expect(t.discountAmount).toBe(100);
    expect(t.taxableValue).toBe(0);
  });

  test('amountInWords reflects grand total', () => {
    const t = computeVendorGrnFinancials(
      [{ amount: 100, verifiedQty: 1, gstRate: 0 }],
      outOfState,
      {},
      { applyAutoRoundOff: true }
    );
    expect(t.amountInWords).toMatch(/Rupees Only$/);
  });
});

describe('vendorGrnTotals header patch', () => {
  const grn = {
    notes: '',
    discrepancyDetails: '',
    vendor: { state: 'Gujarat' },
    lots: [
      {
        lotNumber: 'INV-1',
        items: [
          {
            poItem: 'aaaaaaaaaaaaaaaaaaaaaaaa',
            productId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
            verifiedQty: 10,
            rate: 100,
            gstRate: 5,
            amount: 1000,
            unit: 'Pairs',
            hsnCode: '',
          },
        ],
      },
    ],
    totals: { expected: 10, verified: 10, variance: 0, m1: 10, m2: 0, m3: 0, m4: 0 },
    adjustments: {},
  };

  test('updates rate, hsn, unit and recomputes amount + totals', () => {
    const next = applyHeaderPatch(grn, {
      discountAmount: 50,
      freightAmount: 100,
      freightGstPercent: 5,
      roundOff: 0,
      lineCommercial: [
        {
          lotNumber: 'INV-1',
          poItem: 'aaaaaaaaaaaaaaaaaaaaaaaa',
          hsnCode: '64039990',
          rate: 200,
          unit: 'Pairs',
        },
      ],
    });
    expect(next.lots[0].items[0].hsnCode).toBe('64039990');
    expect(next.lots[0].items[0].rate).toBe(200);
    expect(next.lots[0].items[0].amount).toBe(2000);
    expect(next.adjustments.discountAmount).toBe(50);
    expect(next.totals.subTotal).toBe(2000);
    expect(next.totals.taxableValue).toBe(1950);
    expect(next.totals.expected).toBe(10);
    expect(next.totals.verified).toBe(10);
  });

  test('applyLineCommercial matches by productId when poItem omitted', () => {
    const lots = applyLineCommercial(grn.lots, [
      { productId: 'bbbbbbbbbbbbbbbbbbbbbbbb', rate: 50, hsnCode: '111' },
    ]);
    expect(lots[0].items[0].rate).toBe(50);
    expect(lots[0].items[0].amount).toBe(500);
    expect(lots[0].items[0].hsnCode).toBe('111');
  });
});

describe('vendorGrnTotals backfill and qty compare', () => {
  test('backfills missing rate/gstRate from VPO poItems', () => {
    const lots = [
      {
        lotNumber: 'INV-1',
        items: [
          {
            poItem: 'aaaaaaaaaaaaaaaaaaaaaaaa',
            productId: 'prodA',
            verifiedQty: 8,
          },
        ],
      },
    ];
    const vpo = {
      poItems: [
        { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', productId: 'prodA', rate: 12.5, gstRate: 5 },
      ],
    };
    const filled = backfillLotsFromVpo(lots, vpo);
    expect(filled[0].items[0].rate).toBe(12.5);
    expect(filled[0].items[0].gstRate).toBe(5);
    expect(filled[0].items[0].unit).toBe('Pairs');
    expect(filled[0].items[0].amount).toBe(100);
  });

  test('hydrate recomputes financial totals', () => {
    const hydrated = hydrateGrnCommercial(
      {
        vendor: { state: 'Delhi' },
        lots: [
          {
            lotNumber: 'L1',
            items: [{ poItem: 'aaaaaaaaaaaaaaaaaaaaaaaa', verifiedQty: 2, rate: 10, gstRate: 5 }],
          },
        ],
        totals: { expected: 2, verified: 2, variance: 0, m1: 2, m2: 0, m3: 0, m4: 0 },
        adjustments: { discountAmount: 0 },
      },
      null
    );
    expect(hydrated.lots[0].items[0].amount).toBe(20);
    expect(hydrated.totals.subTotal).toBe(20);
    expect(hydrated.totals.igst).toBeCloseTo(1);
    expect(hydrated.totals.expected).toBe(2);
  });

  test('qtyTotalsEqual ignores financial fields', () => {
    expect(
      qtyTotalsEqual(
        { expected: 1, verified: 1, variance: 0, m1: 1, m2: 0, m3: 0, m4: 0, grandTotal: 10 },
        { expected: 1, verified: 1, variance: 0, m1: 1, m2: 0, m3: 0, m4: 0, grandTotal: 99 }
      )
    ).toBe(true);
    expect(
      qtyTotalsEqual(
        { expected: 1, verified: 1, variance: 0, m1: 1, m2: 0, m3: 0, m4: 0 },
        { expected: 1, verified: 2, variance: 1, m1: 2, m2: 0, m3: 0, m4: 0 }
      )
    ).toBe(false);
  });

  test('attachFinancialTotals keeps qty keys', () => {
    const totals = attachFinancialTotals(
      { expected: 5, verified: 4, variance: -1, m1: 4, m2: 0, m3: 0, m4: 0 },
      [{ items: [{ amount: 40, verifiedQty: 4, gstRate: 0 }] }],
      { state: 'Delhi' },
      {}
    );
    expect(totals.expected).toBe(5);
    expect(totals.verified).toBe(4);
    expect(totals.subTotal).toBe(40);
  });
});
