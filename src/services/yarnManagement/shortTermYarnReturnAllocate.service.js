import mongoose from 'mongoose';
import { YarnCone, YarnTransaction, YarnCatalog } from '../../models/index.js';
import { ProductionOrder, Article, MachineOrderAssignment } from '../../models/production/index.js';
import { returnYarnCone } from './yarnCone.service.js';
import { createYarnTransaction } from './yarnTransaction.service.js';
import { updateMachineOrderAssignmentById } from '../production/machineOrderAssignment.service.js';
import { OrderStatus, YarnIssueStatus, YarnReturnStatus } from '../../models/production/enums.js';
import logger from '../../config/logger.js';

const ISSUE_TX_TYPES = ['yarn_issued', 'yarn_issued_linking', 'yarn_issued_sampling'];

const isNonEmptyString = (v) => v != null && String(v).trim() !== '';

/**
 * @typedef {Object} AllocateCsvRow
 * @property {string} cone_barcode
 * @property {string} order_no
 * @property {string} article_number
 * @property {string} current_issue_status
 * @property {number} current_weight_db
 * @property {number} actual_weight
 * @property {string} location_to_allocate
 */

/**
 * @typedef {Object} AllocateReportRow
 * @property {string} cone_barcode
 * @property {string} order_no
 * @property {string} article_number
 * @property {string} csv_issue_status
 * @property {string} db_issue_status_before
 * @property {string} action
 * @property {string} status
 * @property {string} reason
 * @property {number} [actual_weight]
 * @property {string} [location_to_allocate]
 * @property {number} [weight_before]
 * @property {number} [weight_after]
 * @property {string} [storage_before]
 * @property {string} [storage_after]
 * @property {string} [return_txn_id]
 * @property {string} [issue_txn_id]
 * @property {string} [order_id]
 * @property {string} [article_id]
 */

/**
 * @param {unknown} v
 * @returns {number}
 */
