import { OrderStatus } from '../../../src/models/production/enums.js';
import {
  KnitPendingBucket,
  TERMINAL_QUEUE_STATUSES,
  HIDDEN_FROM_QUEUE_STATUSES,
  isLiveQueueStatus,
  isTerminalQueueStatus,
  isClosedOnMachineStatus,
  normalizeQueueStatus,
  resolveKnitPendingBucket,
} from '../../../src/services/production/knittingQueueStatus.js';
import {
  aggregateKnitPendingBuckets,
  indexQueueByArticle,
  keepArticlesOnExistingOrders,
  keepArticlesListedOnOrders,
  collectListedArticleIds,
  toUnplannedArticleRow,
} from '../../../src/services/production/knittingPendingBuckets.service.js';
import { resolveArticleKnittingPendingQuantity } from '../../../src/services/production/machinePendingQuantity.service.js';

/** Builds a lean-shaped Article doc with a knitting remaining balance. */
const article = (id, { planned = 100, completed = 0, remaining } = {}) => ({
  _id: id,
  articleNumber: `ART-${id}`,
  plannedQuantity: planned,
  floorQuantities: {
    knitting: {
      received: planned,
      completed,
      remaining: remaining != null ? remaining : Math.max(0, planned - completed),
    },
  },
});

/** Builds a lean-shaped assignment with one queue row per (articleId, status). */
const assignment = (activeNeedle, rows) => ({
  activeNeedle,
  isActive: true,
  productionOrderItems: rows.map(([articleId, status]) => ({ article: articleId, status })),
});

describe('knittingQueueStatus', () => {
  test('a missing status is treated as Pending, not as terminal', () => {
    expect(normalizeQueueStatus(undefined)).toBe(OrderStatus.PENDING);
    expect(normalizeQueueStatus('')).toBe(OrderStatus.PENDING);
    expect(isLiveQueueStatus(undefined)).toBe(true);
  });

  test('terminal set covers exactly the four closed statuses', () => {
    expect([...TERMINAL_QUEUE_STATUSES].sort()).toEqual(
      [OrderStatus.CANCELLED, OrderStatus.COMPLETED, OrderStatus.ON_HOLD, OrderStatus.SHORT_CLOSE].sort()
    );
    expect(isTerminalQueueStatus(OrderStatus.IN_PROGRESS)).toBe(false);
    expect(isTerminalQueueStatus(OrderStatus.PENDING)).toBe(false);
  });

  test('Short Close counts as terminal for pending math', () => {
    // Regression: machinePendingQuantity used to omit Short Close, so the
    // per-machine drawer read higher than both reports.
    expect(isTerminalQueueStatus(OrderStatus.SHORT_CLOSE)).toBe(true);
  });

  test('closed-on-machine is Completed and Cancelled only', () => {
    expect(isClosedOnMachineStatus(OrderStatus.COMPLETED)).toBe(true);
    expect(isClosedOnMachineStatus(OrderStatus.CANCELLED)).toBe(true);
    expect(isClosedOnMachineStatus(OrderStatus.SHORT_CLOSE)).toBe(false);
    expect(isClosedOnMachineStatus(OrderStatus.ON_HOLD)).toBe(false);
  });

  test('queue display rule keeps Cancelled visible', () => {
    // Display and pending rules are intentionally different.
    expect(HIDDEN_FROM_QUEUE_STATUSES).not.toContain(OrderStatus.CANCELLED);
    expect(TERMINAL_QUEUE_STATUSES).toContain(OrderStatus.CANCELLED);
  });
});

