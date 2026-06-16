import { jest, describe, test, expect } from '@jest/globals';
import {
  applyCascadeMergeIncrement,
  assessM2MergeToM1Eligibility,
  recalcQcFloorRemaining,
} from '../../../src/utils/m2Cascade.util.js';
import { ProductionFloor } from '../../../src/models/production/enums.js';

/**
 * Minimal article stub for cascade merge tests.
 * @param {Object} floorQuantities
 * @returns {Object}
 */
const makeArticleStub = (floorQuantities = {}) => ({
  floorQuantities,
  getFloorKey: (label) => {
    const map = {
      Checking: 'checking',
      Washing: 'washing',
      Boarding: 'boarding',
      Branding: 'branding',
      'Secondary Checking': 'secondaryChecking',
      'Final Checking': 'finalChecking',
      Dispatch: 'dispatch',
    };
    return map[label] || label;
  },
  markModified: jest.fn(),
});

describe('m2Cascade.util', () => {
  describe('applyCascadeMergeIncrement — Checking as source', () => {
    test('bumps m1Transferred with m1, keeps received flat, REM stable', () => {
      const article = makeArticleStub({
        checking: {
          received: 1015,
          m1Quantity: 1000,
          m2Quantity: 16,
          m3Quantity: 0,
          m4Quantity: 0,
          m1Transferred: 1001,
          transferred: 1001,
          completed: 1000,
        },
      });

      recalcQcFloorRemaining(article.floorQuantities.checking);
      const remBefore = article.floorQuantities.checking.remaining;

      applyCascadeMergeIncrement(article, 'Checking', 11, 'Checking');

      const fd = article.floorQuantities.checking;
      expect(fd.received).toBe(1015);
      expect(fd.m2Quantity).toBe(5);
      expect(fd.m1Quantity).toBe(1011);
      expect(fd.m1Transferred).toBe(1012);
      expect(fd.transferred).toBe(1012);
      expect(fd.remaining).toBe(remBefore);
    });
  });

  describe('applyCascadeMergeIncrement — Secondary Checking as source', () => {
    test('A571-style merge: M1 and TRF +5, M2 -5, REM unchanged', () => {
      const article = makeArticleStub({
        secondaryChecking: {
          received: 1011,
          m1Quantity: 1005,
          m2Quantity: 5,
          m3Quantity: 0,
          m4Quantity: 1,
          m1Transferred: 995,
          transferred: 995,
        },
      });

      recalcQcFloorRemaining(article.floorQuantities.secondaryChecking);
      expect(article.floorQuantities.secondaryChecking.remaining).toBe(10);

      applyCascadeMergeIncrement(article, 'Secondary Checking', 5, 'Secondary Checking');

      const fd = article.floorQuantities.secondaryChecking;
      expect(fd.received).toBe(1011);
      expect(fd.m1Quantity).toBe(1010);
      expect(fd.m1Transferred).toBe(1000);
      expect(fd.transferred).toBe(1000);
      expect(fd.m2Quantity).toBe(0);
      expect(fd.remaining).toBe(10);
    });
  });

  describe('applyCascadeMergeIncrement — Final Checking as source', () => {
    test('bumps m1Transferred on Final source merge', () => {
      const article = makeArticleStub({
        finalChecking: {
          received: 200,
          m1Quantity: 190,
          m2Quantity: 10,
          m1Transferred: 180,
          transferred: 180,
        },
      });

      recalcQcFloorRemaining(article.floorQuantities.finalChecking);
      const remBefore = article.floorQuantities.finalChecking.remaining;

      applyCascadeMergeIncrement(article, 'Final Checking', 10, 'Final Checking');

      const fd = article.floorQuantities.finalChecking;
      expect(fd.m1Quantity).toBe(200);
      expect(fd.m1Transferred).toBe(190);
      expect(fd.m2Quantity).toBe(0);
      expect(fd.remaining).toBe(remBefore);
    });
  });

  describe('applyCascadeMergeIncrement — washing floor', () => {
    test('cascade bumps received, completed, and transferred', () => {
      const article = makeArticleStub({
        washing: {
          received: 1001,
          completed: 1001,
          transferred: 1001,
          remaining: 0,
        },
      });

      applyCascadeMergeIncrement(article, 'Washing', 11, 'Checking');

      const fd = article.floorQuantities.washing;
      expect(fd.received).toBe(1012);
      expect(fd.completed).toBe(1012);
      expect(fd.transferred).toBe(1012);
      expect(fd.remaining).toBe(0);
    });
  });

  describe('applyCascadeMergeIncrement — downstream QC floor', () => {
    test('increments m1 and m1Transferred without received bump', () => {
      const article = makeArticleStub({
        secondaryChecking: {
          received: 500,
          m1Quantity: 490,
          m2Quantity: 3,
          m1Transferred: 480,
          transferred: 480,
        },
      });

      applyCascadeMergeIncrement(article, 'Secondary Checking', 11, 'Checking');

      const fd = article.floorQuantities.secondaryChecking;
      expect(fd.received).toBe(500);
      expect(fd.m1Quantity).toBe(501);
      expect(fd.m1Transferred).toBe(491);
      expect(fd.transferred).toBe(491);
      expect(fd.m2Quantity).toBe(3);
    });
  });

  describe('assessM2MergeToM1Eligibility', () => {
    test('blocks when article is not yet on Dispatch floor', () => {
      const article = makeArticleStub({
        checking: {
          received: 1020,
          m1Quantity: 990,
          m2Quantity: 25,
          m1Transferred: 0,
        },
      });

      const result = assessM2MergeToM1Eligibility(article);
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/received on Dispatch floor/i);
    });

    test('allows merge when dispatch received > 0', () => {
      const article = makeArticleStub({
        checking: { received: 1020, m2Quantity: 25 },
        dispatch: { received: 100 },
      });

      const result = assessM2MergeToM1Eligibility(article);
      expect(result.eligible).toBe(true);
      expect(result.reason).toBeNull();
    });

    test('allows merge when currentFloor is Dispatch even if received is 0', () => {
      const article = {
        ...makeArticleStub({ checking: { m2Quantity: 5 } }),
        currentFloor: ProductionFloor.DISPATCH,
      };

      const result = assessM2MergeToM1Eligibility(article);
      expect(result.eligible).toBe(true);
    });
  });
});
