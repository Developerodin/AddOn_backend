import mongoose from 'mongoose';
import { describe, test, expect } from '@jest/globals';
import Article from '../../../src/models/production/article.model.js';
import { applyCascadeMergeIncrement } from '../../../src/utils/m2Cascade.util.js';
import { LinkingType, Priority, OrderStatus } from '../../../src/models/production/enums.js';

/**
 * ORD-000078-style floor state before merging 100 M2 from Checking.
 * @returns {Object}
 */
function buildPreMergeFloorQuantities() {
  return {
    checking: {
      received: 200,
      completed: 100,
      remaining: 0,
      transferred: 100,
      m1Quantity: 100,
      m2Quantity: 100,
      m3Quantity: 0,
      m4Quantity: 0,
      m1Transferred: 100,
      m1Remaining: 0,
    },
    secondaryChecking: {
      received: 100,
      completed: 50,
      remaining: 0,
      transferred: 50,
      m1Quantity: 50,
      m2Quantity: 50,
      m3Quantity: 0,
      m4Quantity: 0,
      m1Transferred: 50,
      m1Remaining: 0,
    },
    finalChecking: {
      received: 50,
      completed: 30,
      remaining: 0,
      transferred: 30,
      m1Quantity: 30,
      m2Quantity: 20,
      m3Quantity: 0,
      m4Quantity: 0,
      m1Transferred: 30,
      m1Remaining: 0,
    },
  };
}

/**
 * Build in-memory article and mirror article.save() floor-quantity normalization.
 * @param {Object} floorQuantities
 * @returns {import('mongoose').Document}
 */
function makeArticle(floorQuantities) {
  const article = new Article({
    id: `mem-m2-cascade-${Date.now()}`,
    orderId: new mongoose.Types.ObjectId(),
    articleNumber: 'MEM-M2-CASCADE-TEST',
    plannedQuantity: 200,
    linkingType: LinkingType.AUTO_LINKING,
    priority: Priority.MEDIUM,
    status: OrderStatus.PENDING,
    floorQuantities,
  });
  article.isNew = false;
  return article;
}

/**
 * Run the same floor normalization path as article.save() pre-save hooks.
 * @param {import('mongoose').Document} article
 */
function runSaveFloorNormalization(article) {
  article.fixFloorDataCorruption();
  article.enforceFloorQuantityBounds();
}

describe('Article M2 merge cascade save normalization', () => {
  test('save hooks preserve downstream QC M1/Trf after Checking +100 cascade', () => {
    const article = makeArticle(buildPreMergeFloorQuantities());
    const mergeQty = 100;

    applyCascadeMergeIncrement(article, 'Checking', mergeQty, 'Checking');
    applyCascadeMergeIncrement(article, 'Secondary Checking', mergeQty, 'Checking');
    applyCascadeMergeIncrement(article, 'Final Checking', mergeQty, 'Checking');

    runSaveFloorNormalization(article);

    const checking = article.floorQuantities.checking;
    expect(checking.m1Quantity).toBe(200);
    expect(checking.m2Quantity).toBe(0);
    expect(checking.transferred).toBe(200);
    expect(checking.m1Transferred).toBe(200);

    const secondary = article.floorQuantities.secondaryChecking;
    expect(secondary.received).toBe(100);
    expect(secondary.m1Quantity).toBe(150);
    expect(secondary.m2Quantity).toBe(50);
    expect(secondary.transferred).toBe(150);
    expect(secondary.m1Transferred).toBe(150);

    const finalChecking = article.floorQuantities.finalChecking;
    expect(finalChecking.received).toBe(50);
    expect(finalChecking.m1Quantity).toBe(130);
    expect(finalChecking.m2Quantity).toBe(20);
    expect(finalChecking.transferred).toBe(130);
    expect(finalChecking.m1Transferred).toBe(130);
  });

  test('fixFloorDataCorruption alone does not scale down M1 after cascade', () => {
    const article = makeArticle(buildPreMergeFloorQuantities());
    applyCascadeMergeIncrement(article, 'Secondary Checking', 100, 'Checking');
    applyCascadeMergeIncrement(article, 'Final Checking', 100, 'Checking');

    article.fixFloorDataCorruption();

    expect(article.floorQuantities.secondaryChecking.m1Quantity).toBe(150);
    expect(article.floorQuantities.secondaryChecking.transferred).toBe(150);
    expect(article.floorQuantities.finalChecking.m1Quantity).toBe(130);
    expect(article.floorQuantities.finalChecking.transferred).toBe(130);
  });

  test('old behavior would have scaled M1 down — regression guard', () => {
    const article = makeArticle(buildPreMergeFloorQuantities());
    applyCascadeMergeIncrement(article, 'Secondary Checking', 100, 'Checking');
    applyCascadeMergeIncrement(article, 'Final Checking', 100, 'Checking');

    runSaveFloorNormalization(article);

    expect(article.floorQuantities.secondaryChecking.m1Quantity).not.toBe(75);
    expect(article.floorQuantities.secondaryChecking.m2Quantity).not.toBe(25);
    expect(article.floorQuantities.finalChecking.m1Quantity).not.toBe(43);
    expect(article.floorQuantities.finalChecking.m2Quantity).not.toBe(7);
  });
});