function toWeight(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isEmptyWeight(v) {
  return toWeight(v) < 0.01;
}

/**
 * @param {AllocateCsvRow} row
 * @param {Record<string, unknown>} extra
 * @returns {AllocateReportRow}
 */
function reportRow(row, extra) {
  return {
    cone_barcode: row.cone_barcode,
    order_no: row.order_no,
    article_number: row.article_number,
    csv_issue_status: row.current_issue_status,
    db_issue_status_before: '',
    action: '',
    status: '',
    reason: '',
    actual_weight: row.actual_weight,
    location_to_allocate: row.location_to_allocate,
    weight_before: undefined,
    weight_after: undefined,
    storage_before: '',
    storage_after: '',
    return_txn_id: '',
    issue_txn_id: '',
    order_id: '',
    article_id: '',
    ...extra,
  };
}

/**
 * @param {string[]} barcodes
 * @returns {Promise<Map<string, import('mongoose').LeanDocument<any>>>}
 */
async function loadConesByBarcode(barcodes) {
  const unique = [...new Set(barcodes.filter(Boolean))];
  const cones = await YarnCone.find({ barcode: { $in: unique } })
    .select('_id barcode issueStatus returnStatus orderId articleId yarnCatalogId yarnName coneWeight tearWeight coneStorageId')
    .lean();
  return new Map(cones.map((c) => [String(c.barcode), c]));
}

/**
 * @param {mongoose.Types.ObjectId[]} coneIds
 * @returns {Promise<Set<string>>}
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
 * Latest issue transaction per cone (any floor issue type).
 * @param {Set<string>} targetConeIdStrSet
 * @returns {Promise<Map<string, any>>}
 */
async function mapConeToLatestIssueTxn(targetConeIdStrSet) {
  if (targetConeIdStrSet.size === 0) return new Map();
  const targetConeIds = [...targetConeIdStrSet].map((s) => new mongoose.Types.ObjectId(s));
  const txns = await YarnTransaction.find({
    transactionType: { $in: ISSUE_TX_TYPES },
    conesIdsArray: { $in: targetConeIds },
  })
    .sort({ transactionDate: -1, createdAt: -1 })
    .lean();

  const resolved = new Map();
  for (const txn of txns) {
    for (const coneId of txn?.conesIdsArray || []) {
      const idStr = coneId ? String(coneId) : '';
      if (!idStr || !targetConeIdStrSet.has(idStr)) continue;
      if (!resolved.has(idStr)) resolved.set(idStr, txn);
    }
    if (resolved.size === targetConeIdStrSet.size) break;
  }
  return resolved;
}

/**
 * Order/article for returnYarnCone — never from CSV (CSV can disagree with issue history).
 * Prefer cone document, then latest issue transaction.
 * @param {import('mongoose').LeanDocument<any>} cone
 * @param {any} [issueTxn]
 * @returns {{ orderId?: string, articleId?: string, source?: string }}
 */
function resolveReturnOrderArticleFromDb(cone, issueTxn) {
  if (cone?.orderId && cone?.articleId) {
    return {
      orderId: String(cone.orderId),
      articleId: String(cone.articleId),
      source: 'cone_document',
    };
  }
  if (issueTxn?.orderId && issueTxn?.articleId) {
    return {
      orderId: String(issueTxn.orderId),
      articleId: String(issueTxn.articleId),
      source: 'issue_transaction',
    };
  }
  return {};
}

/**
 * @param {any} issueTxn
 * @returns {Promise<{ orderno?: string, articleNumber?: string }>}
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
 * @param {import('mongoose').Document | import('mongoose').LeanDocument<any>} cone
 * @param {number} actualWeight
 * @param {string} location
 * @param {boolean} dryRun
 * @returns {Promise<{ weightAfter: number, storageAfter: string }>}
 */
async function relocateAndReweightCone(cone, actualWeight, location, dryRun) {
  const weightAfter = toWeight(actualWeight);
  const storageAfter = isEmptyWeight(weightAfter) ? '' : String(location || '').trim();

  if (!dryRun) {
    const doc = await YarnCone.findById(cone._id);
    if (!doc) throw new Error(`Cone ${cone._id} not found for relocate`);
    doc.coneWeight = weightAfter;
    doc.tearWeight = 0;
    if (isEmptyWeight(weightAfter)) {
      doc.issueStatus = 'used';
      doc.coneStorageId = undefined;
    } else {
      doc.coneStorageId = storageAfter;
    }
    await doc.save();
  }

  return { weightAfter, storageAfter };
}

/**
 * @param {any} issueTxn
 * @param {string} coneIdStr
 * @param {number} actualWeight
 * @param {string} location
 * @param {Date} returnDate
 * @param {boolean} dryRun
 * @returns {Promise<string>} return txn id or empty
 */
async function createReturnTransactionForCone(issueTxn, coneIdStr, actualWeight, location, returnDate, dryRun) {
  if (!issueTxn?.yarnCatalogId || !issueTxn?.orderId || !issueTxn?.articleId) {
    return '';
  }
  const catalogExists = await YarnCatalog.exists({ _id: issueTxn.yarnCatalogId });
  if (!catalogExists) return '';

  const hydration = await hydrateOrderAndArticleNumbers(issueTxn);
  const gross = toWeight(actualWeight);
  const payload = {
    yarnCatalogId: issueTxn.yarnCatalogId,
    yarnName: issueTxn.yarnName,
    transactionType: 'yarn_returned',
    transactionDate: returnDate,
    transactionNetWeight: gross,
    transactionTotalWeight: gross,
    transactionTearWeight: 0,
    transactionConeCount: 1,
    orderId: issueTxn.orderId,
    orderno: issueTxn.orderno || hydration.orderno,
    articleId: issueTxn.articleId,
    articleNumber: issueTxn.articleNumber || hydration.articleNumber,
    machineId: issueTxn.machineId,
    conesIdsArray: [new mongoose.Types.ObjectId(coneIdStr)],
    toStorageLocation: String(location || '').trim() || undefined,
  };

  if (dryRun) return 'dry-run';

  const created = await createYarnTransaction(payload);
  return created?._id ? String(created._id) : '';
}

/**
 * Mark MOA yarn return completed when no issued cones remain for order+article.
 * @param {Set<string>} impactedPairs orderId|articleId
 * @param {boolean} dryRun
 * @returns {Promise<number>}
 */
async function maybeCompleteMoaYarnReturn(impactedPairs, dryRun) {
  if (dryRun || !impactedPairs.size) return 0;
  let count = 0;
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
        (i) => String(i.productionOrder) === orderIdStr && String(i.article) === articleIdStr
      );
      if (!item) continue;
      const canComplete =
        String(item.status) === OrderStatus.COMPLETED && String(item.yarnIssueStatus) === YarnIssueStatus.COMPLETED;
      if (!canComplete || String(item.yarnReturnStatus) === YarnReturnStatus.COMPLETED) continue;

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
          remarks: 'Short-term yarn return allocate script',
        },
        null
      );
      count += 1;
    }
  }
  return count;
}

