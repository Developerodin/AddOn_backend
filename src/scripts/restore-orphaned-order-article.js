#!/usr/bin/env node

/**
 * Restore an article that was removed from a production order's `articles` array while
 * production was still active (orphaned Article doc + missing MOA queue row).
 *
 * Fixes:
 *   1. Re-adds the article ObjectId to `ProductionOrder.articles` ($addToSet).
 *   2. Ensures `Article.machineId` matches the target machine (optional).
 *   3. Re-adds or repairs the machine-order-assignment queue row with inferred statuses.
 *
 * Default target (ORD-000075 / A254 / K037) matches the known orphan case; override via CLI.
 *
 * Preview (no writes):
 *   cd AddOn_backend
 *   NODE_ENV=development node src/scripts/restore-orphaned-order-article.js
 *
 * Apply:
 *   NODE_ENV=development node src/scripts/restore-orphaned-order-article.js --write
 *
 * Custom row:
 *   NODE_ENV=development node src/scripts/restore-orphaned-order-article.js \
 *     --order=ORD-000075 --article=A254 --machine=K037 --write
 *
 * Options:
 *   --order=<ORD-000075>     Production order number
 *   --article=<A254>         Article factory code / articleNumber
 *   --machine=<K037>         Machine code or number (defaults to article.machineId if omitted)
 *   --write                  Persist changes (default is dry-run preview only)
 *   --mongo-url=<uri>        Override Mongo connection string
 *   --json                   Print JSON result only
 */

import url from 'url';

const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try {
    return _origUrlParse.call(this, urlStr, ...args);
  } catch {
    const firstHost = String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2');
    return _origUrlParse.call(this, firstHost, ...args);
  }
};

import mongoose from 'mongoose';
import config from '../config/config.js';
import Machine from '../models/machine.model.js';
import ProductionOrder from '../models/production/productionOrder.model.js';
import Article from '../models/production/article.model.js';
import MachineOrderAssignment from '../models/production/machineOrderAssignment.model.js';
import YarnCone from '../models/yarnReq/yarnCone.model.js';
import { OrderStatus, YarnIssueStatus, YarnReturnStatus } from '../models/production/enums.js';
import { updateMachineOrderAssignmentById } from '../services/production/machineOrderAssignment.service.js';
import { createProductionLog } from '../utils/loggingHelper.js';

/** @type {import('mongoose').ConnectOptions} */
const MONGO_CONNECT_OPTIONS = { useNewUrlParser: true, useUnifiedTopology: true };

const SYSTEM_USER = 'restore-orphaned-order-article-script';

/**
 * @param {string} name
 * @returns {string|null}
 */
function readArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : null;
}

/**
 * @param {string} rawUrl
 * @returns {string}
 */
function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  if (u.endsWith('>')) u = u.slice(0, -1);
  return u;
}

/**
 * Resolve Mongo connection string: CLI wins, then app config.
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cli = readArg('mongo-url');
  if (cli) {
    const v = sanitizeMongoUrl(cli);
    if (v) return { url: v, source: '--mongo-url' };
  }
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || process.env.MONGODB_URL || ''));
  if (cfg) return { url: cfg, source: 'MONGODB_URL / config.mongoose.url' };
  throw new Error('MongoDB URL missing. Set MONGODB_URL or pass --mongo-url=');
}

/**
 * @param {number|string} machineNo
 * @returns {string}
 */
function formatMachineCode(machineNo) {
  const n = String(machineNo).trim();
  if (/^K\d+$/i.test(n)) return n.toUpperCase();
  const num = parseInt(n, 10);
  if (Number.isNaN(num)) return n;
  return `K${String(num).padStart(3, '0')}`;
}

/**
 * @param {import('mongoose').Types.ObjectId} orderId
 * @param {import('mongoose').Types.ObjectId} articleId
 * @returns {Promise<number>}
 */
