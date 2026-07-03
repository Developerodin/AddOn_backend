/**
 * Apply zero-out updates for DATAAUDIT orphan cones and boxes.
 * @module zero-out-dataaudit-orphans.apply
 */

import { YarnCone, YarnBox } from '../models/index.js';

const WEIGHT_EPS = 1e-9;

/**
 * @typedef {import('./zero-out-dataaudit-orphans.classify.js').ConeClassifyResult} ConeClassifyResult
 * @typedef {import('./zero-out-dataaudit-orphans.classify.js').BoxClassifyResult} BoxClassifyResult
 */

/**
 * @typedef {Object} ConeApplyResult
 * @property {string} status
 * @property {string} [message]
 * @property {Record<string, unknown>} [after]
 */

/**
 * @typedef {Object} BoxApplyResult
 * @property {string} status
 * @property {string} [message]
 * @property {Record<string, unknown>} [after]
 */

/**
 * Builds the target after-state for a zeroed cone.
 * @param {ConeClassifyResult} classified
 * @returns {{ after: Record<string, unknown>, issueWeight: number, issueDate: Date, unsetOrderArticle: boolean }}
 */
export function buildConeZeroPayload(classified) {
  const before = /** @type {Record<string, unknown>} */ (classified.before || {});
  const priorNet = Number(before.coneWeight ?? 0) - Number(before.tearWeight ?? 0);
  const issueWeightToSet =
    priorNet > WEIGHT_EPS ? priorNet : Math.max(0, Number(before.issueWeight ?? 0));
  const issueDateToSet = new Date();

  const after = {
    issueStatus: 'used',
    coneWeight: 0,
    tearWeight: 0,
    coneStorageId: '',
    issueWeight: issueWeightToSet,
  };

  const unsetOrderArticle =
    !before.orderId && !before.articleId;

  return { after, issueWeight: issueWeightToSet, issueDate: issueDateToSet, unsetOrderArticle };
}

/**
 * Applies zero-out to a classified cone when bucket is can_zero.
 * @param {ConeClassifyResult} classified
 * @param {boolean} apply
 * @returns {Promise<ConeApplyResult>}
 */
