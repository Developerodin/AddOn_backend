import { ALL_FLOOR_KEYS } from '../../utils/floorLabelMap.js';
import { floorsPendingForArticle, roundPairs } from './floorPending.js';

/** Floors after final checking are stages, not in-production totals. */
const TERMINAL_FLOORS = new Set(['dispatch', 'warehouse']);

const IN_PRODUCTION_KEYS = ALL_FLOOR_KEYS.filter((key) => !TERMINAL_FLOORS.has(key));

/**
 * Adds one article's raw pending into the running floor sums.
 * @param {Record<string, number>} rawByFloor
 * @param {Record<string, { pending?: number }>} floors
 * @returns {number} pending added to inProduction
 */
function addInProduction(rawByFloor, floors) {
  return IN_PRODUCTION_KEYS.reduce((total, key) => {
    const pending = floors[key]?.pending || 0;
    rawByFloor[key] = (rawByFloor[key] || 0) + pending;
    return total + pending;
  }, 0);
}

/**
 * Dispatch transferred pairs. This is the outbound counter, not pending.
 * @param {object} article
 * @returns {number}
 */
function dispatchTransferred(article) {
  const transferred = Number(article.floorQuantities?.dispatch?.transferred);
  return Number.isFinite(transferred) ? transferred : 0;
}

/**
 * Order-level pair totals. Sums raw pending, then rounds once.
 * `orderTotals` is in-production floors only, and only where rounded pending is above 0.
 * @param {object[]} articles
 * @returns {{ orderSummary: { inProduction: number, inWarehouse: number, readyToDispatch: number, dispatched: number }, orderTotals: Record<string, number> }}
 */
export function summarizeOrder(articles) {
  const rawByFloor = {};
  const sums = articles.reduce(
    (acc, article) => {
      const floors = floorsPendingForArticle(article.floorQuantities);
      acc.inProduction += addInProduction(rawByFloor, floors);
      acc.inWarehouse += floors.warehouse?.pending || 0;
      acc.readyToDispatch += floors.dispatch?.pending || 0;
      acc.dispatched += dispatchTransferred(article);
      return acc;
    },
    { inProduction: 0, inWarehouse: 0, readyToDispatch: 0, dispatched: 0 }
  );

  const orderTotals = IN_PRODUCTION_KEYS.reduce((out, key) => {
    const pending = roundPairs(rawByFloor[key] || 0);
    if (pending > 0) return { ...out, [key]: pending };
    return out;
  }, {});

  return {
    orderSummary: {
      inProduction: roundPairs(sums.inProduction),
      inWarehouse: roundPairs(sums.inWarehouse),
      readyToDispatch: roundPairs(sums.readyToDispatch),
      dispatched: roundPairs(sums.dispatched),
    },
    orderTotals,
  };
}