async function countIssuedCones(orderId, articleId) {
  return YarnCone.countDocuments({ orderId, articleId, issueStatus: 'issued' });
}

/**
 * Infer MOA queue statuses from article floor progress and issued cone count.
 * @param {Record<string, unknown>} articleLean
 * @param {number} issuedConeCount
 * @returns {{ status: string, yarnIssueStatus: string, yarnReturnStatus: string }}
 */
function inferMoaStatuses(articleLean, issuedConeCount) {
  const knit = articleLean.floorQuantities?.knitting || {};
  const remaining = Number(knit.remaining ?? 0);
  const completed = Number(knit.completed ?? 0);
  const hasIssuedCones = issuedConeCount > 0;

  let status = OrderStatus.PENDING;
  if (String(articleLean.status) === OrderStatus.IN_PROGRESS || remaining > 0) {
    status = OrderStatus.IN_PROGRESS;
  } else if (
    String(articleLean.status) === OrderStatus.COMPLETED ||
    (remaining === 0 && completed > 0)
  ) {
    status = OrderStatus.COMPLETED;
  }

  let yarnIssueStatus = YarnIssueStatus.PENDING;
  if (hasIssuedCones) {
    yarnIssueStatus = YarnIssueStatus.COMPLETED;
  } else if (status === OrderStatus.IN_PROGRESS) {
    yarnIssueStatus = YarnIssueStatus.IN_PROGRESS;
  }

  let yarnReturnStatus = YarnReturnStatus.PENDING;
  if (status === OrderStatus.COMPLETED && hasIssuedCones) {
    yarnReturnStatus = YarnReturnStatus.IN_PROGRESS;
  }

  return { status, yarnIssueStatus, yarnReturnStatus };
}

/**
 * @param {unknown} id
 * @returns {boolean}
 */
function isOnOrderArticles(orderArticles, id) {
  return (orderArticles || []).some((a) => String(a?._id ?? a) === String(id));
}

/**
 * Build a human-readable diagnosis before/after restore.
 * @param {object} params
 * @returns {Promise<Record<string, unknown>>}
 */
async function diagnose({ order, article, machine, assignment }) {
  const issuedCones = await countIssuedCones(order._id, article._id);
  const moaItem = (assignment?.productionOrderItems || []).find(
    (i) =>
      String(i.productionOrder) === String(order._id) && String(i.article) === String(article._id)
  );
  const knit = article.floorQuantities?.knitting || {};
  const inferred = inferMoaStatuses(article, issuedCones);

  return {
    orderNumber: order.orderNumber,
    orderId: String(order._id),
    articleNumber: article.articleNumber,
    articleId: String(article._id),
    articleDocId: article.id,
    articleStatus: article.status,
    onOrderArticles: isOnOrderArticles(order.articles, article._id),
    machineCode: machine.machineCode,
    machineId: String(machine._id),
    knitting: {
      received: knit.received,
      completed: knit.completed,
      remaining: knit.remaining,
      transferred: knit.transferred,
    },
    issuedCones,
    moa: moaItem
      ? {
          itemId: String(moaItem._id),
          status: moaItem.status,
          yarnIssueStatus: moaItem.yarnIssueStatus,
          yarnReturnStatus: moaItem.yarnReturnStatus,
          priority: moaItem.priority,
        }
      : null,
    inferredMoaStatuses: inferred,
    needsOrderRelink: !isOnOrderArticles(order.articles, article._id),
    needsMoaRestore: !moaItem,
    needsMoaStatusRepair: moaItem
      ? String(moaItem.status) !== inferred.status ||
        String(moaItem.yarnIssueStatus) !== inferred.yarnIssueStatus ||
        String(moaItem.yarnReturnStatus) !== inferred.yarnReturnStatus
      : false,
  };
}

/**
 * Re-link article to order and restore/repair MOA queue row.
 * @param {{ orderNumber: string, articleNumber: string, machineCode: string|null, dryRun: boolean }} params
 * @returns {Promise<Record<string, unknown>>}
 */