describe('resolveKnitPendingBucket', () => {
  test('no queue row at all means unplanned', () => {
    expect(resolveKnitPendingBucket(undefined)).toBe(KnitPendingBucket.UNPLANNED);
    expect(resolveKnitPendingBucket([])).toBe(KnitPendingBucket.UNPLANNED);
  });

  test('any live row wins over every terminal row', () => {
    expect(
      resolveKnitPendingBucket([OrderStatus.CANCELLED, OrderStatus.SHORT_CLOSE, OrderStatus.PENDING])
    ).toBe(KnitPendingBucket.ON_MACHINE);
  });

  test('short close outranks other terminal statuses so hold keeps reporting', () => {
    expect(resolveKnitPendingBucket([OrderStatus.COMPLETED, OrderStatus.SHORT_CLOSE])).toBe(
      KnitPendingBucket.SHORT_CLOSED
    );
  });

  test('Completed and Cancelled land in closed-on-machine', () => {
    expect(resolveKnitPendingBucket([OrderStatus.COMPLETED])).toBe(KnitPendingBucket.CLOSED_ON_MACHINE);
    expect(resolveKnitPendingBucket([OrderStatus.CANCELLED])).toBe(KnitPendingBucket.CLOSED_ON_MACHINE);
  });

  test('only ever On Hold lands in the paused bucket', () => {
    expect(resolveKnitPendingBucket([OrderStatus.ON_HOLD])).toBe(KnitPendingBucket.ON_HOLD);
  });
});

describe('indexQueueByArticle', () => {
  test('collects every status per article and only live needles', () => {
    const { statusesByArticle, liveNeedlesByArticle } = indexQueueByArticle([
      assignment('84', [['a1', OrderStatus.IN_PROGRESS]]),
      assignment('108', [['a1', OrderStatus.CANCELLED]]),
    ]);

    expect([...statusesByArticle.get('a1')].sort()).toEqual(
      [OrderStatus.CANCELLED, OrderStatus.IN_PROGRESS].sort()
    );
    expect([...liveNeedlesByArticle.get('a1')]).toEqual(['84']);
  });

  test('a blank active needle falls into the Not set bucket', () => {
    const { liveNeedlesByArticle } = indexQueueByArticle([
      assignment('   ', [['a1', OrderStatus.PENDING]]),
    ]);
    expect([...liveNeedlesByArticle.get('a1')]).toEqual(['Not set']);
  });
});

describe('aggregateKnitPendingBuckets', () => {
  test('splits pending across buckets and never double counts a needle', () => {
    const articles = [
      article('live', { planned: 100, remaining: 100 }),
      article('unplanned', { planned: 40, remaining: 40 }),
      article('shortClosed', { planned: 30, remaining: 30 }),
      article('cancelled', { planned: 20, remaining: 20 }),
      article('completed', { planned: 10, remaining: 10 }),
      article('held', { planned: 5, remaining: 5 }),
    ];
    const assignments = [
      assignment('84', [
        ['live', OrderStatus.IN_PROGRESS],
        ['shortClosed', OrderStatus.SHORT_CLOSE],
        ['cancelled', OrderStatus.CANCELLED],
      ]),
      // Same article live on a second machine must not be counted twice.
      assignment('108', [
        ['live', OrderStatus.PENDING],
        ['completed', OrderStatus.COMPLETED],
        ['held', OrderStatus.ON_HOLD],
      ]),
    ];

    const { buckets, pendingQty, onMachineByNeedle } = aggregateKnitPendingBuckets(
      articles,
      assignments
    );

    expect(buckets[KnitPendingBucket.ON_MACHINE]).toBe(100);
    expect(buckets[KnitPendingBucket.UNPLANNED]).toBe(40);
    expect(buckets[KnitPendingBucket.SHORT_CLOSED]).toBe(30);
    expect(buckets[KnitPendingBucket.CLOSED_ON_MACHINE]).toBe(30);
    expect(buckets[KnitPendingBucket.ON_HOLD]).toBe(5);

    expect(pendingQty).toBe(140);
    expect(onMachineByNeedle.get('84')).toBe(100);
    expect(onMachineByNeedle.has('108')).toBe(false);
  });

  test('reconciliation identity: buckets always sum to total remaining', () => {
    const articles = [
      article('a', { planned: 100, completed: 40 }),
      article('b', { planned: 60, remaining: 60 }),
      article('c', { planned: 25, remaining: 25 }),
      article('d', { planned: 15, remaining: 0 }),
    ];
    const assignments = [
      assignment('84', [
        ['a', OrderStatus.IN_PROGRESS],
        ['c', OrderStatus.CANCELLED],
      ]),
    ];

    const { buckets } = aggregateKnitPendingBuckets(articles, assignments);
    const bucketSum = Object.values(buckets).reduce((sum, qty) => sum + qty, 0);

    // a: 100-40=60 live, b: 60 unplanned, c: 25 cancelled, d: 0 contributes nothing
    expect(bucketSum).toBe(145);
    expect(buckets[KnitPendingBucket.ON_MACHINE]).toBe(60);
    expect(buckets[KnitPendingBucket.UNPLANNED]).toBe(60);
    expect(buckets[KnitPendingBucket.CLOSED_ON_MACHINE]).toBe(25);
  });

  test('an article with nothing left to knit is ignored entirely', () => {
    const { buckets, articleCountByBucket } = aggregateKnitPendingBuckets(
      [article('done', { planned: 100, completed: 100, remaining: 0 })],
      []
    );
    expect(buckets[KnitPendingBucket.UNPLANNED]).toBe(0);
    expect(articleCountByBucket[KnitPendingBucket.UNPLANNED]).toBe(0);
  });

  test('negative remaining is clamped, never subtracted from a bucket', () => {
    const { buckets } = aggregateKnitPendingBuckets(
      [article('over', { planned: 100, remaining: -25 })],
      []
    );
    expect(buckets[KnitPendingBucket.UNPLANNED]).toBe(0);
  });
});

