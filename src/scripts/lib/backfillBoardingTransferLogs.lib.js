import { Article, ArticleLog } from '../../models/production/index.js';
import { LogAction, ProductionFloor } from '../../models/production/enums.js';
import mongoose from 'mongoose';
import Process from '../../models/process.model.js';
import Product from '../../models/product.model.js';
import { getTransferAction } from '../../utils/loggingHelper.js';
import { toIstDateKey } from '../../utils/istPeriod.util.js';

/**
 * Product/Process must be registered so article.getFloorOrder can populate processes.
 * @returns {void}
 */
function assertProductModelsRegistered() {
  if (!Product || !Process) {
    throw new Error('Product/Process modules failed to load');
  }
  if (!mongoose.models.Product || !mongoose.models.Process) {
    throw new Error('Product/Process models not registered');
  }
}

const BOARDING = ProductionFloor.BOARDING;
const PUNCH_ACTION = LogAction.QUANTITY_UPDATED;
const PUNCH_REMARKS_RE = /^Added .+ units to Boarding floor/;
const TRANSFER_ACTION_RE = /^Transferred to /;
const NEARBY_MS = 15 * 1000;
const SAMPLE_LIMIT = 15;

const VALID_TRANSFER_ACTIONS = new Set(
  Object.values(LogAction).filter((action) => action.startsWith('Transferred to '))
);

/**
 * @param {unknown} value
 * @returns {number}
 */
