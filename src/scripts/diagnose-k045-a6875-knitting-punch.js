#!/usr/bin/env node

/**
 * Read-only dump for knitting punch mistake: ORD-000103 / A6875 / machine K045.
 * Punched 800, actual should be 110 (delta 690).
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/diagnose-k045-a6875-knitting-punch.js
 *   NODE_ENV=development node src/scripts/diagnose-k045-a6875-knitting-punch.js ORD-000103 A6875
 *   NODE_ENV=development node src/scripts/diagnose-k045-a6875-knitting-punch.js ORD-000103 A6875 --mongo-url="mongodb://127.0.0.1:27017/addon"
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
import Article from '../models/production/article.model.js';
import ArticleLog from '../models/production/articleLog.model.js';
import ProductionOrder from '../models/production/productionOrder.model.js';
import ContainersMaster from '../models/production/containersMaster.model.js';
import Machine from '../models/machine.model.js';
import MachineOrderAssignment from '../models/production/machineOrderAssignment.model.js';
import YarnTransaction from '../models/yarnReq/yarnTransaction.model.js';

const MONGO_CONNECT_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

const WRONG_QTY = 800;
const CORRECT_QTY = 110;
const DELTA = WRONG_QTY - CORRECT_QTY;

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

/**
 * @param {string} rawUrl
 * @returns {string}
 */
function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  if (u.endsWith('>')) u = u.slice(0, -1);
  return u;
}

/**
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cli = readArg('mongo-url');
  if (cli) {
    const v = sanitizeMongoUrl(cli);
    if (v) return { url: v, source: '--mongo-url' };
  }
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url (MONGODB_URL from .env)' };
  const envOnly = sanitizeMongoUrl(String(process.env.MONGODB_URL || ''));
  return { url: envOnly, source: 'process.env.MONGODB_URL' };
}

/**
 * Compact floor qty snapshot (drops empty receivedData noise except counts).
 * @param {Record<string, unknown>|undefined} fq
 * @returns {Record<string, unknown>}
 */
function compactFloorQuantities(fq) {
  if (!fq || typeof fq !== 'object') return {};
  const out = {};
  for (const [key, val] of Object.entries(fq)) {
    if (!val || typeof val !== 'object') continue;
    const receivedData = Array.isArray(val.receivedData) ? val.receivedData : [];
    const transferredData = Array.isArray(val.transferredData) ? val.transferredData : [];
    out[key] = {
      received: Number(val.received ?? 0),
      completed: Number(val.completed ?? 0),
      remaining: Number(val.remaining ?? 0),
      transferred: Number(val.transferred ?? 0),
      m4Quantity: val.m4Quantity != null ? Number(val.m4Quantity) : undefined,
      weight: val.weight != null ? Number(val.weight) : undefined,
      m1Quantity: val.m1Quantity != null ? Number(val.m1Quantity) : undefined,
      m1Transferred: val.m1Transferred != null ? Number(val.m1Transferred) : undefined,
      receivedDataCount: receivedData.length,
      receivedData: receivedData.map((r) => ({
        qty: r.transferred ?? r.quantity ?? null,
        containerId: r.receivedInContainerId ? String(r.receivedInContainerId) : null,
        status: r.receivedStatusFromPreviousFloor || null,
        ts: r.receivedTimestamp || null,
      })),
      transferredDataCount: transferredData.length,
    };
  }
  return out;
}

/**
 * @param {unknown} v
 * @returns {number}
 */
function n(v) {
  return Number(v ?? 0);
}

