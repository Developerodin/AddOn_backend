/**
 * Cycle-aware empty-return for Excel cone barcodes.
 *
 * A cone is "covered" only if yarn_returned exists for the SAME orderId+articleId as
 * the latest yarn_issued, with transactionDate >= that issue. Older leftover returns
 * (other order / other article) do NOT skip creating a 0 kg yarn_returned for this issue.
 */

import mongoose from 'mongoose';
import XLSX from 'xlsx';
import { YarnCone, YarnTransaction, YarnCatalog } from '../../models/index.js';
import { ProductionOrder, Article, MachineOrderAssignment } from '../../models/production/index.js';
import { OrderStatus, YarnIssueStatus, YarnReturnStatus } from '../../models/production/enums.js';
import { returnYarnCone } from '../../services/yarnManagement/yarnCone.service.js';
import { createYarnTransaction } from '../../services/yarnManagement/yarnTransaction.service.js';
import { updateMachineOrderAssignmentById } from '../../services/production/machineOrderAssignment.service.js';
import logger from '../../config/logger.js';

/**
 * @param {unknown} v
 * @returns {string}
 */
export function oid(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v._id) return String(v._id);
  return String(v);
}

/**
 * @param {unknown} d
 * @returns {number}
 */
export function txnTime(d) {
  return d ? new Date(d).getTime() : 0;
}

/**
 * @param {object} latestIssue
 * @param {object} returnTxn
 * @returns {boolean}
 */
export function returnCoversCurrentIssue(latestIssue, returnTxn) {
  const issueOrder = oid(latestIssue?.orderId);
  const issueArticle = oid(latestIssue?.articleId);
  if (!issueOrder || !issueArticle) return false;
  const sameOrder = oid(returnTxn?.orderId) === issueOrder;
  const sameArticle = oid(returnTxn?.articleId) === issueArticle;
  const issueAt = txnTime(latestIssue?.transactionDate || latestIssue?.createdAt);
  const returnAt = txnTime(returnTxn?.transactionDate || returnTxn?.createdAt);
  return sameOrder && sameArticle && returnAt >= issueAt;
}

/**
 * @param {object} issueTxn
 * @returns {string}
 */
export function buildTxnGroupKey(issueTxn) {
  return [
    oid(issueTxn?.yarnCatalogId),
    oid(issueTxn?.orderId),
    oid(issueTxn?.articleId),
    oid(issueTxn?.machineId),
    String(issueTxn?.orderno || ''),
    String(issueTxn?.articleNumber || ''),
  ].join('|');
}

/**
 * @param {string} filePath
 * @param {string|null} sheetName
 * @returns {{ barcode: string, excelOrder: string, rowIndex: number }[]}
 */
