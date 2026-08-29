import { ContainersMaster, ContainerStatus } from '../../models/production/index.js';
import { ALL_FLOOR_KEYS, FLOOR_TO_KEY_MAP, getFloorKeyFromName } from '../../utils/floorLabelMap.js';

/**
 * Coerces a value to a finite number, defaulting to 0.
 * @param {unknown} value
 * @returns {number}
 */
const toNumber = (value) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Zeroed upcoming map for every backlog floor key.
 * @returns {Record<string, number>}
 */
export const emptyUpcomingFloors = () => {
  const floors = {};
  for (const key of ALL_FLOOR_KEYS) floors[key] = 0;
  return floors;
};

/**
 * Maps a ContainersMaster.activeFloor label to a floorQuantities key (case-insensitive).
 * @param {unknown} activeFloor
 * @returns {string|null}
 */
export const resolveUpcomingFloorKey = (activeFloor) => {
  if (activeFloor == null || activeFloor === '') return null;
  const name = String(activeFloor).trim();
  if (!name) return null;
  if (ALL_FLOOR_KEYS.includes(name)) return name;
  const exact = getFloorKeyFromName(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [enumName, key] of Object.entries(FLOOR_TO_KEY_MAP)) {
    if (enumName.toLowerCase() === lower) return key;
  }
  return null;
};

/**
 * Production article qty on one container (excludes vendorProductionFlow-only rows).
 * Matches Upcoming tab summing, restricted to factory articles.
 * @param {Record<string, unknown>} container Lean container
 * @returns {number}
 */
export const productionQtyOnContainer = (container) => {
  const items = Array.isArray(container?.activeItems) ? container.activeItems : [];
  if (items.length > 0) {
    let qty = 0;
    for (const item of items) {
      if (!item?.article) continue;
      qty += toNumber(item.quantity);
    }
    return qty;
  }
  if (container?.activeArticle) return toNumber(container.quantity);
  return 0;
};

/**
 * Sums production upcoming qty by floor from lean container docs.
 * Per-floor totals are Math.round'd; upcomingTotal is the sum of those rounded floors.
 * @param {Array<Record<string, unknown>>} containers
 * @returns {{ floors: Record<string, number>, upcomingTotal: number }}
 */
export const sumUpcomingFromContainers = (containers) => {
  const raw = emptyUpcomingFloors();
  for (const container of containers || []) {
    const floorKey = resolveUpcomingFloorKey(container.activeFloor);
    if (!floorKey || !(floorKey in raw)) continue;
    raw[floorKey] += productionQtyOnContainer(container);
  }
  const floors = emptyUpcomingFloors();
  let upcomingTotal = 0;
  for (const key of ALL_FLOOR_KEYS) {
    const rounded = Math.round(raw[key]);
    floors[key] = rounded;
    upcomingTotal += rounded;
  }
  return { floors, upcomingTotal };
};

/**
 * Loads ACTIVE containers with an active floor and sums factory-article qty per floor.
 * @returns {Promise<{ floors: Record<string, number>, upcomingTotal: number }>}
 */
export const loadUpcomingByFloor = async () => {
  const containers = await ContainersMaster.find({
    status: ContainerStatus.ACTIVE,
    activeFloor: { $nin: [null, ''] },
  })
    .select('activeFloor activeItems activeArticle quantity')
    .lean();
  return sumUpcomingFromContainers(containers);
};
