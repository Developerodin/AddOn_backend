/**
 * Mark leftover not_issued Excel cones as used (client-confirmed consumed).
 * Does not create yarn_returned — those cones already have a return txn for the last issue.
 */

import { YarnCone } from '../../models/index.js';
import { syncInventoriesFromStorageForCatalogIds } from '../../services/yarnManagement/yarnInventory.service.js';
import logger from '../../config/logger.js';

const WEIGHT_EPS = 1e-9;

/**
 * @param {object} cone
 * @returns {boolean}
 */
export function isAlreadyUsedCleared(cone) {
  const hasStorage = cone.coneStorageId != null && String(cone.coneStorageId).trim() !== '';
  const cw = Number(cone.coneWeight ?? 0);
  const tw = Number(cone.tearWeight ?? 0);
  return String(cone.issueStatus) === 'used' && !hasStorage && cw <= WEIGHT_EPS && tw <= WEIGHT_EPS;
}

/**
 * Leftover ST stock (not_issued) or used-but-not-cleared — client said mark used.
 * @param {object} cone
 * @returns {boolean}
 */
export function shouldMarkUsedLeftover(cone) {
  if (cone.returnedToVendorAt != null) return false;
  const st = String(cone.issueStatus || '');
  if (st === 'issued' || st === 'returned_to_vendor') return false;
  if (isAlreadyUsedCleared(cone)) return false;
  return st === 'not_issued' || st === 'used';
}

/**
 * Persist used/empty like mark-yarn-cones-used-from-excel.js (no save hooks).
 * @param {object} cone lean YarnCone
 * @returns {Promise<void>}
 */
export async function markConeUsedCleared(cone) {
  const priorNet = Number(cone.coneWeight ?? 0) - Number(cone.tearWeight ?? 0);
  const issueWeightToSet = priorNet > WEIGHT_EPS ? priorNet : Math.max(0, Number(cone.issueWeight ?? 0));
  await YarnCone.updateOne(
    { _id: cone._id },
    {
      $set: {
        issueStatus: 'used',
        coneWeight: 0,
        tearWeight: 0,
        issueWeight: issueWeightToSet,
        issueDate: cone.issueDate || new Date(),
      },
      $unset: { coneStorageId: '', orderId: '', articleId: '' },
    }
  );
}

/**
 * @param {Array<{ barcode: string, action?: string, coneId?: string, needsMarkUsed?: boolean, yarnCatalogId?: string, coneDoc?: object }>} rows
 * @param {{ apply: boolean }} opts
 * @returns {Promise<{ marked: number, errors: number }>}
 */
export async function applyMarkUsedLeftovers(rows, opts) {
  const apply = opts.apply === true;
  const work = rows.filter((r) => r.needsMarkUsed && r.coneDoc);
  if (!apply) {
    return { marked: 0, errors: 0 };
  }
  let marked = 0;
  let errors = 0;
  const catalogIds = new Set();
  logger.info(`empty-return-excel: mark-used leftover ${work.length} cone(s)`);
  for (const r of work) {
    try {
      await markConeUsedCleared(r.coneDoc);
      marked += 1;
      r.action = 'marked_used';
      r.reason = 'Leftover not_issued cone marked used (return txn already exists for last issue)';
      if (r.yarnCatalogId) catalogIds.add(String(r.yarnCatalogId));
    } catch (err) {
      errors += 1;
      r.action = 'error_mark_used';
      r.reason = err && err.message ? err.message : String(err);
    }
  }
  if (catalogIds.size > 0) {
    logger.info(`empty-return-excel: syncing YarnInventory for ${catalogIds.size} catalog(s)`);
    try {
      await syncInventoriesFromStorageForCatalogIds([...catalogIds]);
    } catch (err) {
      logger.error(`empty-return-excel: inventory sync failed: ${err && err.message ? err.message : err}`);
      errors += 1;
    }
  }
  return { marked, errors };
}