export function toQty(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function qtyEqual(a, b) {
  return Math.abs(toQty(a) - toQty(b)) < 1e-6;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toMs(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * @param {object} punch
 * @returns {string}
 */
function punchIdStr(punch) {
  return punch?._id != null ? String(punch._id) : '';
}

/**
 * Load boarding completion punches that should have produced a transfer log.
 * @returns {Promise<object[]>}
 */
export async function loadBoardingPunches() {
  return ArticleLog.find({
    action: PUNCH_ACTION,
    remarks: { $regex: PUNCH_REMARKS_RE },
    quantity: { $gt: 0 },
  })
    .sort({ timestamp: 1, _id: 1 })
    .lean();
}

/**
 * Load existing Boarding outbound transfer logs for the given articles.
 * @param {string[]} articleIds
 * @returns {Promise<object[]>}
 */
export async function loadBoardingTransfers(articleIds) {
  if (!articleIds.length) return [];
  return ArticleLog.find({
    articleId: { $in: articleIds },
    fromFloor: BOARDING,
    action: { $regex: TRANSFER_ACTION_RE },
  })
    .select('articleId action fromFloor toFloor quantity timestamp remarks')
    .lean();
}

/**
 * Pair one punch to an unused existing transfer (1:1).
 * @param {object} punch
 * @param {object[]} transfers
 * @param {Set<string>} usedTransferIds
 * @returns {object|null}
 */
export function findExistingTransfer(punch, transfers, usedTransferIds) {
  const articleId = String(punch.articleId || '');
  const id = punchIdStr(punch);
  const punchMs = toMs(punch.timestamp);
  const punchIst = Number.isFinite(punchMs) ? toIstDateKey(new Date(punchMs)) : '';
  const candidates = transfers.filter(
    (row) => String(row.articleId) === articleId && !usedTransferIds.has(String(row._id))
  );

  const byRemark = candidates.find((row) => id && String(row.remarks || '').includes(id));
  if (byRemark) return byRemark;

  const nearby = candidates
    .filter((row) => TRANSFER_ACTION_RE.test(String(row.action || '')) && Number.isFinite(punchMs))
    .filter((row) => Math.abs(toMs(row.timestamp) - punchMs) <= NEARBY_MS)
    .sort((a, b) => Math.abs(toMs(a.timestamp) - punchMs) - Math.abs(toMs(b.timestamp) - punchMs));
  if (nearby[0]) return nearby[0];

  const sameDay = candidates
    .filter((row) => VALID_TRANSFER_ACTIONS.has(row.action) && qtyEqual(row.quantity, punch.quantity))
    .filter((row) => punchIst && toIstDateKey(new Date(row.timestamp)) === punchIst)
    .sort((a, b) => Math.abs(toMs(a.timestamp) - punchMs) - Math.abs(toMs(b.timestamp) - punchMs));
  return sameDay[0] || null;
}

/**
 * Next floor after Boarding from the article product process flow.
 * Does not guess when Boarding is missing or last.
 * @param {import('mongoose').Document} article
 * @returns {Promise<{ toFloor: string|null, reason: string|null }>}
 */
export async function resolveBoardingNextFloor(article) {
  if (!article) {
    return { toFloor: null, reason: 'article missing' };
  }
  let floorOrder;
  try {
    floorOrder = await article.getFloorOrder();
  } catch (error) {
    return { toFloor: null, reason: error.message || 'getFloorOrder failed' };
  }
  const idx = Array.isArray(floorOrder) ? floorOrder.indexOf(BOARDING) : -1;
  if (idx === -1) {
    return { toFloor: null, reason: 'Boarding not in process flow' };
  }
  const toFloor = floorOrder[idx + 1] || null;
  if (!toFloor) {
    return { toFloor: null, reason: 'no floor after Boarding' };
  }
  try {
    getTransferAction(toFloor);
  } catch (error) {
    return { toFloor: null, reason: error.message || `invalid next floor ${toFloor}` };
  }
  return { toFloor, reason: null };
}

/**
 * Build the article_log payload matching createTransferLog / createLogEntry.
 * @param {object} punch
 * @param {string} toFloor
 * @returns {object}
 */
export function buildBackfillLogData(punch, toFloor) {
  const quantity = toQty(punch.quantity);
  const timestamp = punch.timestamp ? new Date(punch.timestamp) : new Date();
  const action = getTransferAction(toFloor);
  return {
    action,
    quantity,
    fromFloor: BOARDING,
    toFloor,
    remarks:
      `Backfill of failed auto-transfer after boarding punch ${punchIdStr(punch)}. ` +
      `Transferred ${quantity} units from Boarding to ${toFloor}.`,
    userId: punch.userId || 'system',
    floorSupervisorId: punch.floorSupervisorId || 'system',
    orderId: punch.orderId,
    articleId: punch.articleId != null ? String(punch.articleId) : null,
    previousValue: BOARDING,
    newValue: toFloor,
    changeReason: 'Floor transfer',
    date: punch.date || toIstDateKey(timestamp),
    timestamp,
  };
}

/**
 * Insert one transfer log via ArticleLog.createLogEntry (same required fields as live writes).
 * @param {object} punch
 * @param {string} toFloor
 * @returns {Promise<object>}
 */
export async function insertBackfillTransferLog(punch, toFloor) {
  return ArticleLog.createLogEntry(buildBackfillLogData(punch, toFloor));
}

/**
 * @param {Map<string, number>} map
 * @param {string} key
 * @param {number} qty
 */
function addCount(map, key, qty) {
  map.set(key, (map.get(key) || 0) + qty);
}

/**
 * Classify punches, resolve destinations, optionally insert missing transfer logs.
 * Never mutates article.floorQuantities.
 * @param {{ apply: boolean }} options
 * @returns {Promise<object>}
 */
export async function runBoardingTransferBackfill({ apply }) {
  assertProductModelsRegistered();
  const punches = await loadBoardingPunches();
  const articleIds = [...new Set(punches.map((p) => String(p.articleId || '')).filter(Boolean))];
  const transfers = await loadBoardingTransfers(articleIds);

  const articles = await Article.find({ _id: { $in: articleIds } });
  const articleById = new Map(articles.map((a) => [String(a._id), a]));
  const nextFloorCache = new Map();

  const usedTransferIds = new Set();
  const alreadyHad = [];
  const toInsert = [];
  const unresolved = [];

  for (const punch of punches) {
    const existing = findExistingTransfer(punch, transfers, usedTransferIds);
    if (existing) {
      usedTransferIds.add(String(existing._id));
      alreadyHad.push(punch);
      continue;
    }

    const articleId = String(punch.articleId || '');
    const article = articleById.get(articleId);
    if (!nextFloorCache.has(articleId)) {
      nextFloorCache.set(articleId, await resolveBoardingNextFloor(article));
    }
    const resolved = nextFloorCache.get(articleId);
    if (!resolved?.toFloor) {
      unresolved.push({
        punchId: punchIdStr(punch),
        articleId,
        articleNumber: article?.articleNumber || '',
        quantity: toQty(punch.quantity),
        timestamp: punch.timestamp,
        reason: resolved?.reason || 'next floor unresolved',
      });
      continue;
    }

    toInsert.push({ punch, toFloor: resolved.toFloor });
  }

  const inserted = [];
  if (apply) {
    for (const row of toInsert) {
      const log = await insertBackfillTransferLog(row.punch, row.toFloor);
      inserted.push(log);
    }
  }

  const qtyByIstDate = new Map();
  const destCounts = new Map();
  for (const row of toInsert) {
    const ist = toIstDateKey(new Date(row.punch.timestamp));
    addCount(qtyByIstDate, ist, toQty(row.punch.quantity));
    destCounts.set(row.toFloor, (destCounts.get(row.toFloor) || 0) + 1);
  }

  const sample = toInsert.slice(0, SAMPLE_LIMIT).map((row) => ({
    punchId: punchIdStr(row.punch),
    articleId: String(row.punch.articleId),
    articleNumber: articleById.get(String(row.punch.articleId))?.articleNumber || '',
    quantity: toQty(row.punch.quantity),
    timestamp: row.punch.timestamp,
    istDate: toIstDateKey(new Date(row.punch.timestamp)),
    toFloor: row.toFloor,
    action: getTransferAction(row.toFloor),
  }));

  return {
    punchesScanned: punches.length,
    alreadyHadTransfer: alreadyHad.length,
    wouldInsert: toInsert.length,
    inserted: inserted.length,
    skippedUnresolved: unresolved.length,
    qtyByIstDate: Object.fromEntries([...qtyByIstDate.entries()].sort(([a], [b]) => a.localeCompare(b))),
    destinationFloorCounts: Object.fromEntries([...destCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    unresolvedArticleNumbers: [...new Set(unresolved.map((u) => u.articleNumber || u.articleId))],
    unresolved,
    sample,
  };
}