describe('keepArticlesOnExistingOrders', () => {
  test('drops articles whose orderId is missing from the order set', () => {
    const kept = keepArticlesOnExistingOrders(
      [
        { _id: 'a1', orderId: 'o1' },
        { _id: 'a2', orderId: 'missing' },
        { _id: 'a3', orderId: { _id: 'o2' } },
      ],
      new Set(['o1', 'o2'])
    );
    expect(kept.map((a) => String(a._id))).toEqual(['a1', 'a3']);
  });
});

describe('keepArticlesListedOnOrders', () => {
  test('drops articles whose orderId still points at an order they were removed from', () => {
    const listed = collectListedArticleIds([
      { _id: 'o1', articles: ['a1', { _id: 'a3' }] },
    ]);
    expect([...listed].sort()).toEqual(['a1', 'a3']);
    const kept = keepArticlesListedOnOrders(
      [
        { _id: 'a1', orderId: 'o1', articleNumber: 'A101' },
        { _id: 'a2', orderId: 'o1', articleNumber: 'A101-dropped' },
        { _id: 'a3', orderId: 'o1', articleNumber: 'A580' },
      ],
      listed
    );
    expect(kept.map((a) => a.articleNumber)).toEqual(['A101', 'A580']);
  });
});

describe('toUnplannedArticleRow', () => {
  test('copies article, order number and order name for the planning table', () => {
    expect(
      toUnplannedArticleRow(
        { _id: 'art1', articleNumber: 'A582', orderId: 'ord1' },
        2200,
        { orderNumber: 'PO-9', orderNote: 'SS26 basic' }
      )
    ).toEqual({
      articleId: 'art1',
      articleNumber: 'A582',
      orderId: 'ord1',
      orderNumber: 'PO-9',
      orderNote: 'SS26 basic',
      qty: 2200,
    });
  });
});

describe('resolveArticleKnittingPendingQuantity', () => {
  test('reads knitting.remaining, same field as Article View Rem', () => {
    expect(
      resolveArticleKnittingPendingQuantity({
        plannedQuantity: 500,
        floorQuantities: { knitting: { remaining: 80, completed: 10 } },
      })
    ).toBe(80);
  });

  test('does not invent remaining from planned minus completed', () => {
    expect(
      resolveArticleKnittingPendingQuantity({
        plannedQuantity: 500,
        floorQuantities: { knitting: { completed: 100 } },
      })
    ).toBe(0);
  });

  test('missing remaining is 0, matching Article View Rem ?? 0', () => {
    expect(resolveArticleKnittingPendingQuantity({ plannedQuantity: 200 })).toBe(0);
  });
});