async function main() {
  const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const orderNumber = pos[0] || 'ORD-000103';
  const articleNumber = pos[1] || 'A6875';
  const machineCode = readArg('machine') || 'K045';

  const { url: mongoUrl, source } = resolveMongoConnectionString();
  if (!mongoUrl) throw new Error('MongoDB URL is empty.');
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify(
      {
        msg: 'Connecting (READ-ONLY)',
        source,
        url: mongoUrl.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@'),
      },
      null,
      2,
    ),
  );
  await mongoose.connect(mongoUrl, MONGO_CONNECT_OPTIONS);

  const orderRe = new RegExp(`^${escapeRegex(orderNumber)}$`, 'i');
  const artRe = new RegExp(`^${escapeRegex(articleNumber)}$`, 'i');
  const machineRe = new RegExp(`^${escapeRegex(machineCode)}$`, 'i');

  const order = await ProductionOrder.findOne({ orderNumber: orderRe }).lean();
  if (!order) throw new Error(`ProductionOrder not found: ${orderNumber}`);

  const article = await Article.findOne({ orderId: order._id, articleNumber: artRe }).lean();
  if (!article) throw new Error(`Article not found: ${articleNumber} on ${orderNumber}`);

  const orderIdStr = String(order._id);
  const articleOid = article._id;
  const articleIdStr = String(articleOid);

  const logs = await ArticleLog.find({
    $or: [{ orderId: orderIdStr, articleId: articleIdStr }, { articleId: articleIdStr }],
  })
    .sort({ timestamp: 1 })
    .lean();

  const containers = await ContainersMaster.find({
    $or: [{ 'activeItems.article': articleOid }, { 'activeArticle': articleOid }],
  }).lean();

  const machine = await Machine.findOne({
    $or: [{ machineCode: machineRe }, { machineNumber: machineRe }],
  }).lean();

  const assignments = machine
    ? await MachineOrderAssignment.find({
        machine: machine._id,
        'productionOrderItems.article': articleOid,
      }).lean()
    : [];

  const yarnTxns = await YarnTransaction.find({
    $or: [
      { orderId: order._id, articleId: articleOid },
      { orderId: order._id, articleNumber: artRe },
      { orderno: orderRe, articleNumber: artRe },
    ],
  })
    .sort({ transactionDate: 1 })
    .lean();

  const knit = article.floorQuantities?.knitting || {};
  const linking = article.floorQuantities?.linking || {};

  const qtyHits = logs.filter((l) => Number(l.quantity) === WRONG_QTY || Number(l.quantity) === CORRECT_QTY);
  const remarksHits = logs.filter((l) => {
    const r = String(l.remarks || '');
    return r.includes(String(WRONG_QTY)) || r.includes(String(CORRECT_QTY));
  });
  const knitQtyLogs = logs.filter((l) => {
    const floor = String(l.fromFloor || l.toFloor || '');
    const action = String(l.action || '');
    return /knitting/i.test(floor) || /knitting/i.test(action) || /quantity updated/i.test(action);
  });

  const containerHits = containers.filter((c) =>
    (c.activeItems || []).some((it) => n(it.quantity) === WRONG_QTY || n(it.quantity) === CORRECT_QTY),
  );

  const knittingCompleted = n(knit.completed);
  const knittingTransferred = n(knit.transferred);
  const knittingReceived = n(knit.received);
  const linkingReceived = n(linking.received);
  const linkingCompleted = n(linking.completed);
  const linkingTransferred = n(linking.transferred);

  const proposedKnitCompleted = knittingCompleted - DELTA;
  const proposedKnitTransferred = knittingTransferred - DELTA;
  const proposedLinkingReceived = linkingReceived - DELTA;

  const risks = [];
  if (proposedKnitCompleted < 0) risks.push('knitting.completed would go negative');
  if (proposedKnitTransferred < 0) risks.push('knitting.transferred would go negative');
  if (proposedLinkingReceived < 0) risks.push('linking.received would go negative');
  if (proposedLinkingReceived < linkingCompleted) {
    risks.push(
      `linking.received after correction (${proposedLinkingReceived}) < linking.completed (${linkingCompleted}) — linking already consumed part of the extra qty`,
    );
  }
  if (proposedLinkingReceived < linkingTransferred) {
    risks.push(
      `linking.received after correction (${proposedLinkingReceived}) < linking.transferred (${linkingTransferred}) — qty already left linking`,
    );
  }
  const inTransitContainers = containers.filter((c) => n(c.activeItems?.reduce((s, it) => s + n(it.quantity), 0)) > 0);
  const extraStillInContainer = containers.some((c) =>
    (c.activeItems || []).some((it) => String(it.article) === articleIdStr && n(it.quantity) === WRONG_QTY),
  );

  const report = {
    claim: {
      machine: machineCode,
      orderNumber,
      articleNumber,
      wronglyPunched: WRONG_QTY,
      actualShouldBe: CORRECT_QTY,
      extraQty: DELTA,
    },
    ids: {
      orderId: orderIdStr,
      orderNumber: order.orderNumber,
      articleMongoId: articleIdStr,
      articleId: article.id,
      articleNumber: article.articleNumber,
      plannedQuantity: article.plannedQuantity,
      currentFloor: article.currentFloor,
      status: article.status,
      linkingType: article.linkingType,
      machineIdOnArticle: article.machineId ? String(article.machineId) : null,
    },
    floorQuantities: compactFloorQuantities(article.floorQuantities),
    knittingVsLinking: {
      knittingReceived,
      knittingCompleted,
      knittingTransferred,
      knittingRemaining: n(knit.remaining),
      knittingM4: n(knit.m4Quantity),
      knittingWeight: n(knit.weight),
      linkingReceived,
      linkingCompleted,
      linkingRemaining: n(linking.remaining),
      linkingTransferred,
      inTransitKnitToLinking: Math.max(0, knittingTransferred - linkingReceived),
      logQtySum: logs.reduce((s, l) => s + n(l.quantity), 0),
    },
    proposedIfWeSubtractDeltaOnKnittingOnly: {
      extraQty: DELTA,
      knittingCompleted: { from: knittingCompleted, to: proposedKnitCompleted },
      knittingTransferred: { from: knittingTransferred, to: proposedKnitTransferred },
      knittingRemainingAfter: Math.max(0, knittingReceived - proposedKnitCompleted - n(knit.m4Quantity)),
      linkingReceived: { from: linkingReceived, to: proposedLinkingReceived, note: 'ONLY if linking already accepted the 800 container' },
    },
    risks,
    extraStillInContainer,
    inTransitContainerCount: inTransitContainers.length,
    logsMatching800or110: qtyHits.map(slimLog),
    remarksMatching800or110: remarksHits.map(slimLog),
    knittingRelatedLogs: knitQtyLogs.map(slimLog),
    allLogs: logs.map(slimLog),
    machine: machine
      ? {
          _id: String(machine._id),
          machineCode: machine.machineCode,
          machineNumber: machine.machineNumber,
        }
      : null,
    assignments: assignments.map((a) => ({
      _id: String(a._id),
      activeNeedle: a.activeNeedle,
      items: (a.productionOrderItems || [])
        .filter((it) => String(it.article) === articleIdStr)
        .map((it) => ({
          status: it.status,
          yarnIssueStatus: it.yarnIssueStatus,
          yarnReturnStatus: it.yarnReturnStatus,
          priority: it.priority,
        })),
    })),
    containers: containers.map((c) => ({
      _id: String(c._id),
      barcode: c.barcode,
      containerName: c.containerName,
      status: c.status,
      activeFloor: c.activeFloor,
      activeItems: (c.activeItems || []).map((it) => ({
        article: it.article ? String(it.article) : null,
        quantity: n(it.quantity),
        isThisArticle: String(it.article) === articleIdStr,
      })),
      updatedAt: c.updatedAt,
    })),
    containersWith800or110: containerHits.map((c) => String(c._id)),
    yarnTransactions: yarnTxns.map((t) => ({
      _id: String(t._id),
      type: t.transactionType,
      date: t.transactionDate,
      netWeight: t.transactionNetWeight,
      totalWeight: t.transactionTotalWeight,
      coneCount: t.transactionConeCount,
      machineId: t.machineId ? String(t.machineId) : null,
    })),
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

/**
 * @param {import('mongoose').LeanDocument<*>} l
 */
function slimLog(l) {
  return {
    id: l.id,
    ts: l.timestamp,
    action: l.action,
    qty: l.quantity,
    from: l.fromFloor,
    to: l.toFloor,
    remarks: l.remarks,
    machineId: l.machineId || null,
    prev: l.previousValue,
    next: l.newValue,
    userId: l.userId,
  };
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack || err);
  process.exitCode = 1;
});
