import { Article } from '../../models/production/index.js';
import { getFloorKeyFromName, aggregateFloorStats } from '../../utils/floorLabelMap.js';

/**
 * Daily trend series for the efficiency and quality reports.
 *
 * Both series used to run one `Article.find` per day per floor; a 30-day
 * efficiency report over twelve floors meant 360 round trips. They now load the
 * whole range once and bucket in memory, which keeps the numbers identical
 * because the same `aggregateFloorStats` helper does the maths.
 */

/** End-of-day boundary the original per-day queries used (`$lt`, not `$lte`). */
const DAY_END_SUFFIX = 'T23:59:59.999Z';

/**
 * Build the list of `YYYY-MM-DD` keys the trend covers.
 * @param {string} startDate - Inclusive first day.
 * @param {string} endDate - Inclusive last day.
 * @returns {string[]} Ordered day keys.
 */
const buildDayKeys = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
  const keys = [];
  for (let i = 0; i < days; i += 1) {
    const currentDate = new Date(start);
    currentDate.setDate(start.getDate() + i);
    keys.push(currentDate.toISOString().split('T')[0]);
  }
  return keys;
};

/**
 * Load every article that had work on the floor inside the trend window and
 * group it by the day of `updatedAt`.
 * @param {string} floorKey - camelCase floorQuantities key.
 * @param {string[]} dayKeys - Output of {@link buildDayKeys}.
 * @returns {Promise<Map<string, Array<Object>>>} Articles per day key.
 */
const loadArticlesByDay = async (floorKey, dayKeys) => {
  const byDay = new Map(dayKeys.map((key) => [key, []]));
  if (dayKeys.length === 0) return byDay;

  const articles = await Article.find({
    [`floorQuantities.${floorKey}.received`]: { $gt: 0 },
    updatedAt: {
      $gte: new Date(dayKeys[0]),
      $lt: new Date(`${dayKeys[dayKeys.length - 1]}${DAY_END_SUFFIX}`),
    },
  })
    .select('floorQuantities updatedAt')
    .lean();

  for (const article of articles) {
    const updatedAt = article.updatedAt instanceof Date ? article.updatedAt : new Date(article.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) continue;
    // The per-day queries ended at `$lt 23:59:59.999`, so the final millisecond
    // of a day never belonged to it. Keep that boundary exactly.
    if (updatedAt.getUTCHours() === 23 && updatedAt.getUTCMinutes() === 59 && updatedAt.getUTCSeconds() === 59 && updatedAt.getUTCMilliseconds() === 999) {
      continue;
    }
    const bucket = byDay.get(updatedAt.toISOString().split('T')[0]);
    if (bucket) bucket.push(article);
  }

  return byDay;
};

/**
 * Daily efficiency trend for one floor.
 * @param {string} floor - ProductionFloor enum value.
 * @param {string} startDate - Inclusive first day (`YYYY-MM-DD`).
 * @param {string} endDate - Inclusive last day (`YYYY-MM-DD`).
 * @returns {Promise<Array<{ date: string, totalQuantity: number, completedQuantity: number, wipQuantity: number, efficiency: number }>>}
 */
export const getDailyEfficiencyTrend = async (floor, startDate, endDate) => {
  const floorKey = getFloorKeyFromName(floor);
  if (!floorKey) return [];

  const dayKeys = buildDayKeys(startDate, endDate);
  const byDay = await loadArticlesByDay(floorKey, dayKeys);

  return dayKeys.map((dateStr) => {
    const stats = aggregateFloorStats(byDay.get(dateStr) || [], floorKey);
    return {
      date: dateStr,
      totalQuantity: stats.totalReceived,
      completedQuantity: stats.totalCompleted,
      wipQuantity: stats.totalRemaining,
      efficiency: stats.totalReceived > 0 ? Math.round((stats.totalCompleted / stats.totalReceived) * 100) : 0,
    };
  });
};

/**
 * Daily quality trend for one QC floor.
 * @param {string} floor - ProductionFloor enum value.
 * @param {string} startDate - Inclusive first day (`YYYY-MM-DD`).
 * @param {string} endDate - Inclusive last day (`YYYY-MM-DD`).
 * @returns {Promise<Array<Object>>} One row per day, same keys as before.
 */
export const getQualityTrend = async (floor, startDate, endDate) => {
  const floorKey = getFloorKeyFromName(floor) || 'finalChecking';

  const dayKeys = buildDayKeys(startDate, endDate);
  const byDay = await loadArticlesByDay(floorKey, dayKeys);

  return dayKeys.map((dateStr) => {
    const stats = aggregateFloorStats(byDay.get(dateStr) || [], floorKey);
    const m1Quantity = stats.m1Total;
    const m2Quantity = stats.m2Total;
    const m3Quantity = stats.m3Total;
    const m4Quantity = stats.m4Total;
    const totalQualityQuantity = m1Quantity + m2Quantity + m3Quantity + m4Quantity;

    return {
      date: dateStr,
      m1Quantity,
      m2Quantity,
      m3Quantity,
      m4Quantity,
      totalQualityQuantity,
      qualityRate: totalQualityQuantity > 0 ? Math.round((m1Quantity / totalQualityQuantity) * 100) : 0,
      firstPassYield: stats.totalReceived > 0 ? Math.round((m1Quantity / stats.totalReceived) * 100) : 0,
      received: stats.totalReceived,
    };
  });
};
