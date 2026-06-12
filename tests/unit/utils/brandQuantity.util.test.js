import { describe, test, expect } from '@jest/globals';
import {
  articleHasBrandingInProcess,
  articleRequiresBrandOnM2Merge,
  finalCheckingHasBrandReceivedData,
  formatM2MergeBrandRemarks,
  mergeTransferredDataByBrand,
  validateM2MergeTransferItems,
} from '../../../src/utils/brandQuantity.util.js';

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

  describe('articleRequiresBrandOnM2Merge', () => {
    test('requires brand when cascade includes Final Checking on branded article', async () => {
      const article = makeArticleStub();
      const required = await articleRequiresBrandOnM2Merge(article, [
        'Checking',
        'Final Checking',
        'Dispatch',
      ]);
      expect(required).toBe(true);
    });

    test('skips brand when cascade has no Final Checking', async () => {
      const article = makeArticleStub();
      const required = await articleRequiresBrandOnM2Merge(article, ['Checking', 'Washing']);
      expect(required).toBe(false);
    });

    test('skips brand when process has no branding floor', async () => {
      const article = makeArticleStub({
        getFloorOrder: async () => ['Checking', 'Final Checking', 'Dispatch'],
      });
      const required = await articleRequiresBrandOnM2Merge(article, ['Checking', 'Final Checking']);
      expect(required).toBe(false);
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
});
