import { describe, test, expect } from '@jest/globals';
import {
  applyM2MergeBrandingFloorTransferData,
  articleHasBrandingInProcess,
  articleRequiresBrandOnM2Merge,
  buildSingleBrandM2MergeItems,
  extractBrandsFromProductStyleCodes,
  finalCheckingHasBrandReceivedData,
  formatM2MergeBrandRemarks,
  mergeTransferredDataByBrand,
  resolveM2MergeBrandContext,
  validateM2MergeBrandSplit,
  validateM2MergeTransferItems,
} from '../../../src/utils/brandQuantity.util.js';

const PRODUCT_STYLE_CODES = [
  { brand: 'Allen Solly', styleCode: 'A1' },
  { brand: 'Van Heusen', styleCode: 'V1' },
];

const SINGLE_BRAND_STYLE_CODES = [{ brand: 'Allen Solly', styleCode: 'A1' }];

const makeArticleStub = (overrides = {}) => ({
  floorQuantities: {
    finalChecking: {
      receivedData: [
        { transferred: 170, brand: 'Allen Solly', styleCode: '' },
        { transferred: 211, brand: 'Van Heusen', styleCode: '' },
      ],
      transferredData: [{ transferred: 101, brand: 'Van Heusen', styleCode: '' }],
    },
  },
  getFloorOrder: async () => [
    'Checking',
    'Washing',
    'Branding',
    'Final Checking',
    'Dispatch',
  ],
  ...overrides,
});

