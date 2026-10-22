import mongoose from 'mongoose';
import { z } from 'zod';
import YarnCatalog from '../../models/yarnManagement/yarnCatalog.model.js';
import {
  getInventoryBreakdownForCatalogIds,
  roundKg3,
} from '../../services/yarnManagement/yarnInventory.service.js';
import { classifyYarnMatches } from './matchYarns.js';

export const GET_YARN_LIVE_STOCK = 'getYarnLiveStock';

export const NAV_PATH = 'Yarn Management.Dashboard';

/**
 * Active catalog rows used for name matching. Stock numbers come from the screen helper.
 * @returns {Promise<{ yarnCatalogId: string, yarnName: string }[]>}
 */
async function loadActiveYarns() {
  const rows = await YarnCatalog.find({ status: 'active' }).select('_id yarnName').lean();
  return rows
    .filter((row) => row && row.yarnName)
    .map((row) => ({
      yarnCatalogId: String(row._id), // eslint-disable-line no-underscore-dangle
      yarnName: String(row.yarnName).trim(),
    }))
    .filter((row) => row.yarnName);
}

/**
 * One screen row. totalStockKg is renamed totalKg. Kg values are already roundKg3.
 * @param {string} yarnCatalogId
 * @param {string} yarnName
 * @param {object|undefined} breakdown
 * @returns {object}
 */
function presentYarn(yarnCatalogId, yarnName, breakdown) {
  const row = breakdown || {};
  return {
    yarnCatalogId,
    yarnName,
    unit: 'kg',
    longTermKg: row.longTermKg ?? 0,
    shortTermKg: row.shortTermKg ?? 0,
    unallocatedKg: row.unallocatedKg ?? 0,
    blockedKg: row.blockedKg ?? 0,
    availableKg: row.availableKg ?? 0,
    totalKg: row.totalStockKg ?? 0,
    cones: row.cones ?? 0,
  };
}

/**
 * Loads the Live Inventory breakdown for these ids.
 * @param {string[]} ids
 * @returns {Promise<Map<string, object>>}
 */
function loadBreakdown(ids) {
  return getInventoryBreakdownForCatalogIds(ids);
}

/**
 * Sums one kg field across rows, then rounds to 3 decimals.
 * @param {object[]} rows
 * @param {string} key
 * @returns {number}
 */
function sumKg(rows, key) {
  const total = rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
  return roundKg3(total);
}

/**
 * One active yarn by catalog id. Missing and inactive are NOT_FOUND.
 * @param {string} yarnCatalogId
 * @returns {Promise<object>}
 */
async function runById(yarnCatalogId) {
  if (!mongoose.Types.ObjectId.isValid(yarnCatalogId)) return { error: 'NOT_FOUND' };
  const catalog = await YarnCatalog.findOne({ _id: yarnCatalogId, status: 'active' })
    .select('_id yarnName')
    .lean();
  if (!catalog || !catalog.yarnName) return { error: 'NOT_FOUND' };
  const id = String(catalog._id); // eslint-disable-line no-underscore-dangle
  const breakdown = await loadBreakdown([id]);
  return presentYarn(id, String(catalog.yarnName).trim(), breakdown.get(id));
}

/**
 * Token match against active yarn names, then the screen breakdown for 1–10 hits.
 * @param {string} query
 * @returns {Promise<object>}
 */
async function runByQuery(query) {
  const classified = classifyYarnMatches(query, await loadActiveYarns());
  if (classified.error === 'NOT_FOUND') return { error: 'NOT_FOUND' };
  if (classified.error === 'TOO_MANY') {
    return {
      error: 'TOO_MANY',
      count: classified.count,
      counts: classified.counts,
      colours: classified.colours,
    };
  }
  const matches = classified.match ? [classified.match] : classified.matches;
  const breakdown = await loadBreakdown(matches.map((yarn) => yarn.yarnCatalogId));
  const rows = matches.map((yarn) =>
    presentYarn(yarn.yarnCatalogId, yarn.yarnName, breakdown.get(yarn.yarnCatalogId))
  );
  if (rows.length === 1) return rows[0];
  return {
    error: 'AMBIGUOUS',
    candidates: rows.map((row) => ({
      yarnCatalogId: row.yarnCatalogId,
      yarnName: row.yarnName,
      totalKg: row.totalKg,
      availableKg: row.availableKg,
    })),
    combinedTotalKg: sumKg(rows, 'totalKg'),
    combinedAvailableKg: sumKg(rows, 'availableKg'),
  };
}

/**
 * Live yarn stock for one catalog id, or for a name / partial name.
 * Name matching is token based. Stock numbers are the Live Inventory breakdown.
 * @param {{ query?: string, yarnCatalogId?: string }} input
 * @returns {Promise<object>}
 */
export async function runGetYarnLiveStock(input) {
  const yarnCatalogId = String(input?.yarnCatalogId || '').trim();
  if (yarnCatalogId) return runById(yarnCatalogId);
  const query = String(input?.query || '').trim();
  if (!query) return { error: 'NOT_FOUND' };
  return runByQuery(query);
}

/** Tool definition. Registered by `registerTools`. */
export const getYarnLiveStockTool = {
  name: GET_YARN_LIVE_STOCK,
  description:
    'Read live yarn stock in kg from the Live Inventory screen. Does not answer warehouse stock; that is getWarehouseStock. Does not answer warehouse orders (WO-) or production orders (ORD-). Pass query (yarn name or words from it, any order, for example cotton 40s black) or yarnCatalogId when the user picked one candidate. Tokens split on spaces, hyphens, and slashes. A yarn matches when every token appears in its name. "40s" also matches "2/40s". Active yarns only. One match returns yarnCatalogId, yarnName, unit kg, longTermKg, shortTermKg, unallocatedKg, blockedKg, availableKg, totalKg, and cones. Kg is rounded to 3 decimals. availableKg is LTS + STS - blocked. Unallocated is not part of available. totalKg is LTS + STS. cones is the short-term cone count. Two to ten matches return error AMBIGUOUS, candidates (yarnCatalogId, yarnName, totalKg, availableKg), combinedTotalKg, and combinedAvailableKg. Do not pick one. More than ten matches return error TOO_MANY with count, counts (count labels such as 30s or 2/40s, at most 10), and colours (at most 10). Ask the user to narrow by those options. Do not state a quantity. No match returns error NOT_FOUND. Do not invent minQuantity.',
  type: 'READ',
  navPath: NAV_PATH,
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .optional()
      .describe('Yarn name or words from it, any order. Example: cotton 40s black'),
    yarnCatalogId: z
      .string()
      .min(1)
      .optional()
      .describe('Yarn catalog id when the user has chosen one candidate'),
  }),
  run: runGetYarnLiveStock,
};