async function restoreOrphanedArticle({ orderNumber, articleNumber, machineCode, dryRun }) {
  const order = await ProductionOrder.findOne({ orderNumber }).lean();
  if (!order) {
    return { ok: false, error: 'ORDER_NOT_FOUND', orderNumber, articleNumber };
  }

  const article = await Article.findOne({ orderId: order._id, articleNumber }).lean();
  if (!article) {
    return {
      ok: false,
      error: 'ARTICLE_NOT_FOUND',
      orderNumber,
      articleNumber,
      hint: 'Article doc must still exist with matching orderId (orphan case).',
    };
  }

  let resolvedMachineCode = machineCode;
  if (!resolvedMachineCode && article.machineId) {
    const m = await Machine.findById(article.machineId).select('machineCode').lean();
    resolvedMachineCode = m?.machineCode || null;
  }
  if (!resolvedMachineCode) {
    return {
      ok: false,
      error: 'MACHINE_REQUIRED',
      orderNumber,
      articleNumber,
      hint: 'Pass --machine=K037 or ensure article.machineId is set.',
    };
  }
  resolvedMachineCode = formatMachineCode(resolvedMachineCode);

  const machine = await Machine.findOne({
    $or: [{ machineCode: resolvedMachineCode }, { name: resolvedMachineCode }],
  }).lean();
  if (!machine) {
    return { ok: false, error: 'MACHINE_NOT_FOUND', machineCode: resolvedMachineCode };
  }

  const assignment = await MachineOrderAssignment.findOne({ machine: machine._id }).lean();
  if (!assignment) {
    return { ok: false, error: 'NO_ASSIGNMENT_FOR_MACHINE', machineCode: resolvedMachineCode };
  }

  const before = await diagnose({ order, article, machine, assignment });
  const inferred = before.inferredMoaStatuses;

  if (!before.needsOrderRelink && !before.needsMoaRestore && !before.needsMoaStatusRepair) {
    return {
      ok: true,
      action: 'skipped_already_ok',
      dryRun,
      before,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      action: 'would_restore',
      dryRun: true,
      before,
      plannedChanges: {
        relinkOrderArticles: before.needsOrderRelink,
        syncArticleMachineId: String(article.machineId || '') !== String(machine._id),
        moaAction: before.needsMoaRestore ? 'addProductionOrderItems' : 'repairStatuses',
        moaStatuses: inferred,
      },
    };
  }

  const changes = [];

  if (before.needsOrderRelink) {
    await ProductionOrder.updateOne(
      { _id: order._id },
      { $addToSet: { articles: article._id } }
    );
    changes.push('order.articles relinked');
  }

  if (String(article.machineId || '') !== String(machine._id)) {
    await Article.updateOne({ _id: article._id }, { $set: { machineId: machine._id } });
    changes.push('article.machineId synced');
  }

  const freshAssignment = await MachineOrderAssignment.findById(assignment._id);
  const existingItem = (freshAssignment?.productionOrderItems || []).find(
    (i) =>
      String(i.productionOrder) === String(order._id) && String(i.article) === String(article._id)
  );

  let updatedAssignment;
  if (!existingItem) {
    updatedAssignment = await updateMachineOrderAssignmentById(
      assignment._id,
      {
        addProductionOrderItems: [
          {
            productionOrder: order._id,
            article: article._id,
            status: inferred.status,
            yarnIssueStatus: inferred.yarnIssueStatus,
            yarnReturnStatus: inferred.yarnReturnStatus,
            priority: 1,
          },
        ],
        remarks: `Restore orphaned ${articleNumber} on ${orderNumber} to ${resolvedMachineCode} queue`,
      },
      undefined
    );
    changes.push('moa queue row added');
  } else {
    const needsRepair =
      String(existingItem.status) !== inferred.status ||
      String(existingItem.yarnIssueStatus) !== inferred.yarnIssueStatus ||
      String(existingItem.yarnReturnStatus) !== inferred.yarnReturnStatus;

    if (needsRepair) {
      const mergedItems = (freshAssignment.productionOrderItems || []).map((item) => {
        if (String(item.productionOrder) !== String(order._id) || String(item.article) !== String(article._id)) {
          return {
            productionOrder: item.productionOrder,
            article: item.article,
            status: item.status,
            yarnIssueStatus: item.yarnIssueStatus,
            yarnReturnStatus: item.yarnReturnStatus,
            priority: item.priority,
          };
        }
        return {
          productionOrder: item.productionOrder,
          article: item.article,
          status: inferred.status,
          yarnIssueStatus: inferred.yarnIssueStatus,
          yarnReturnStatus: inferred.yarnReturnStatus,
          priority: item.priority ?? 1,
        };
      });

      updatedAssignment = await updateMachineOrderAssignmentById(
        assignment._id,
        {
          productionOrderItems: mergedItems,
          remarks: `Repair MOA statuses for restored ${articleNumber} on ${orderNumber}`,
        },
        undefined
      );
      changes.push('moa queue statuses repaired');
    } else {
      updatedAssignment = freshAssignment;
      changes.push('moa queue row already present');
    }
  }

  try {
    await createProductionLog({
      action: 'Order Updated',
      orderId: String(order._id),
      articleId: article.id,
      quantity: 0,
      remarks: `Script restored orphaned article ${articleNumber} on ${orderNumber} (${changes.join('; ')})`,
      changeReason: 'restore-orphaned-order-article',
      userId: SYSTEM_USER,
      floorSupervisorId: SYSTEM_USER,
      previousValue: JSON.stringify({ onOrder: before.onOrderArticles, moa: before.moa }),
      newValue: JSON.stringify({ onOrder: true, moaStatuses: inferred }),
    });
  } catch (logErr) {
    changes.push(`audit log skipped: ${logErr?.message || logErr}`);
  }

  const orderAfter = await ProductionOrder.findById(order._id).lean();
  const assignmentAfter = await MachineOrderAssignment.findById(assignment._id).lean();
  const after = await diagnose({
    order: orderAfter,
    article,
    machine,
    assignment: assignmentAfter,
  });

  const moaRow = (updatedAssignment?.productionOrderItems || []).find(
    (i) =>
      String(i.productionOrder?._id ?? i.productionOrder) === String(order._id) &&
      String(i.article?._id ?? i.article) === String(article._id)
  );

  return {
    ok: true,
    action: 'restored',
    dryRun: false,
    orderNumber,
    articleNumber,
    machineCode: resolvedMachineCode,
    changes,
    before,
    after,
    moaItemId: moaRow?._id ? String(moaRow._id) : after.moa?.itemId || null,
  };
}

/**
 * CLI entry.
 */
async function main() {
  const orderNumber = readArg('order') || 'ORD-000075';
  const articleNumber = readArg('article') || 'A254';
  const machineCode = readArg('machine') ? formatMachineCode(readArg('machine')) : null;
  const dryRun = !process.argv.includes('--write');
  const jsonOnly = process.argv.includes('--json');

  const { url: mongoUrl, source } = resolveMongoConnectionString();
  if (!jsonOnly) {
    console.error(JSON.stringify({ msg: 'Connecting to MongoDB', source, dryRun }));
  }

  await mongoose.connect(mongoUrl, MONGO_CONNECT_OPTIONS);

  const result = await restoreOrphanedArticle({
    orderNumber,
    articleNumber,
    machineCode,
    dryRun,
  });

  if (jsonOnly) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(JSON.stringify(result, null, 2));
    if (dryRun && result.action === 'would_restore') {
      console.error('\nDry-run only. Re-run with --write to apply changes.');
    }
  }

  await mongoose.disconnect();
  process.exit(result.ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err?.stack || err?.message || String(err));
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