/**
 * Process short-term yarn return allocation CSV rows.
 * @param {Object} options
 * @param {AllocateCsvRow[]} options.rows
 * @param {Date} [options.returnDate]
 * @param {string} [options.returnByUsername]
 * @param {boolean} [options.dryRun]
 * @returns {Promise<{ reportRows: AllocateReportRow[], summary: Record<string, number> }>}
 */
export async function processShortTermYarnReturnAllocate(options) {
  const rows = Array.isArray(options?.rows) ? options.rows : [];
  const returnDate = options?.returnDate instanceof Date ? options.returnDate : new Date();
  const returnByUsername = String(options?.returnByUsername || 'st-yarn-return-allocate').trim();
  const dryRun = Boolean(options?.dryRun);

  const reportRows = [];
  const summary = {
    inputRows: rows.length,
    success: 0,
    skipped: 0,
    error: 0,
    issuedReturned: 0,
    issuedReturnTxnCreated: 0,
    notIssuedRelocated: 0,
    moaCompleted: 0,
  };

  const coneByBarcode = await loadConesByBarcode(rows.map((r) => r.cone_barcode));
  const issuedConeIds = rows
    .map((r) => coneByBarcode.get(r.cone_barcode))
    .filter((c) => c && String(c.issueStatus) === 'issued')
    .map((c) => c._id);

  const alreadyReturnedSet = await getAlreadyReturnedConeIdSet(issuedConeIds);
  const issuedIdStrSet = new Set(
    rows
      .map((r) => coneByBarcode.get(r.cone_barcode))
      .filter((c) => c && String(c.issueStatus) === 'issued')
      .map((c) => String(c._id))
  );
  const coneToIssueTxn = await mapConeToLatestIssueTxn(issuedIdStrSet);
  const impactedPairs = new Set();

  let rowIndex = 0;
  for (const row of rows) {
    rowIndex += 1;
    const barcode = String(row.cone_barcode || '').trim();
    const location = String(row.location_to_allocate || '').trim();
    const actualWeight = toWeight(row.actual_weight);
    const csvStatus = String(row.current_issue_status || '').trim().toLowerCase();

    if (!barcode) {
      reportRows.push(
        reportRow(row, {
          status: 'skipped',
          action: 'invalid_row',
          reason: 'Missing cone_barcode',
        })
      );
      summary.skipped += 1;
      continue;
    }

    if (!location && !isEmptyWeight(actualWeight)) {
      reportRows.push(
        reportRow(row, {
          status: 'skipped',
          action: 'invalid_row',
          reason: 'Missing location_to_allocate for non-empty cone',
        })
      );
      summary.skipped += 1;
      continue;
    }

    const cone = coneByBarcode.get(barcode);
    if (!cone) {
      reportRows.push(
        reportRow(row, {
          status: 'error',
          action: 'missing_cone',
          reason: 'YarnCone not found',
        })
      );
      summary.error += 1;
      continue;
    }

    const dbStatusBefore = String(cone.issueStatus || '');
    const weightBefore = cone.coneWeight;
    const storageBefore = String(cone.coneStorageId || '');
    const coneIdStr = String(cone._id);
    const dbIsIssued = dbStatusBefore === 'issued';

    if (rowIndex === 1 || rowIndex % 50 === 0 || rowIndex === rows.length) {
      logger.info(`ST yarn return allocate: ${rowIndex}/${rows.length} (${barcode})`);
    }

    const base = {
      db_issue_status_before: dbStatusBefore,
      weight_before: weightBefore,
      storage_before: storageBefore,
    };

    const csvMismatch =
      (csvStatus === 'issued' && !dbIsIssued) || (csvStatus === 'not_issued' && dbIsIssued);

    try {
      if (dbIsIssued) {
        const issueTxn = coneToIssueTxn.get(coneIdStr);
        const dbCtx = resolveReturnOrderArticleFromDb(cone, issueTxn);
        const returnPayload = {
          returnWeight: actualWeight,
          returnDate,
          returnBy: { username: returnByUsername },
          coneStorageId: isEmptyWeight(actualWeight) ? null : location,
        };
        if (dbCtx.orderId && dbCtx.articleId) {
          returnPayload.orderId = dbCtx.orderId;
          returnPayload.articleId = dbCtx.articleId;
        }
        const csvOrderArticleNote =
          isNonEmptyString(row.order_no) || isNonEmptyString(row.article_number)
            ? ` (CSV order/article ignored for return; using ${dbCtx.source || 'no order context'})`
            : '';

        const hasReturnTxn = alreadyReturnedSet.has(coneIdStr);
        let returnTxnId = '';

        if (!dryRun) {
          await returnYarnCone(barcode, returnPayload);
        }

        if (!hasReturnTxn && issueTxn) {
          returnTxnId = await createReturnTransactionForCone(
            issueTxn,
            coneIdStr,
            actualWeight,
            location,
            returnDate,
            dryRun
          );
          if (returnTxnId && returnTxnId !== 'dry-run') {
            alreadyReturnedSet.add(coneIdStr);
            summary.issuedReturnTxnCreated += 1;
          } else if (returnTxnId === 'dry-run') {
            summary.issuedReturnTxnCreated += 1;
          }
        } else if (hasReturnTxn) {
          returnTxnId = '(existing)';
        } else if (!issueTxn) {
          reportRows.push(
            reportRow(row, {
              ...base,
              status: 'success',
              action: 'issued_return_no_txn',
              reason: csvMismatch
                ? `Cone returned and placed; CSV said ${csvStatus}. No issue txn — yarn_returned not created.`
                : 'Cone returned and placed; no matching issue transaction for yarn_returned',
              weight_after: actualWeight,
              storage_after: isEmptyWeight(actualWeight) ? '' : location,
              order_id: returnPayload.orderId || '',
              article_id: returnPayload.articleId || '',
            })
          );
          summary.issuedReturned += 1;
          summary.success += 1;
          if (returnPayload.orderId && returnPayload.articleId) {
            impactedPairs.add(`${returnPayload.orderId}|${returnPayload.articleId}`);
          }
          continue;
        }

        const pairOrder = returnPayload.orderId || (issueTxn?.orderId ? String(issueTxn.orderId) : '');
        const pairArticle = returnPayload.articleId || (issueTxn?.articleId ? String(issueTxn.articleId) : '');
        if (pairOrder && pairArticle) impactedPairs.add(`${pairOrder}|${pairArticle}`);

        reportRows.push(
          reportRow(row, {
            ...base,
            status: 'success',
            action: hasReturnTxn ? 'issued_return_relocate' : 'issued_return_and_txn',
            reason: csvMismatch
              ? `DB was issued; CSV said ${csvStatus}. Returned with weight ${actualWeight} → ${location || 'empty/used'}${csvOrderArticleNote}`
              : `Returned with weight ${actualWeight} → ${location || 'empty/used'}${csvOrderArticleNote}`,
            weight_after: actualWeight,
            storage_after: isEmptyWeight(actualWeight) ? '' : location,
            return_txn_id: returnTxnId,
            issue_txn_id: issueTxn?._id ? String(issueTxn._id) : '',
            order_id: pairOrder,
            article_id: pairArticle,
          })
        );
        summary.issuedReturned += 1;
        summary.success += 1;
        continue;
      }

      // not issued in DB — relocate / reweight only
      const { weightAfter, storageAfter } = await relocateAndReweightCone(
        cone,
        actualWeight,
        location,
        dryRun
      );

      reportRows.push(
        reportRow(row, {
          ...base,
          status: 'success',
          action: 'not_issued_relocate',
          reason: csvMismatch
            ? `DB was ${dbStatusBefore}; CSV said issued. Updated weight and storage only.`
            : 'Updated coneWeight and coneStorageId (no return transaction)',
          weight_after: weightAfter,
          storage_after: storageAfter,
        })
      );
      summary.notIssuedRelocated += 1;
      summary.success += 1;
    } catch (err) {
      reportRows.push(
        reportRow(row, {
          ...base,
          status: 'error',
          action: dbIsIssued ? 'issued_return_failed' : 'not_issued_relocate_failed',
          reason: err?.message || String(err),
        })
      );
      summary.error += 1;
    }
  }

  summary.moaCompleted = await maybeCompleteMoaYarnReturn(impactedPairs, dryRun);

  return { reportRows, summary };
}