describe('brandQuantity.util — M2 merge brand', () => {
  describe('finalCheckingHasBrandReceivedData', () => {
    test('returns true when receivedData has brand rows', () => {
      expect(finalCheckingHasBrandReceivedData(makeArticleStub())).toBe(true);
    });

    test('returns false when no brand rows', () => {
      expect(
        finalCheckingHasBrandReceivedData({
          floorQuantities: { finalChecking: { receivedData: [{ transferred: 10 }] } },
        })
      ).toBe(false);
    });
  });

  describe('articleHasBrandingInProcess', () => {
    test('detects Branding floor', () => {
      expect(articleHasBrandingInProcess(['Checking', 'Branding', 'Final Checking'])).toBe(true);
    });

    test('detects Re-Boarding floor', () => {
      expect(articleHasBrandingInProcess(['Re-Boarding', 'Final Checking'])).toBe(true);
    });

    test('returns false without branding floors', () => {
      expect(articleHasBrandingInProcess(['Checking', 'Final Checking'])).toBe(false);
    });
  });

  describe('extractBrandsFromProductStyleCodes', () => {
    test('returns unique brand names from populated styleCode docs', () => {
      expect(extractBrandsFromProductStyleCodes(PRODUCT_STYLE_CODES)).toEqual([
        'Allen Solly',
        'Van Heusen',
      ]);
    });

    test('returns empty when styleCodes are unpopulated ObjectId refs', () => {
      expect(
        extractBrandsFromProductStyleCodes([
          '65f1a2b3c4d5e6f7g8h9i0j1',
          '65f1a2b3c4d5e6f7g8h9i0j2',
        ])
      ).toEqual([]);
    });
  });

  describe('resolveM2MergeBrandContext', () => {
    test('uses floor budget when FC receivedData has brands', () => {
      const article = makeArticleStub();
      const ctx = resolveM2MergeBrandContext(
        article,
        ['Checking', 'Final Checking', 'Dispatch'],
        ['Checking', 'Branding', 'Final Checking', 'Dispatch'],
        PRODUCT_STYLE_CODES
      );
      expect(ctx.required).toBe(true);
      expect(ctx.budgetMode).toBe('floor');
      expect(ctx.multiBrand).toBe(true);
      expect(ctx.autoAssignBrand).toBe(null);
    });

    test('uses product budget when FC has no brand receivedData (early Checking merge)', () => {
      const article = makeArticleStub({
        floorQuantities: { finalChecking: { receivedData: [], transferredData: [] } },
      });
      const ctx = resolveM2MergeBrandContext(
        article,
        ['Checking', 'Final Checking', 'Dispatch'],
        ['Checking', 'Branding', 'Final Checking', 'Dispatch'],
        PRODUCT_STYLE_CODES
      );
      expect(ctx.required).toBe(true);
      expect(ctx.budgetMode).toBe('product');
      expect(ctx.multiBrand).toBe(true);
    });

    test('auto-assigns single catalog brand', () => {
      const article = makeArticleStub({
        floorQuantities: { finalChecking: { receivedData: [], transferredData: [] } },
      });
      const ctx = resolveM2MergeBrandContext(
        article,
        ['Checking', 'Final Checking', 'Dispatch'],
        ['Checking', 'Branding', 'Final Checking', 'Dispatch'],
        SINGLE_BRAND_STYLE_CODES
      );
      expect(ctx.required).toBe(true);
      expect(ctx.multiBrand).toBe(false);
      expect(ctx.autoAssignBrand).toBe('Allen Solly');
    });

    test('returns none when process has no branding floor', () => {
      const ctx = resolveM2MergeBrandContext(
        makeArticleStub(),
        ['Checking', 'Final Checking'],
        ['Checking', 'Final Checking'],
        PRODUCT_STYLE_CODES
      );
      expect(ctx.required).toBe(false);
      expect(ctx.budgetMode).toBe('none');
    });
  });

  describe('articleRequiresBrandOnM2Merge', () => {
    test('requires brand when cascade includes Final Checking on branded article', async () => {
      const article = makeArticleStub();
      const required = await articleRequiresBrandOnM2Merge(
        article,
        ['Checking', 'Final Checking', 'Dispatch'],
        PRODUCT_STYLE_CODES
      );
      expect(required).toBe(true);
    });

    test('requires brand before branding feeds FC when product has brands', async () => {
      const article = makeArticleStub({
        floorQuantities: { finalChecking: { receivedData: [], transferredData: [] } },
      });
      const required = await articleRequiresBrandOnM2Merge(
        article,
        ['Checking', 'Final Checking', 'Dispatch'],
        PRODUCT_STYLE_CODES
      );
      expect(required).toBe(true);
    });

    test('skips brand when cascade has no Final Checking', async () => {
      const article = makeArticleStub();
      const required = await articleRequiresBrandOnM2Merge(
        article,
        ['Checking', 'Washing'],
        PRODUCT_STYLE_CODES
      );
      expect(required).toBe(false);
    });

    test('skips brand when process has no branding floor', async () => {
      const article = makeArticleStub({
        getFloorOrder: async () => ['Checking', 'Final Checking', 'Dispatch'],
      });
      const required = await articleRequiresBrandOnM2Merge(
        article,
        ['Checking', 'Final Checking'],
        PRODUCT_STYLE_CODES
      );
      expect(required).toBe(false);
    });

    test('skips brand when product has no catalog brands', async () => {
      const article = makeArticleStub();
      const required = await articleRequiresBrandOnM2Merge(
        article,
        ['Checking', 'Final Checking', 'Dispatch'],
        []
      );
      expect(required).toBe(false);
    });
  });

  describe('validateM2MergeBrandSplit', () => {
    test('accepts product-catalog brand split when floor data missing', () => {
      const ctx = resolveM2MergeBrandContext(
        makeArticleStub({ floorQuantities: { finalChecking: { receivedData: [], transferredData: [] } } }),
        ['Checking', 'Final Checking', 'Dispatch'],
        ['Checking', 'Branding', 'Final Checking', 'Dispatch'],
        PRODUCT_STYLE_CODES
      );
      const result = validateM2MergeBrandSplit(
        [{ transferred: 12, brand: 'Allen Solly' }, { transferred: 8, brand: 'Van Heusen' }],
        20,
        ctx
      );
      expect(result.valid).toBe(true);
    });

    test('rejects unknown brand in product mode', () => {
      const ctx = resolveM2MergeBrandContext(
        makeArticleStub({ floorQuantities: { finalChecking: { receivedData: [], transferredData: [] } } }),
        ['Checking', 'Final Checking', 'Dispatch'],
        ['Checking', 'Branding', 'Final Checking', 'Dispatch'],
        PRODUCT_STYLE_CODES
      );
      const result = validateM2MergeBrandSplit(
        [{ transferred: 20, brand: 'Unknown Brand' }],
        20,
        ctx
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/product catalog/);
    });
  });

  describe('buildSingleBrandM2MergeItems', () => {
    test('builds one line for full merge qty', () => {
      expect(buildSingleBrandM2MergeItems(15, 'Allen Solly')).toEqual([
        { transferred: 15, styleCode: '', brand: 'Allen Solly' },
      ]);
    });
  });

  describe('validateM2MergeTransferItems', () => {
    const receivedData = makeArticleStub().floorQuantities.finalChecking.receivedData;
    const transferredData = makeArticleStub().floorQuantities.finalChecking.transferredData;

    test('accepts valid brand split matching quantity', () => {
      const result = validateM2MergeTransferItems(
        [{ transferred: 6, brand: 'Allen Solly' }, { transferred: 4, brand: 'Van Heusen' }],
        10,
        receivedData,
        transferredData
      );
      expect(result.valid).toBe(true);
      expect(result.normalizedItems).toHaveLength(2);
    });

    test('rejects when sum does not match quantity', () => {
      const result = validateM2MergeTransferItems(
        [{ transferred: 5, brand: 'Allen Solly' }],
        10,
        receivedData,
        transferredData
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/must equal merge quantity/);
    });

    test('rejects unknown brand', () => {
      const result = validateM2MergeTransferItems(
        [{ transferred: 10, brand: 'Unknown Brand' }],
        10,
        receivedData,
        transferredData
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/not in Final Checking received/);
    });

    test('rejects when brand exceeds remaining budget', () => {
      const result = validateM2MergeTransferItems(
        [{ transferred: 200, brand: 'Van Heusen' }],
        200,
        receivedData,
        transferredData
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/exceeds remaining/);
    });

    test('rejects empty transferItems', () => {
      const result = validateM2MergeTransferItems([], 10, receivedData, transferredData);
      expect(result.valid).toBe(false);
    });
  });

  describe('mergeTransferredDataByBrand on M2 merge path', () => {
    test('increments finalChecking transferredData by brand', () => {
      const existing = [{ transferred: 101, brand: 'Van Heusen', styleCode: '' }];
      const incoming = [{ transferred: 10, brand: 'Van Heusen', styleCode: '' }];
      const merged = mergeTransferredDataByBrand(existing, incoming);
      const vh = merged.find((r) => r.brand === 'Van Heusen');
      expect(vh?.transferred).toBe(111);
    });
  });

  describe('formatM2MergeBrandRemarks', () => {
    test('formats brand summary for audit log', () => {
      const text = formatM2MergeBrandRemarks([
        { transferred: 10, brand: 'Van Heusen' },
        { transferred: 5, brand: 'Allen Solly' },
      ]);
      expect(text).toBe('10·Van Heusen; 5·Allen Solly');
    });
  });

  describe('applyM2MergeBrandingFloorTransferData', () => {
    const mergeItems = [
      { transferred: 1, brand: 'Peter England', styleCode: '' },
      { transferred: 2, brand: 'Allen Solly', styleCode: '' },
    ];

    const makeBrandingArticle = (brandingOverrides = {}, getFloorKey = (f) => (f === 'Branding' ? 'branding' : null)) => {
      const markModifiedCalls = [];
      return {
        floorQuantities: {
          branding: {
            received: 1960,
            completed: 0,
            transferred: 0,
            remaining: 1960,
            transferredData: [],
            receivedData: [],
            ...brandingOverrides,
          },
        },
        getFloorKey,
        markModified: (path) => markModifiedCalls.push(path),
        markModifiedCalls,
      };
    };

    test('updates branding transferredData and transferred when cascade includes Branding and prior transferred=0', () => {
      const article = makeBrandingArticle();
      applyM2MergeBrandingFloorTransferData(
        article,
        ['Secondary Checking', 'Branding', 'Final Checking', 'Dispatch'],
        mergeItems,
        3,
        PRODUCT_STYLE_CODES
      );

      const branding = article.floorQuantities.branding;
      expect(branding.transferred).toBe(3);
      expect(branding.remaining).toBe(1957);
      expect(branding.transferredData).toHaveLength(2);
      expect(branding.transferredData.find((r) => r.brand === 'Allen Solly')?.transferred).toBe(2);
      expect(branding.transferredData.find((r) => r.brand === 'Peter England')?.transferred).toBe(1);
      expect(article.markModifiedCalls).toContain('floorQuantities.branding');
    });

    test('does not double-bump transferred when cascade already incremented scalar', () => {
      const article = makeBrandingArticle({ transferred: 13, remaining: 1947 });
      applyM2MergeBrandingFloorTransferData(
        article,
        ['Secondary Checking', 'Branding', 'Final Checking', 'Dispatch'],
        mergeItems,
        3,
        PRODUCT_STYLE_CODES
      );

      expect(article.floorQuantities.branding.transferred).toBe(13);
      expect(article.floorQuantities.branding.transferredData).toHaveLength(2);
    });

    test('skips branding when cascade is FC-only (merge from Final Checking)', () => {
      const article = makeBrandingArticle();
      applyM2MergeBrandingFloorTransferData(
        article,
        ['Final Checking', 'Dispatch'],
        mergeItems,
        3,
        PRODUCT_STYLE_CODES
      );

      expect(article.floorQuantities.branding.transferred).toBe(0);
      expect(article.floorQuantities.branding.transferredData).toEqual([]);
      expect(article.markModifiedCalls).toEqual([]);
    });

    test('updates reBoarding bucket when Re-Boarding is in cascade', () => {
      const markModifiedCalls = [];
      const article = {
        floorQuantities: {
          reBoarding: {
            received: 500,
            transferred: 0,
            remaining: 500,
            transferredData: [],
            receivedData: [],
          },
        },
        getFloorKey: (f) => (f === 'Re-Boarding' ? 'reBoarding' : null),
        markModified: (path) => markModifiedCalls.push(path),
      };

      applyM2MergeBrandingFloorTransferData(
        article,
        ['Checking', 'Re-Boarding', 'Final Checking', 'Dispatch'],
        mergeItems,
        3,
        PRODUCT_STYLE_CODES
      );

      expect(article.floorQuantities.reBoarding.transferred).toBe(3);
      expect(article.floorQuantities.reBoarding.transferredData).toHaveLength(2);
      expect(markModifiedCalls).toContain('floorQuantities.reBoarding');
    });

    test('enriches styleCode from product catalog when receivedData has none', () => {
      const article = makeBrandingArticle();
      applyM2MergeBrandingFloorTransferData(
        article,
        ['Secondary Checking', 'Branding', 'Final Checking', 'Dispatch'],
        [{ transferred: 3, brand: 'Allen Solly', styleCode: '' }],
        3,
        PRODUCT_STYLE_CODES
      );

      expect(article.floorQuantities.branding.transferredData[0].styleCode).toBe('A1');
    });
  });
});
