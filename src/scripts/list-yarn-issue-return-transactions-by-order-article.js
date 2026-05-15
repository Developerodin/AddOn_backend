#!/usr/bin/env node

/**
 * List yarn transactions that **issue** or **return** cones for a production order + article,
 * based on YarnTransaction (`transactionType`, `orderId` / `orderno`, `articleId` / `articleNumber`)
 * and optional `conesIdsArray`.
 *
 * This is **ledger/history**: issue rows remain even after cones are returned or bypass-cleared on
 * YarnCone without a matching `yarn_returned` txn. For “how many still need return” use
 * GET …/article-return-slice (pendingConeCount), not this script’s row counts alone.
 *
 * Default transaction types:
 *   yarn_issued, yarn_issued_linking, yarn_issued_sampling, yarn_returned
 *
 * Usage:
 *   npx cross-env NODE_ENV=development node src/scripts/list-yarn-issue-return-transactions-by-order-article.js ORD-000053 A5632
 *   npx cross-env NODE_ENV=development node src/scripts/list-yarn-issue-return-transactions-by-order-article.js ORD-000053 A5632 --json
 *   npx cross-env NODE_ENV=development node src/scripts/list-yarn-issue-return-transactions-by-order-article.js ORD-000053 A5632 --csv=./yarn-txn-cones.csv
 *
 * Options:
 *   --types=a,b   Comma-separated transaction types (e.g. yarn_issued,yarn_returned).
 *   --all-types   All enum types on YarnTransaction (issued, stocked, blocked, transfer, returned, …).
 */

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import config from '../config/config.js';
import { ProductionOrder, Article } from '../models/production/index.js';
// Populate `conesIdsArray` needs YarnCone registered on Mongoose default connection (side-effect load).
import '../models/yarnReq/yarnCone.model.js';
import YarnTransaction, { yarnTransactionTypes } from '../models/yarnReq/yarnTransaction.model.js';

/** @type {readonly string[]} */
const DEFAULT_TYPES = ['yarn_issued', 'yarn_issued_linking', 'yarn_issued_sampling', 'yarn_returned'];

const ISSUE_LIKE_TYPES = new Set(['yarn_issued', 'yarn_issued_linking', 'yarn_issued_sampling']);

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} name
 * @returns {string|null}
 */
function readArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (!arg) return null;
  const v = arg.slice(prefix.length).trim();
  return v || null;
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const jsonOutput = process.argv.includes('--json');
const allTypesFlag = process.argv.includes('--all-types');
const csvPath = readArg('csv');
const typesArg = readArg('types');

/**
 * @param {unknown} value
 * @returns {string}
 */
function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {unknown} id
 * @returns {string}
 */
function oidStr(id) {
  if (id == null) return '';
  if (typeof id === 'object' && id !== null && '_bsontype' in id) return String(id);
  return String(id);
}

/**
 * @param {string[]} raw
 * @returns {string[]}
 */
function resolveTypes(raw) {
  if (allTypesFlag) return [...yarnTransactionTypes];
  if (raw?.length) {
    const cleaned = raw.map((t) => t.trim()).filter(Boolean);
    const bad = cleaned.filter((t) => !yarnTransactionTypes.includes(t));
    if (bad.length) {
      throw new Error(`Unknown transaction types: ${bad.join(', ')}. Valid: ${yarnTransactionTypes.join(', ')}`);
    }
    return cleaned;
  }
  return [...DEFAULT_TYPES];
}

/**
 * @param {Array<{ _id?: unknown } & Record<string, unknown>>} cones
 * @returns {{ barcode: string, boxId: string, yarnName: string, coneId: string }[]}
 */
function normaliseConeRefs(cones) {
  const out = [];
  for (const c of cones || []) {
    if (!c || typeof c !== 'object') continue;
    const id = oidStr(c._id);
    if (!id) continue;
    out.push({
      barcode: c.barcode != null ? String(c.barcode) : '',
      boxId: c.boxId != null ? String(c.boxId) : '',
      yarnName: c.yarnName != null ? String(c.yarnName) : '',
      coneId: id,
    });
  }
  return out;
}

/**
 * @param {import('mongoose').Types.ObjectId} orderId
 * @param {import('mongoose').Types.ObjectId[]} articleIds
 * @param {string} orderNumber
 * @param {string} articleNumber
 * @returns {object}
 */
function buildTxnFilter(orderId, articleIds, orderNumber, articleNumber) {
  const ordRe = new RegExp(`^${escapeRegex(orderNumber)}$`, 'i');
  const artRe = new RegExp(`^${escapeRegex(articleNumber)}$`, 'i');
  return {
    $and: [
      {
        $or: [{ orderId }, { orderno: ordRe }],
      },
      {
        $or: [{ articleId: { $in: articleIds } }, { articleNumber: artRe }],
      },
    ],
  };
}

