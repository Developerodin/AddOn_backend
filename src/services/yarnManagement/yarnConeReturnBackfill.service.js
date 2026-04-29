import mongoose from 'mongoose';
import httpStatus from 'http-status';
import { YarnCone, YarnTransaction, YarnCatalog } from '../../models/index.js';
import { ProductionOrder, Article, MachineOrderAssignment } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { returnYarnCone } from './yarnCone.service.js';
import { createYarnTransaction } from './yarnTransaction.service.js';
import { updateMachineOrderAssignmentById } from '../production/machineOrderAssignment.service.js';
import { OrderStatus, YarnIssueStatus, YarnReturnStatus } from '../../models/production/enums.js';

/**
 * @typedef {Object} BackfillOptions
 * @property {string[]} barcodes
 * @property {Date} [returnDate]
 * @property {string} [returnByUsername]
 * @property {boolean} [strictMissingIssueTxn] When true, cones without an issue transaction are not returned.
 */

/**
 * @typedef {Object} ConeAuditRow
 * @property {string} inputBarcode
 * @property {'missing_cone'|'not_issued_skipped'|'already_has_return_txn'|'missing_issue_txn'|'missing_yarn_catalog'|'returned'} action
 * @property {string} reason
 * @property {string} [coneId]
 * @property {string} [issueTxnId]
 * @property {string} [orderId]
 * @property {string} [orderno]
 * @property {string} [articleId]
 * @property {string} [articleNumber]
 * @property {string} [machineId]
 * @property {string} [yarnCatalogId]
 * @property {string} [yarnName]
 * @property {string} [returnTxnId]
 * @property {string} [returnTxnGroupKey]
 * @property {string} [moaYarnReturnStatusBefore]
 * @property {string} [moaYarnReturnStatusAfter]
 */

/**
 * @typedef {Object} BackfillSummary
 * @property {number} inputCount
 * @property {number} uniqueBarcodeCount
 * @property {string[]} missingConesBarcodes
 * @property {string[]} notIssuedSkippedBarcodes
 * @property {string[]} alreadyReturnedTxnSkippedBarcodes
 * @property {string[]} missingIssueTxnBarcodes
 * @property {string[]} missingYarnCatalogForReturnTxnConeBarcodes
 * @property {ConeAuditRow[]} auditRows
 * @property {number} conesReturnedCount
 * @property {number} returnTransactionsCreatedCount
 * @property {number} moaItemsMarkedReturnCompletedCount
 */

const isNonEmptyString = (v) => v != null && String(v).trim() !== '';

/**
 * Build a stable group key for one return transaction, mirroring issue transaction context.
 * @param {import('mongoose').LeanDocument<any>} issueTxn
 * @returns {string}
 */
function buildTxnGroupKey(issueTxn) {
  const parts = [
    issueTxn?.yarnCatalogId?.toString?.() || '',
    issueTxn?.orderId?.toString?.() || '',
    issueTxn?.articleId?.toString?.() || '',
    issueTxn?.machineId?.toString?.() || '',
    String(issueTxn?.orderno || ''),
    String(issueTxn?.articleNumber || ''),
  ];
  return parts.join('|');
}

/**
 * @param {string[]} barcodes
 * @returns {string[]}
 */