export function readExcelConeRows(filePath, sheetName) {
  const wb = XLSX.readFile(filePath);
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`Sheet not found. Available: ${wb.SheetNames.join(', ')}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
  return rows.map((row, idx) => {
    const norm = {};
    for (const [k, v] of Object.entries(row)) {
      norm[String(k).trim().toLowerCase()] = v == null ? '' : String(v).trim();
    }
    return {
      rowIndex: idx + 2,
      barcode: norm['cone barcode'] || norm.barcode || '',
      excelOrder: norm['order'] || norm['order '] || '',
    };
  });
}

/**
 * @param {string[]} barcodes
 * @returns {Promise<Map<string, object>>}
 */
export async function loadConesByBarcode(barcodes) {
  const map = new Map();
  const BATCH = 500;
  for (let i = 0; i < barcodes.length; i += BATCH) {
    const docs = await YarnCone.find({ barcode: { $in: barcodes.slice(i, i + BATCH) } })
      .select(
        '_id barcode issueStatus coneWeight tearWeight issueWeight issueDate orderId articleId yarnCatalogId yarnName coneStorageId returnedToVendorAt'
      )
      .lean();
    for (const c of docs) map.set(String(c.barcode), c);
  }
  return map;
}

/**
 * Latest yarn_issued + all yarn_returned per cone id.
 * @param {import('mongoose').Types.ObjectId[]} coneIds
 * @returns {Promise<{ latestIssue: Map<string, object>, returns: Map<string, object[]> }>}
 */
export async function loadIssueAndReturnTxns(coneIds) {
  const latestIssue = new Map();
  const returns = new Map();
  if (!coneIds.length) return { latestIssue, returns };

  const txns = await YarnTransaction.find({
    conesIdsArray: { $in: coneIds },
    transactionType: { $in: ['yarn_issued', 'yarn_returned'] },
  })
    .select(
      'transactionType transactionDate createdAt conesIdsArray orderId orderno articleId articleNumber machineId yarnCatalogId yarnName transactionNetWeight'
    )
    .sort({ transactionDate: -1, createdAt: -1 })
    .lean();

  for (const t of txns) {
    for (const id of t.conesIdsArray || []) {
      const s = String(id);
      if (t.transactionType === 'yarn_issued') {
        if (!latestIssue.has(s)) latestIssue.set(s, t);
      } else {
        const arr = returns.get(s) || [];
        arr.push(t);
        returns.set(s, arr);
      }
    }
  }
  return { latestIssue, returns };
}

/**
 * @param {object[]} rows
 * @returns {Promise<Set<string>>} coneIds whose issue yarnCatalogId is missing
 */
export async function findMissingCatalogConeIds(rows) {
  const missing = new Set();
  const catalogIds = [...new Set(rows.filter((r) => r.needsReturnTxn && r.latestIssue?.yarnCatalogId).map((r) => oid(r.latestIssue.yarnCatalogId)))];
  const existing = new Set();
  for (const id of catalogIds) {
    // eslint-disable-next-line no-await-in-loop
    const hit = await YarnCatalog.exists({ _id: id });
    if (hit) existing.add(id);
  }
  for (const r of rows) {
    if (!r.needsReturnTxn) continue;
    const cid = oid(r.latestIssue?.yarnCatalogId);
    if (cid && !existing.has(cid)) missing.add(r.coneId);
  }
  return missing;
}

/**
 * @param {object} issueTxn
 * @returns {Promise<{ orderno?: string, articleNumber?: string }>}
 */
async function hydrateOrderArticleNumbers(issueTxn) {
  const out = {};
  if (!String(issueTxn?.orderno || '').trim() && issueTxn?.orderId) {
    const order = await ProductionOrder.findById(issueTxn.orderId).select('orderNumber').lean();
    if (order?.orderNumber) out.orderno = String(order.orderNumber);
  }
  if (!String(issueTxn?.articleNumber || '').trim() && issueTxn?.articleId) {
    const article = await Article.findById(issueTxn.articleId).select('articleNumber').lean();
    if (article?.articleNumber) out.articleNumber = String(article.articleNumber);
  }
  return out;
}

/**
 * Close issued cones (empty) and create 0 kg yarn_returned grouped by latest issue context.
 * @param {ClassifiedRow[]} classified
 * @param {{ apply: boolean, returnByUsername: string, limit?: number|null }} opts
 * @returns {Promise<{ closed: number, txnsCreated: number, moaCompleted: number, errors: number, rows: ClassifiedRow[] }>}
 */
export async function applyEmptyReturns(classified, opts) {
  const apply = opts.apply === true;
  const returnByUsername = String(opts.returnByUsername || 'system').trim() || 'system';
  const limit = opts.limit == null ? null : Number(opts.limit);
  const missingCatalog = await findMissingCatalogConeIds(classified);

  let work = classified.filter((r) => r.needsConeClose);
  if (Number.isFinite(limit) && limit > 0) work = work.slice(0, limit);

  const returnDate = new Date();
  let closed = 0;
  let errors = 0;
  /** @type {ClassifiedRow[]} */
  const rows = classified.map((r) => ({ ...r }));
  const byBarcode = new Map(rows.map((r) => [r.barcode, r]));

  if (!apply) {
    for (const w of work) {
      const r = byBarcode.get(w.barcode);
      if (r && r.needsReturnTxn && missingCatalog.has(r.coneId)) {
        r.action = 'skip_missing_yarn_catalog';
        r.reason = 'Issue yarnCatalogId not found; would skip return txn';
        r.needsReturnTxn = false;
      }
    }
    return { closed: 0, txnsCreated: 0, moaCompleted: 0, errors: 0, rows };
  }

  const total = work.length;
  logger.info(`empty-return-excel: closing ${total} issued cone(s)`);
  for (let i = 0; i < work.length; i += 1) {
    const r = byBarcode.get(work[i].barcode);
    if (!r) continue;
    if (i === 0 || (i + 1) % 250 === 0 || i + 1 === total) {
      logger.info(`empty-return-excel: cone progress ${i + 1}/${total} (${r.barcode})`);
    }
    try {
      await returnYarnCone(r.barcode, {
        returnWeight: 0,
        returnDate,
        returnBy: { username: returnByUsername },
        coneStorageId: null,
      });
      closed += 1;
      r.action = r.needsReturnTxn ? 'closed_pending_txn' : 'closed_cone_only';
    } catch (err) {
      errors += 1;
      r.action = 'error_closing_cone';
      r.reason = err && err.message ? err.message : String(err);
      r.needsReturnTxn = false;
    }
  }

  const txnRows = work
    .map((w) => byBarcode.get(w.barcode))
    .filter((r) => r && r.needsReturnTxn && r.action === 'closed_pending_txn' && !missingCatalog.has(r.coneId));

  const groups = new Map();
  for (const r of txnRows) {
    const k = buildTxnGroupKey(r.latestIssue);
    const g = groups.get(k) || { issueTxn: r.latestIssue, coneIds: [], barcodes: [] };
    g.coneIds.push(r.coneId);
    g.barcodes.push(r.barcode);
    groups.set(k, g);
  }

  let txnsCreated = 0;
  const pairKeys = new Set();
  for (const g of groups.values()) {
    const hydration = await hydrateOrderArticleNumbers(g.issueTxn);
    const payload = {
      yarnCatalogId: g.issueTxn.yarnCatalogId,
      yarnName: g.issueTxn.yarnName,
      transactionType: 'yarn_returned',
      transactionDate: returnDate,
      transactionNetWeight: 0,
      transactionTotalWeight: 0,
      transactionTearWeight: 0,
      transactionConeCount: g.coneIds.length,
      orderId: g.issueTxn.orderId,
      orderno: g.issueTxn.orderno || hydration.orderno,
      articleId: g.issueTxn.articleId,
      articleNumber: g.issueTxn.articleNumber || hydration.articleNumber,
      machineId: g.issueTxn.machineId,
      conesIdsArray: g.coneIds.map((s) => new mongoose.Types.ObjectId(s)),
    };
    if (!payload.yarnCatalogId || !payload.orderId || !payload.articleId) {
      for (const b of g.barcodes) {
        const r = byBarcode.get(b);
        if (r) {
          r.action = 'closed_cone_txn_skipped_refs';
          r.reason = 'Closed cone but skipped yarn_returned (missing catalog/order/article)';
        }
      }
      continue;
    }
    try {
      const created = await createYarnTransaction(payload);
      txnsCreated += 1;
      const txnId = created?._id ? String(created._id) : '';
      pairKeys.add(`${oid(payload.orderId)}|${oid(payload.articleId)}`);
      for (const b of g.barcodes) {
        const r = byBarcode.get(b);
        if (r) {
          r.action = 'closed_cone_created_return_txn';
          r.returnTxnId = txnId;
        }
      }
    } catch (err) {
      errors += 1;
      for (const b of g.barcodes) {
        const r = byBarcode.get(b);
        if (r) {
          r.action = 'closed_cone_txn_error';
          r.reason = err && err.message ? err.message : String(err);
        }
      }
    }
  }

  let moaCompleted = 0;
  for (const pairKey of pairKeys) {
    const [orderIdStr, articleIdStr] = pairKey.split('|');
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
        (i) => oid(i.productionOrder) === orderIdStr && oid(i.article) === articleIdStr
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
          remarks: 'Excel empty-return cone backfill',
        },
        null
      );
      moaCompleted += 1;
    }
  }

  return { closed, txnsCreated, moaCompleted, errors, rows };
}

/**
 * @param {ClassifiedRow[]} rows
 * @returns {Record<string, number>}
 */
export function countByAction(rows) {
  const out = {};
  for (const r of rows) {
    const k = r.action || 'unknown';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