async function main() {
  const orderNumber = (args[0] || '').trim();
  const articleNumber = (args[1] || '').trim();

  if (!orderNumber || !articleNumber) {
    console.error(
      'Usage: node src/scripts/list-yarn-issue-return-transactions-by-order-article.js <orderNumber> <articleNumber> [--json] [--csv=path] [--types=a,b] [--all-types]'
    );
    console.error('Example: node src/scripts/...js ORD-000053 A5632');
    process.exit(1);
  }

  const types = resolveTypes(typesArg ? typesArg.split(',').map((x) => x.trim()) : []);

  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const order = await ProductionOrder.findOne({ orderNumber }).select('_id orderNumber').lean();
  if (!order) {
    console.error(`ProductionOrder not found: orderNumber=${orderNumber}`);
    process.exit(1);
  }

  const articleRe = new RegExp(`^${escapeRegex(articleNumber)}$`, 'i');
  const articles = await Article.find({
    orderId: order._id,
    articleNumber: articleRe,
  })
    .select('_id id articleNumber')
    .lean();

  if (!articles.length) {
    console.error(
      `No Article on order ${orderNumber} with articleNumber matching "${articleNumber}" (case-insensitive).`
    );
    process.exit(1);
  }

  const articleIds = articles.map((a) => a._id);

  const baseFilter = buildTxnFilter(order._id, articleIds, orderNumber, articleNumber);
  const mongooseFilter = { ...baseFilter, transactionType: { $in: types } };

  const transactions = await YarnTransaction.find(mongooseFilter)
    .sort({ transactionDate: -1, _id: -1 })
    .populate({
      path: 'yarnCatalogId',
      select: '_id yarnName yarnType status',
    })
    .populate({ path: 'orderId', select: 'orderNumber' })
    .populate({ path: 'articleId', select: 'articleNumber orderId' })
    .populate({
      path: 'conesIdsArray',
      select: 'barcode boxId yarnName issueStatus orderId articleId coneWeight tearWeight',
    })
    .lean();

  /** @type {Map<string, number>} */
  const countByType = new Map();
  /** @type {Set<string>} */
  const conesFromIssueTx = new Set();
  /** @type {Set<string>} */
  const conesFromReturnTx = new Set();

  /** @type {(arr: unknown) => string[]} */
  const coneIdsFromArray = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item) => {
        if (item == null) return '';
        if (typeof item === 'object' && item !== null && '_id' in item) return oidStr(item._id);
        return oidStr(item);
      })
      .filter(Boolean);
  };

  for (const t of transactions) {
    const tt = String(t.transactionType || '');
    countByType.set(tt, (countByType.get(tt) || 0) + 1);
    const ids = coneIdsFromArray(t.conesIdsArray);
    if (tt === 'yarn_returned') {
      ids.forEach((id) => conesFromReturnTx.add(id));
    } else if (ISSUE_LIKE_TYPES.has(tt)) {
      ids.forEach((id) => conesFromIssueTx.add(id));
    }
  }

  const serializedTransactions = transactions.map((t) => {
    /** @type {{ barcode: string, boxId: string, yarnName: string, coneId: string }[]} */
    let coneRefs = [];
    const arr = Array.isArray(t.conesIdsArray) ? t.conesIdsArray : [];
    const looksPopulated = (item) =>
      !!item &&
      typeof item === 'object' &&
      Object.keys(item).filter((k) => !String(k).startsWith('$')).length > 1;
    const allPopulated = arr.length && arr.every((x) => looksPopulated(x));
    if (allPopulated) {
      coneRefs = normaliseConeRefs(/** @type {object[]} */ (arr));
    } else {
      coneRefs = arr.map((item) => {
        if (!item || typeof item !== 'object') {
          const id = oidStr(item);
          return id ? { coneId: id, barcode: '', boxId: '', yarnName: '' } : null;
        }
        if ('_id' in item) {
          return {
            barcode: item.barcode != null ? String(item.barcode) : '',
            boxId: item.boxId != null ? String(item.boxId) : '',
            yarnName: item.yarnName != null ? String(item.yarnName) : '',
            coneId: oidStr(item._id),
          };
        }
        const id = oidStr(item);
        return id ? { coneId: id, barcode: '', boxId: '', yarnName: '' } : null;
      }).filter(Boolean);
    }

    return {
      _id: oidStr(t._id),
      transactionType: t.transactionType,
      transactionDate: t.transactionDate ? new Date(t.transactionDate).toISOString() : '',
      yarnName: t.yarnName,
      yarnCatalogId: t.yarnCatalogId ? (typeof t.yarnCatalogId === 'object' ? oidStr(t.yarnCatalogId._id) : oidStr(t.yarnCatalogId)) : '',
      orderId: t.orderId ? (typeof t.orderId === 'object' ? oidStr(t.orderId._id || t.orderId) : oidStr(t.orderId)) : oidStr(order._id),
      orderno: t.orderno || '',
      orderNumberResolved: typeof t.orderId === 'object' && t.orderId?.orderNumber ? String(t.orderId.orderNumber) : orderNumber,
      articleId: t.articleId ? (typeof t.articleId === 'object' ? oidStr(t.articleId._id || t.articleId) : oidStr(t.articleId)) : '',
      articleNumber: t.articleNumber || (typeof t.articleId === 'object' ? t.articleId?.articleNumber : '') || '',
      transactionNetWeight: t.transactionNetWeight,
      transactionTotalWeight: t.transactionTotalWeight,
      transactionTearWeight: t.transactionTearWeight,
      transactionConeCount: t.transactionConeCount,
      issuedByEmail: t.issuedByEmail || '',
      issueBatchId: t.issueBatchId || '',
      coneIdsInTxn: coneRefs.map((c) => c.coneId),
      cones: coneRefs,
    };
  });

  /** @type {typeof serializedTransactions} */
  const mismatchTxns = serializedTransactions.filter(
    (t) =>
      ISSUE_LIKE_TYPES.has(String(t.transactionType)) || String(t.transactionType) === 'yarn_returned'
  ).filter((t) => {
    const nList = (t.cones || []).length;
    const nField = Number(t.transactionConeCount ?? 0);
    return nList > 0 && nField !== nList;
  });

  const summary = {
    orderNumber,
    articleNumber,
    productionOrderId: String(order._id),
    matchedArticles: articles.map((a) => ({
      _id: String(a._id),
      id: a.id,
      articleNumber: a.articleNumber,
    })),
    transactionTypesQueried: types,
    transactionCount: transactions.length,
    countsByTransactionType: Object.fromEntries(countByType),
    distinctConeIdsInIssueTransactions: conesFromIssueTx.size,
    distinctConeIdsInReturnTransactions: conesFromReturnTx.size,
    /** Cones appearing in issue txns but not in any matched return txn under this query. */
    coneIdsIssuedMinusReturnedListed: [...conesFromIssueTx].filter((id) => !conesFromReturnTx.has(id)),
    coneIdsReturnedButNotInIssueList: [...conesFromReturnTx].filter((id) => !conesFromIssueTx.has(id)),
    transactionsWhereConeCountMismatch: mismatchTxns.map((t) => ({
      _id: t._id,
      transactionType: t.transactionType,
      transactionConeCount: t.transactionConeCount,
      conesIdsArrayLength: (t.cones || []).length,
    })),
    transactions: serializedTransactions,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
    await mongoose.disconnect();
    return;
  }

  if (csvPath) {
    const out = path.resolve(csvPath);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const headers = [
      'orderNumber',
      'articleNumber',
      'transactionId',
      'transactionType',
      'transactionDate',
      'yarnName',
      'transactionConeCount',
      'coneId',
      'coneBarcode',
      'coneBoxId',
      'issuedByEmail',
      'issueBatchId',
    ];
    const rows = [];
    for (const t of serializedTransactions) {
      if ((t.cones || []).length) {
        for (const c of t.cones || []) {
          rows.push([
            csvCell(orderNumber),
            csvCell(articleNumber),
            csvCell(t._id),
            csvCell(t.transactionType),
            csvCell(t.transactionDate),
            csvCell(t.yarnName),
            csvCell(t.transactionConeCount),
            csvCell(c.coneId),
            csvCell(c.barcode),
            csvCell(c.boxId),
            csvCell(t.issuedByEmail),
            csvCell(t.issueBatchId),
          ]);
        }
      } else {
        rows.push([
          csvCell(orderNumber),
          csvCell(articleNumber),
          csvCell(t._id),
          csvCell(t.transactionType),
          csvCell(t.transactionDate),
          csvCell(t.yarnName),
          csvCell(t.transactionConeCount),
          csvCell(''),
          csvCell(''),
          csvCell(''),
          csvCell(t.issuedByEmail),
          csvCell(t.issueBatchId),
        ]);
      }
    }
    fs.writeFileSync(out, `${headers.join(',')}\n${rows.map((r) => r.join(',')).join('\n')}\n`, 'utf8');
    console.log(`Wrote ${rows.length} row(s) to ${out}`);
    await mongoose.disconnect();
    return;
  }

  console.log(
    `\nOrder ${orderNumber} / article ${articleNumber}: ${transactions.length} transaction(s) ` +
      `(types: ${types.join(', ')}).\n`
  );
  console.log('Counts by type:', JSON.stringify(summary.countsByTransactionType, null, 2));
  console.log(`Distinct cones in issue-like txns: ${conesFromIssueTx.size}`);
  console.log(`Distinct cones in yarn_returned txns: ${conesFromReturnTx.size}`);
  if (mismatchTxns.length) {
    console.log(
      `\nWarning: ${mismatchTxns.length} txn(s) have transactionConeCount != len(conesIdsArray); see transactionsWhereConeCountMismatch in --json.\n`
    );
  }

  for (let i = 0; i < serializedTransactions.length; i += 1) {
    const t = serializedTransactions[i];
    const nCones = (t.cones || []).length || Number(t.transactionConeCount || 0);
    console.log(
      `${i + 1}. ${t.transactionType}\t${t.transactionDate}\t${t.yarnName}\tcones=${nCones}\ttxn=${t._id}`
    );
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err?.stack || err?.message || String(err));
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