function normaliseBarcodes(barcodes) {
  const out = [];
  const seen = new Set();
  for (const b of barcodes || []) {
    const s = String(b || '').trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * @param {any} issueTxn
 * @returns {Record<string, string>}
 */
function pickIssueTxnContext(issueTxn) {
  if (!issueTxn) return {};
  return {
    issueTxnId: issueTxn?._id ? String(issueTxn._id) : '',
    orderId: issueTxn?.orderId ? String(issueTxn.orderId) : '',
    orderno: isNonEmptyString(issueTxn?.orderno) ? String(issueTxn.orderno) : '',
    articleId: issueTxn?.articleId ? String(issueTxn.articleId) : '',
    articleNumber: isNonEmptyString(issueTxn?.articleNumber) ? String(issueTxn.articleNumber) : '',
    machineId: issueTxn?.machineId ? String(issueTxn.machineId) : '',
    yarnCatalogId: issueTxn?.yarnCatalogId ? String(issueTxn.yarnCatalogId) : '',
    yarnName: isNonEmptyString(issueTxn?.yarnName) ? String(issueTxn.yarnName) : '',
  };
}

/**
 * Lookup already-returned cones by finding any yarn_returned transaction that references them.
 * @param {mongoose.Types.ObjectId[]} coneIds
 * @returns {Promise<Set<string>>} set of coneId strings that already have a return transaction
 */
async function getAlreadyReturnedConeIdSet(coneIds) {
  if (!coneIds.length) return new Set();
  const rows = await YarnTransaction.find({
    transactionType: 'yarn_returned',
    conesIdsArray: { $in: coneIds },
  })
    .select('conesIdsArray')
    .lean();

  const set = new Set();
  for (const r of rows) {
    for (const id of r?.conesIdsArray || []) {
      if (id) set.add(String(id));
    }
  }
  return set;
}

/**
 * For audit: find one yarn_returned transaction per coneId (if exists).
 * @param {mongoose.Types.ObjectId[]} coneIds
 * @returns {Promise<Map<string, string>>} coneIdStr -> returnTxnId
 */
async function mapConeToExistingReturnTxnId(coneIds) {
  if (!coneIds.length) return new Map();
  const rows = await YarnTransaction.find({
    transactionType: 'yarn_returned',
    conesIdsArray: { $in: coneIds },
  })
    .select('_id conesIdsArray')
    .lean();
  const out = new Map();
  for (const r of rows) {
    const returnTxnId = r?._id ? String(r._id) : '';
    for (const id of r?.conesIdsArray || []) {
      const idStr = id ? String(id) : '';
      if (!idStr) continue;
      if (!out.has(idStr)) out.set(idStr, returnTxnId);
    }
  }
  return out;
}

/**
 * For audit: capture MOA yarnReturnStatus for a (orderId, articleId) pair.
 * Format: `assignmentId:itemId:status|assignmentId:itemId:status`
 *
 * @param {string} orderIdStr
 * @param {string} articleIdStr
 * @returns {Promise<string>}
 */
async function snapshotMoaReturnStatuses(orderIdStr, articleIdStr) {
  if (!orderIdStr || !articleIdStr) return '';
  if (!mongoose.Types.ObjectId.isValid(orderIdStr) || !mongoose.Types.ObjectId.isValid(articleIdStr)) return '';
  const orderId = new mongoose.Types.ObjectId(orderIdStr);
  const articleId = new mongoose.Types.ObjectId(articleIdStr);
  const assignments = await MachineOrderAssignment.find({
    productionOrderItems: { $elemMatch: { productionOrder: orderId, article: articleId } },
  })
    .select('productionOrderItems')
    .lean();
  const parts = [];
  for (const a of assignments || []) {
    const item = (a.productionOrderItems || []).find(
      (i) => String(i.productionOrder) === String(orderIdStr) && String(i.article) === String(articleIdStr)
    );
    if (!item) continue;
    parts.push(`${String(a._id)}:${String(item._id)}:${String(item.yarnReturnStatus || '')}`);
  }
  return parts.join('|');
}

/**
 * Find the latest yarn_issued transaction for each coneId.
 * @param {Set<string>} targetConeIdStrSet
 * @returns {Promise<Map<string, any>>} map coneIdStr -> issueTxn (lean)
 */
async function mapConeToLatestIssueTxn(targetConeIdStrSet) {
  if (targetConeIdStrSet.size === 0) return new Map();
  const targetConeIds = [...targetConeIdStrSet].map((s) => new mongoose.Types.ObjectId(s));

  const txns = await YarnTransaction.find({
    transactionType: 'yarn_issued',
    conesIdsArray: { $in: targetConeIds },
  })
    .sort({ transactionDate: -1, createdAt: -1 })
    .lean();

  const resolved = new Map();
  for (const txn of txns) {
    for (const coneId of txn?.conesIdsArray || []) {
      const idStr = coneId ? String(coneId) : '';
      if (!idStr) continue;
      if (!targetConeIdStrSet.has(idStr)) continue;
      if (resolved.has(idStr)) continue; // we iterate from latest to oldest
      resolved.set(idStr, txn);
    }
    if (resolved.size === targetConeIdStrSet.size) break;
  }
  return resolved;
}

/**
 * Ensures orderno and articleNumber exist on return txn payload by hydrating from refs when missing.
 * @param {any} issueTxn
 * @returns {Promise<{orderno?: string, articleNumber?: string}>}
 */
async function hydrateOrderAndArticleNumbers(issueTxn) {
  const out = {};
  if (!isNonEmptyString(issueTxn?.orderno) && issueTxn?.orderId) {
    const order = await ProductionOrder.findById(issueTxn.orderId).select('orderNumber').lean();
    if (order?.orderNumber) out.orderno = String(order.orderNumber);
  }
  if (!isNonEmptyString(issueTxn?.articleNumber) && issueTxn?.articleId) {
    const article = await Article.findById(issueTxn.articleId).select('articleNumber').lean();
    if (article?.articleNumber) out.articleNumber = String(article.articleNumber);
  }
  return out;
}

/**
 * Bulk return cones (empty) from barcode list. Primary truth for return transaction fields is the
 * latest matching yarn_issued `YarnTransaction` (per coneId via `conesIdsArray`).
 *
 * - Cones not currently issued are skipped.
 * - Cones that already have a yarn_returned transaction are skipped for transaction creation.
 * - Cones with no matching yarn_issued transaction are skipped and reported (strict accounting).
 *
 * @param {BackfillOptions} options
 * @returns {Promise<BackfillSummary>}
 */
export async function bulkReturnConesFromBarcodes(options) {
  const inputBarcodes = Array.isArray(options?.barcodes) ? options.barcodes.map((b) => String(b ?? '')) : [];
  const barcodes = normaliseBarcodes(inputBarcodes);
  const returnDate = options?.returnDate instanceof Date ? options.returnDate : new Date();
  const returnByUsername = String(options?.returnByUsername || 'system').trim() || 'system';
  const strictMissingIssueTxn = options?.strictMissingIssueTxn !== false; // default true

  if (barcodes.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No barcodes provided');
  }

  // Load cones in one pass
  const cones = await YarnCone.find({ barcode: { $in: barcodes } })
    .select('_id barcode issueStatus returnStatus orderId articleId yarnCatalogId yarnName')
    .lean();
  const coneByBarcode = new Map(cones.map((c) => [String(c.barcode), c]));

  const missingConesBarcodes = barcodes.filter((b) => !coneByBarcode.has(b));
  /** @type {ConeAuditRow[]} */
  const auditRows = [];
  for (const b of missingConesBarcodes) {
    auditRows.push({
      inputBarcode: b,
      action: 'missing_cone',
      reason: 'No YarnCone found for this barcode',
    });
  }

  // Only consider cones that are currently issued
  const issuedCones = cones.filter((c) => String(c.issueStatus) === 'issued');
  const notIssuedSkippedBarcodes = cones
    .filter((c) => String(c.issueStatus) !== 'issued')
    .map((c) => String(c.barcode));
  for (const c of cones.filter((x) => String(x.issueStatus) !== 'issued')) {
    auditRows.push({
      inputBarcode: String(c.barcode),
      action: 'not_issued_skipped',
      reason: `Cone issueStatus is '${String(c.issueStatus)}' (expected 'issued')`,
      coneId: String(c._id),
    });
  }

  const issuedConeIds = issuedCones.map((c) => c._id);
  const issuedConeIdStrSet = new Set(issuedConeIds.map((id) => String(id)));

  // Dedupe: cones already represented in a yarn_returned transaction
  const alreadyReturnedConeIdSet = await getAlreadyReturnedConeIdSet(issuedConeIds);
  const existingReturnTxnByConeId = await mapConeToExistingReturnTxnId(issuedConeIds);
  const alreadyReturnedTxnSkippedBarcodes = issuedCones
    .filter((c) => alreadyReturnedConeIdSet.has(String(c._id)))
    .map((c) => String(c.barcode));
  for (const c of issuedCones.filter((x) => alreadyReturnedConeIdSet.has(String(x._id)))) {
    const coneIdStr = String(c._id);
    auditRows.push({
      inputBarcode: String(c.barcode),
      action: 'already_has_return_txn',
      reason: 'Cone already referenced by an existing yarn_returned transaction (idempotent skip)',
      coneId: coneIdStr,
      returnTxnId: existingReturnTxnByConeId.get(coneIdStr) || '',
    });
  }

  const coneIdsNeedingReturnTxn = new Set(
    [...issuedConeIdStrSet].filter((idStr) => !alreadyReturnedConeIdSet.has(idStr))
  );

  // For those coneIds, resolve the latest issue transaction (primary truth)
  const coneToIssueTxn = await mapConeToLatestIssueTxn(coneIdsNeedingReturnTxn);
  const missingIssueTxnBarcodes = issuedCones
    .filter((c) => coneIdsNeedingReturnTxn.has(String(c._id)) && !coneToIssueTxn.has(String(c._id)))
    .map((c) => String(c.barcode));
  for (const c of issuedCones.filter((x) => coneIdsNeedingReturnTxn.has(String(x._id)) && !coneToIssueTxn.has(String(x._id)))) {
    auditRows.push({
      inputBarcode: String(c.barcode),
      action: 'missing_issue_txn',
      reason: 'No yarn_issued YarnTransaction found that references this coneId in conesIdsArray',
      coneId: String(c._id),
    });
  }

  // If issue transaction points to a yarnCatalogId that doesn't exist locally, we must skip txn creation
  // (createYarnTransaction() throws hard otherwise, aborting the whole job).
  const missingYarnCatalogForReturnTxnConeBarcodes = [];
  const coneIdsWithMissingCatalog = new Set();
  for (const idStr of coneIdsNeedingReturnTxn) {
    const issueTxn = coneToIssueTxn.get(idStr);
    if (!issueTxn) continue;
    const catalogId = issueTxn?.yarnCatalogId;
    if (!catalogId) continue;
    // eslint-disable-next-line no-await-in-loop
    const exists = await YarnCatalog.exists({ _id: catalogId });
    if (!exists) {
      coneIdsWithMissingCatalog.add(idStr);
    }
  }
  if (coneIdsWithMissingCatalog.size > 0) {
    for (const c of issuedCones) {
      const idStr = String(c._id);
      if (!coneIdsWithMissingCatalog.has(idStr)) continue;
      missingYarnCatalogForReturnTxnConeBarcodes.push(String(c.barcode));
      const issueTxn = coneToIssueTxn.get(idStr);
      auditRows.push({
        inputBarcode: String(c.barcode),
        action: 'missing_yarn_catalog',
        reason: 'Issue transaction yarnCatalogId not found in local yarncatalogs; skipped return txn creation',
        coneId: idStr,
        ...pickIssueTxnContext(issueTxn),
      });
    }
  }

  // Decide which cones we will actually process (return + txn creation)
  const allowedIssuedCones = issuedCones.filter((c) => {
    const idStr = String(c._id);
    if (!coneIdsNeedingReturnTxn.has(idStr)) return true; // already has return txn; still return cone if issued
    if (!coneToIssueTxn.has(idStr)) return !strictMissingIssueTxn;
    if (coneIdsWithMissingCatalog.has(idStr)) return true; // return the cone, but we will skip txn creation later
    return true;
  });

  // Return cones (empty). We do this per barcode to reuse validation + model hooks.
  let conesReturnedCount = 0;
  const returnedConeIdStrsForTxn = [];
  const impactedPairs = new Set(); // orderId|articleId from issue txn (only for cones we’ll create txn for)

  const totalToReturn = allowedIssuedCones.length;
  logger.info(
    `bulkReturnConesFromBarcodes: returning ${totalToReturn} cone(s) one-by-one (each hits DB); expect several minutes for large batches.`
  );

  let coneIndex = 0;
  for (const cone of allowedIssuedCones) {
    coneIndex += 1;
    if (coneIndex === 1 || coneIndex % 250 === 0 || coneIndex === totalToReturn) {
      logger.info(
        `bulkReturnConesFromBarcodes: progress ${coneIndex}/${totalToReturn} (latest barcode ${String(cone.barcode)})`
      );
    }
    try {
      await returnYarnCone(String(cone.barcode), {
        returnWeight: 0,
        returnDate,
        returnBy: { username: returnByUsername },
        coneStorageId: null,
      });
      conesReturnedCount += 1;
    } catch (e) {
      // Continue; caller can inspect logs/summary and rerun safely.
      // We intentionally do not swallow silently: rethrow for unexpected types.
      throw e;
    }

    const coneIdStr = String(cone._id);
    if (
      coneIdsNeedingReturnTxn.has(coneIdStr) &&
      coneToIssueTxn.has(coneIdStr) &&
      !coneIdsWithMissingCatalog.has(coneIdStr)
    ) {
      returnedConeIdStrsForTxn.push(coneIdStr);
      const txn = coneToIssueTxn.get(coneIdStr);
      const pairKey = `${txn?.orderId?.toString?.() || ''}|${txn?.articleId?.toString?.() || ''}`;
      if (pairKey !== '|') impactedPairs.add(pairKey);
    }
  }

  // Group and create return transactions
  const groups = new Map(); // key -> { issueTxn, coneIds: string[] }
  for (const coneIdStr of returnedConeIdStrsForTxn) {
    const issueTxn = coneToIssueTxn.get(coneIdStr);
    if (!issueTxn) continue;
    const k = buildTxnGroupKey(issueTxn);
    const existing = groups.get(k) || { issueTxn, coneIds: [] };
    existing.coneIds.push(coneIdStr);
    groups.set(k, existing);
  }

  let returnTransactionsCreatedCount = 0;
  const createdReturnTxnIdByGroupKey = new Map();
  for (const { issueTxn, coneIds } of groups.values()) {
    const hydration = await hydrateOrderAndArticleNumbers(issueTxn);
    const payload = {
      yarnCatalogId: issueTxn.yarnCatalogId,
      yarnName: issueTxn.yarnName,
      transactionType: 'yarn_returned',
      transactionDate: returnDate,
      transactionNetWeight: 0,
      transactionTotalWeight: 0,
      transactionTearWeight: 0,
      transactionConeCount: coneIds.length,
      orderId: issueTxn.orderId,
      orderno: issueTxn.orderno || hydration.orderno,
      articleId: issueTxn.articleId,
      articleNumber: issueTxn.articleNumber || hydration.articleNumber,
      machineId: issueTxn.machineId,
      conesIdsArray: coneIds.map((s) => new mongoose.Types.ObjectId(s)),
    };

    // If the issue txn is missing core refs, skip to avoid corrupt accounting rows.
    if (!payload.yarnCatalogId || !payload.orderId || !payload.articleId) {
      continue;
    }

    const created = await createYarnTransaction(payload);
    returnTransactionsCreatedCount += 1;
    createdReturnTxnIdByGroupKey.set(buildTxnGroupKey(issueTxn), created?._id ? String(created._id) : '');
  }

  // Snapshot MOA statuses before and after MOA updates (for CSV verification).
  const moaBeforeByPairKey = new Map();
  for (const pairKey of impactedPairs) {
    const [orderIdStr, articleIdStr] = String(pairKey).split('|');
    // eslint-disable-next-line no-await-in-loop
    moaBeforeByPairKey.set(pairKey, await snapshotMoaReturnStatuses(orderIdStr, articleIdStr));
  }

  // Add returned rows (with txn info)
  for (const cone of allowedIssuedCones) {
    const coneIdStr = String(cone._id);
    // If cone wasn't eligible for a return op due to strictMissingIssueTxn, it won't be in allowedIssuedCones.
    // So everything in this loop was returned at this point.
    const issueTxn = coneToIssueTxn.get(coneIdStr);
    const groupKey = issueTxn ? buildTxnGroupKey(issueTxn) : '';
    const returnTxnId = groupKey ? (createdReturnTxnIdByGroupKey.get(groupKey) || '') : '';
    const pairKey = issueTxn ? `${issueTxn?.orderId?.toString?.() || ''}|${issueTxn?.articleId?.toString?.() || ''}` : '';
    auditRows.push({
      inputBarcode: String(cone.barcode),
      action: 'returned',
      reason: 'Cone returned empty and un-issued; return transaction created when possible',
      coneId: coneIdStr,
      ...pickIssueTxnContext(issueTxn),
      returnTxnGroupKey: groupKey,
      returnTxnId,
      moaYarnReturnStatusBefore: pairKey ? (moaBeforeByPairKey.get(pairKey) || '') : '',
    });
  }

  // Update MachineOrderAssignment yarnReturnStatus when all cones returned for that order+article
  let moaItemsMarkedReturnCompletedCount = 0;
  for (const pairKey of impactedPairs) {
    const [orderIdStr, articleIdStr] = String(pairKey).split('|');
    if (!orderIdStr || !articleIdStr) continue;

    const remainingIssued = await YarnCone.countDocuments({
      issueStatus: 'issued',
      orderId: new mongoose.Types.ObjectId(orderIdStr),
      articleId: new mongoose.Types.ObjectId(articleIdStr),
    });
    if (remainingIssued > 0) continue;

    const assignments = await MachineOrderAssignment.find({
      productionOrderItems: {
        $elemMatch: {
          productionOrder: new mongoose.Types.ObjectId(orderIdStr),
          article: new mongoose.Types.ObjectId(articleIdStr),
        },
      },
    }).lean();

    for (const a of assignments) {
      const item = (a.productionOrderItems || []).find(
        (i) => String(i.productionOrder) === String(orderIdStr) && String(i.article) === String(articleIdStr)
      );
      if (!item) continue;
      const canComplete =
        String(item.status) === OrderStatus.COMPLETED && String(item.yarnIssueStatus) === YarnIssueStatus.COMPLETED;
      if (!canComplete) continue;
      if (String(item.yarnReturnStatus) === YarnReturnStatus.COMPLETED) continue;

      await updateMachineOrderAssignmentById(
        a._id,
        {
          productionOrderItems: [
            {
              productionOrder: new mongoose.Types.ObjectId(orderIdStr),
              article: new mongoose.Types.ObjectId(articleIdStr),
              yarnReturnStatus: YarnReturnStatus.COMPLETED,
            },
          ],
          remarks: 'CSV cone return backfill',
        },
        null
      );
      moaItemsMarkedReturnCompletedCount += 1;
    }
  }

  const moaAfterByPairKey = new Map();
  for (const pairKey of impactedPairs) {
    const [orderIdStr, articleIdStr] = String(pairKey).split('|');
    // eslint-disable-next-line no-await-in-loop
    moaAfterByPairKey.set(pairKey, await snapshotMoaReturnStatuses(orderIdStr, articleIdStr));
  }

  // Fill AFTER snapshot for returned rows (avoid extra DB queries per row).
  for (const row of auditRows) {
    if (row.action !== 'returned') continue;
    const orderIdStr = row.orderId || '';
    const articleIdStr = row.articleId || '';
    const pairKey = orderIdStr || articleIdStr ? `${orderIdStr}|${articleIdStr}` : '';
    if (!pairKey || !impactedPairs.has(pairKey)) continue;
    row.moaYarnReturnStatusAfter = moaAfterByPairKey.get(pairKey) || '';
  }

  return {
    inputCount: inputBarcodes.length,
    uniqueBarcodeCount: barcodes.length,
    missingConesBarcodes,
    notIssuedSkippedBarcodes,
    alreadyReturnedTxnSkippedBarcodes,
    missingIssueTxnBarcodes,
    missingYarnCatalogForReturnTxnConeBarcodes,
    auditRows,
    conesReturnedCount,
    returnTransactionsCreatedCount,
    moaItemsMarkedReturnCompletedCount,
  };
}