export async function applyConeZero(classified, apply) {
  if (classified.bucket !== 'can_zero') {
    return { status: 'skipped', message: `bucket=${classified.bucket}` };
  }

  const { after, issueWeight, issueDate, unsetOrderArticle } = buildConeZeroPayload(classified);

  /** @type {Record<string, unknown>} */
  const $set = {
    issueStatus: 'used',
    coneWeight: 0,
    tearWeight: 0,
    issueWeight,
    issueDate,
  };

  /** @type {Record<string, string>} */
  const $unset = { coneStorageId: '' };
  if (unsetOrderArticle) {
    $unset.orderId = '';
    $unset.articleId = '';
  }

  if (!apply) {
    return { status: 'would_update', after };
  }

  try {
    await YarnCone.updateOne({ _id: classified.coneId }, { $set, $unset });
    return { status: 'updated', after };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Builds after-state for a zeroed box.
 * @returns {Record<string, unknown>}
 */
export function buildBoxZeroAfter() {
  return {
    boxWeight: 0,
    grossWeight: 0,
    numberOfCones: 0,
    storedStatus: false,
    storageLocation: '',
  };
}

/**
 * Marks a single ST cone as used and clears rack storage by barcode.
 * @param {string} barcode
 * @param {boolean} apply
 * @returns {Promise<{ status: string, barcode: string, message?: string, yarnCatalogId?: string }>}
 */
export async function zeroStConeByBarcode(barcode, apply) {
  const trimmed = String(barcode || '').trim();
  if (!trimmed) {
    return { status: 'error', barcode: '', message: 'empty_barcode' };
  }

  const cone = await YarnCone.findOne({ barcode: trimmed });
  if (!cone) {
    return { status: 'error', barcode: trimmed, message: 'cone_not_in_db' };
  }

  const priorNet = Number(cone.coneWeight ?? 0) - Number(cone.tearWeight ?? 0);
  const issueWeight =
    priorNet > WEIGHT_EPS ? priorNet : Math.max(0, Number(cone.issueWeight ?? 0));

  /** @type {Record<string, unknown>} */
  const $set = {
    issueStatus: 'used',
    coneWeight: 0,
    tearWeight: 0,
    issueWeight,
    issueDate: new Date(),
  };

  /** @type {Record<string, string>} */
  const $unset = { coneStorageId: '' };
  if (!cone.orderId && !cone.articleId) {
    $unset.orderId = '';
    $unset.articleId = '';
  }

  const yarnCatalogId = cone.yarnCatalogId ? String(cone.yarnCatalogId) : '';

  if (!apply) {
    return { status: 'would_update', barcode: trimmed, yarnCatalogId };
  }

  try {
    await YarnCone.updateOne({ _id: cone._id }, { $set, $unset });
    return { status: 'updated', barcode: trimmed, yarnCatalogId };
  } catch (err) {
    return {
      status: 'error',
      barcode: trimmed,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Zeros all ST cones on an LT box, then zeros the box (--force-lt-with-st-cones).
 * @param {BoxClassifyResult} classified
 * @param {boolean} apply
 * @returns {Promise<BoxApplyResult & { stConesZeroed?: number, stConeErrors?: string[], coneCatalogIds?: string[] }>}
 */
export async function applyBoxZeroForceLtStCones(classified, apply) {
  const stCones = /** @type {Array<{ barcode: string }>} */ (classified.stCones || []);
  /** @type {string[]} */
  const stConeErrors = [];
  /** @type {string[]} */
  const coneCatalogIds = [];
  let stConesZeroed = 0;

  for (const c of stCones) {
    const coneResult = await zeroStConeByBarcode(c.barcode, apply);
    if (coneResult.status === 'updated' || coneResult.status === 'would_update') {
      stConesZeroed += 1;
      if (coneResult.yarnCatalogId) coneCatalogIds.push(coneResult.yarnCatalogId);
    } else {
      stConeErrors.push(`${c.barcode}: ${coneResult.message ?? coneResult.status}`);
    }
  }

  if (stConeErrors.length > 0) {
    return {
      status: 'error',
      message: `st_cone_zero_failed (${stConeErrors.length})`,
      stConesZeroed,
      stConeErrors,
      coneCatalogIds,
    };
  }

  const boxResult = await applyBoxZero({ ...classified, bucket: 'can_zero' }, apply);
  return { ...boxResult, stConesZeroed, stConeErrors: [], coneCatalogIds };
}

/**
 * Applies zero-out to a classified box when bucket is can_zero.
 * @param {BoxClassifyResult} classified
 * @param {boolean} apply
 * @returns {Promise<BoxApplyResult>}
 */
export async function applyBoxZero(classified, apply) {
  if (classified.bucket !== 'can_zero') {
    return { status: 'skipped', message: `bucket=${classified.bucket}` };
  }

  const after = buildBoxZeroAfter();

  if (!apply) {
    return { status: 'would_update', after };
  }

  try {
    await YarnBox.updateOne(
      { _id: classified.docId },
      {
        $set: {
          boxWeight: 0,
          grossWeight: 0,
          numberOfCones: 0,
          storedStatus: false,
          storageLocation: '',
        },
      }
    );
    return { status: 'updated', after };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Processes classified cones: apply zero-out and collect catalog IDs.
 * @param {ConeClassifyResult[]} classified
 * @param {boolean} apply
 * @returns {Promise<{ results: Array<ConeClassifyResult & ConeApplyResult>, catalogIds: Set<string> }>}
 */
export async function processCones(classified, apply) {
  /** @type {Set<string>} */
  const catalogIds = new Set();
  /** @type {Array<ConeClassifyResult & ConeApplyResult>} */
  const results = [];

  for (const row of classified) {
    if (row.bucket === 'can_zero') {
      const applyResult = await applyConeZero(row, apply);
      if (row.yarnCatalogId) catalogIds.add(row.yarnCatalogId);
      results.push({ ...row, ...applyResult });
    } else {
      results.push({ ...row, status: row.bucket });
    }
  }

  return { results, catalogIds };
}

/**
 * Processes classified boxes: apply zero-out and collect catalog IDs.
 * @param {BoxClassifyResult[]} classified
 * @param {boolean} apply
 * @param {{ forceLtWithStCones?: boolean, forceIssuedConesOnBox?: boolean }} [options]
 * @returns {Promise<{ results: Array<BoxClassifyResult & BoxApplyResult>, catalogIds: Set<string> }>}
 */
export async function processBoxes(classified, apply, options = {}) {
  const { forceLtWithStCones = false, forceIssuedConesOnBox = false } = options;
  /** @type {Set<string>} */
  const catalogIds = new Set();
  /** @type {Array<BoxClassifyResult & BoxApplyResult>} */
  const results = [];

  for (const row of classified) {
    if (row.bucket === 'can_zero') {
      const applyResult = await applyBoxZero(row, apply);
      if (row.yarnCatalogId) catalogIds.add(row.yarnCatalogId);
      results.push({ ...row, ...applyResult });
    } else if (row.bucket === 'lt_with_st_cones' && forceLtWithStCones) {
      const applyResult = await applyBoxZeroForceLtStCones(row, apply);
      if (row.yarnCatalogId) catalogIds.add(row.yarnCatalogId);
      for (const id of applyResult.coneCatalogIds || []) catalogIds.add(id);
      results.push({ ...row, ...applyResult, forcedLtStCones: true });
    } else if (row.bucket === 'block_issued_cones_on_box' && forceIssuedConesOnBox) {
      const applyResult = await applyBoxZero({ ...row, bucket: 'can_zero' }, apply);
      if (row.yarnCatalogId) catalogIds.add(row.yarnCatalogId);
      results.push({
        ...row,
        ...applyResult,
        forcedIssuedConesOnBox: true,
        issuedConesKept: Array.isArray(row.issuedStCones) ? row.issuedStCones.length : 0,
      });
    } else {
      results.push({ ...row, status: row.bucket });
    }
  }

  return { results, catalogIds };
}

/**
 * Merges cone and box catalog IDs for inventory sync.
 * @param {Set<string>} coneIds
 * @param {Set<string>} boxIds
 * @returns {string[]}
 */
export function mergeCatalogIds(coneIds, boxIds) {
  const merged = new Set([...coneIds, ...boxIds]);
  return [...merged];
}
