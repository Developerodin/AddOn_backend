#!/usr/bin/env node

/**
 * Correct knitting punch K045 / ORD-000103 / A6875: 800 → 110 (extra 690).
 *
 * The 800 never reached Linking — it is still in Container 39 (activeFloor=Linking).
 * Downstream floors (linking/checking/washing/boarding/SC) are NOT touched.
 *
 * Default is DRY RUN. Pass `--write` to persist.
 *
 * Atlas (current .env MONGODB_URL):
 *   NODE_ENV=development node src/scripts/fix-k045-a6875-knit-punch-800-to-110.js
 *   NODE_ENV=development node src/scripts/fix-k045-a6875-knit-punch-800-to-110.js --write
 *
 * Local:
 *   NODE_ENV=development node src/scripts/fix-k045-a6875-knit-punch-800-to-110.js --mongo-url="mongodb://127.0.0.1:27017/addon"
 *   NODE_ENV=development node src/scripts/fix-k045-a6875-knit-punch-800-to-110.js --mongo-url="mongodb://127.0.0.1:27017/addon" --write
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
import { LogAction } from '../models/production/enums.js';

const MONGO_CONNECT_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

const ORDER_NUMBER = 'ORD-000103';
const ARTICLE_NUMBER = 'A6875';
const CONTAINER_ID = '699865138112b2ead70340a4';
const QTY_LOG_ID = 'LOG-1788307349481-yt2aqik22';
const TRANSFER_LOG_ID = 'LOG-1788307349522-ildmnf16x';
const WRONG_QTY = 800;
const CORRECT_QTY = 110;
const DELTA = WRONG_QTY - CORRECT_QTY;
const SYSTEM_USER = 'system';

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
 * @param {unknown} v
 * @returns {number}
 */
function n(v) {
  return Number(v ?? 0);
}

/**
 * @param {unknown} doc
 * @returns {{ received: number, completed: number, remaining: number, transferred: number, m4Quantity: number, weight: number }}
 */
function knitSlice(doc) {
  const k = doc?.floorQuantities?.knitting || {};
  return {
    received: n(k.received),
    completed: n(k.completed),
    remaining: n(k.remaining),
    transferred: n(k.transferred),
    m4Quantity: n(k.m4Quantity),
    weight: n(k.weight),
  };
}

/**
 * Abort unless live docs still match the 800-in-transit punch.
 * @param {{ article: object, container: object, qtyLog: object|null, transferLog: object|null }} docs
 * @returns {string[]}
 */
function collectGuardFailures({ article, container, qtyLog, transferLog }) {
  const failures = [];
  const knit = knitSlice(article);
  const linking = article.floorQuantities?.linking || {};
  const linkingReceivedData = Array.isArray(linking.receivedData) ? linking.receivedData : [];
  const accepted = linkingReceivedData.some((r) => String(r.receivedInContainerId) === CONTAINER_ID);

  if (knit.completed < DELTA) failures.push(`knitting.completed ${knit.completed} < delta ${DELTA}`);
  if (knit.transferred < DELTA) failures.push(`knitting.transferred ${knit.transferred} < delta ${DELTA}`);
  if (accepted) {
    failures.push(`Container ${CONTAINER_ID} already in linking.receivedData — linking accepted it; abort`);
  }

  const row = (container.activeItems || []).find((it) => String(it.article) === String(article._id));
  if (!row) failures.push(`Container ${CONTAINER_ID} has no activeItems row for this article`);
  else if (n(row.quantity) !== WRONG_QTY) {
    failures.push(`Container qty is ${n(row.quantity)}, expected ${WRONG_QTY}`);
  }
  if (String(container.activeFloor || '') !== 'Linking') {
    failures.push(`Container activeFloor is "${container.activeFloor}", expected Linking`);
  }

  if (!qtyLog) failures.push(`Quantity log ${QTY_LOG_ID} not found`);
  else if (n(qtyLog.quantity) !== WRONG_QTY) {
    failures.push(`Quantity log qty is ${n(qtyLog.quantity)}, expected ${WRONG_QTY}`);
  }
  if (!transferLog) failures.push(`Transfer log ${TRANSFER_LOG_ID} not found`);
  else if (n(transferLog.quantity) !== WRONG_QTY) {
    failures.push(`Transfer log qty is ${n(transferLog.quantity)}, expected ${WRONG_QTY}`);
  }

  return failures;
}

async function main() {
  const write = process.argv.includes('--write');
  const { url: mongoUrl, source } = resolveMongoConnectionString();
  if (!mongoUrl) throw new Error('MongoDB URL is empty.');

  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify(
      {
        msg: write ? 'Connecting (WRITE)' : 'Connecting (DRY RUN)',
        source,
        url: mongoUrl.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@'),
      },
      null,
      2,
    ),
  );
  await mongoose.connect(mongoUrl, MONGO_CONNECT_OPTIONS);

  const order = await ProductionOrder.findOne({ orderNumber: ORDER_NUMBER }).lean();
  if (!order) throw new Error(`Order not found: ${ORDER_NUMBER}`);

  const article = await Article.findOne({ orderId: order._id, articleNumber: ARTICLE_NUMBER }).lean();
  if (!article) throw new Error(`Article not found: ${ARTICLE_NUMBER}`);

  const container = await ContainersMaster.findById(CONTAINER_ID).lean();
  if (!container) throw new Error(`Container not found: ${CONTAINER_ID}`);

  const qtyLog = await ArticleLog.findOne({ id: QTY_LOG_ID }).lean();
  const transferLog = await ArticleLog.findOne({ id: TRANSFER_LOG_ID }).lean();

  const failures = collectGuardFailures({ article, container, qtyLog, transferLog });
  if (failures.length) {
    throw new Error(`Safety abort:\n- ${failures.join('\n- ')}`);
  }

  const beforeKnit = knitSlice(article);
  const afterCompleted = beforeKnit.completed - DELTA;
  const afterTransferred = beforeKnit.transferred - DELTA;
  const afterRemaining = Math.max(0, beforeKnit.received - afterCompleted - beforeKnit.m4Quantity);
  const linkingReceived = n(article.floorQuantities?.linking?.received);

  const plan = {
    ok: true,
    dryRun: !write,
    claim: { wronglyPunched: WRONG_QTY, actual: CORRECT_QTY, extra: DELTA },
    doNotTouch: [
      'linking.received/completed/transferred',
      'checking / washing / boarding / secondaryChecking',
      'yarn transactions',
      'machine_order_assignments',
      'knitting.weight (107.368 — not in client request; flag if they weighed the 800 pcs)',
    ],
    article: {
      orderNumber: ORDER_NUMBER,
      articleNumber: ARTICLE_NUMBER,
      articleMongoId: String(article._id),
      knitting: {
        completed: { from: beforeKnit.completed, to: afterCompleted },
        transferred: { from: beforeKnit.transferred, to: afterTransferred },
        remaining: { from: beforeKnit.remaining, to: afterRemaining },
        received: beforeKnit.received,
        weightUnchanged: beforeKnit.weight,
      },
      linkingReceivedUnchanged: linkingReceived,
      inTransitAfter: afterTransferred - linkingReceived,
    },
    container: {
      _id: CONTAINER_ID,
      name: container.containerName,
      barcode: container.barcode,
      activeFloor: container.activeFloor,
      quantity: { from: WRONG_QTY, to: CORRECT_QTY },
    },
    logs: {
      patchQtyLog: { id: QTY_LOG_ID, quantity: { from: WRONG_QTY, to: CORRECT_QTY } },
      patchTransferLog: { id: TRANSFER_LOG_ID, quantity: { from: WRONG_QTY, to: CORRECT_QTY } },
      insertCorrectionLog: true,
    },
  };

  if (!write) {
    plan.hint = 'Re-run with --write to persist. Run diagnose script after to verify.';
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(plan, null, 2));
    await mongoose.disconnect();
    return;
  }

  const articleRes = await Article.updateOne(
    { _id: article._id },
    {
      $set: {
        'floorQuantities.knitting.completed': afterCompleted,
        'floorQuantities.knitting.transferred': afterTransferred,
        'floorQuantities.knitting.remaining': afterRemaining,
      },
    },
  );

  const containerRes = await ContainersMaster.updateOne(
    { _id: container._id, 'activeItems.article': article._id },
    { $set: { 'activeItems.$.quantity': CORRECT_QTY } },
  );

  const qtyLogRes = await ArticleLog.updateOne(
    { id: QTY_LOG_ID },
    {
      $set: {
        quantity: CORRECT_QTY,
        newValue: n(qtyLog.newValue) - DELTA,
        remarks: `Set completed quantity to ${CORRECT_QTY} on Knitting floor (was ${qtyLog.previousValue}) [corrected from ${WRONG_QTY} by script]`,
        changeReason: `Data correction: knitting punch ${WRONG_QTY} → ${CORRECT_QTY} (K045 / ${ORDER_NUMBER} / ${ARTICLE_NUMBER})`,
      },
    },
  );

  const transferLogRes = await ArticleLog.updateOne(
    { id: TRANSFER_LOG_ID },
    {
      $set: {
        quantity: CORRECT_QTY,
        remarks: `Auto-transferred ${CORRECT_QTY} completed units from Knitting to Linking [corrected from ${WRONG_QTY} by script]`,
        changeReason: `Data correction: knitting transfer ${WRONG_QTY} → ${CORRECT_QTY} (Container 39 still in transit)`,
      },
    },
  );

  const correctionLog = await ArticleLog.createLogEntry({
    action: LogAction.QUANTITY_UPDATED,
    quantity: -DELTA,
    fromFloor: 'Knitting',
    toFloor: 'Linking',
    remarks: `Script correction K045/${ORDER_NUMBER}/${ARTICLE_NUMBER}: knitting punch ${WRONG_QTY}→${CORRECT_QTY}. Container 39 qty ${WRONG_QTY}→${CORRECT_QTY}. knitting.completed/transferred -${DELTA}. Linking not accepted yet — downstream floors unchanged.`,
    userId: SYSTEM_USER,
    floorSupervisorId: SYSTEM_USER,
    orderId: String(order._id),
    articleId: String(article._id),
    previousValue: beforeKnit.completed,
    newValue: afterCompleted,
    changeReason: 'Client request: wrongly punched 800, actual 110',
    machineId: article.machineId ? String(article.machineId) : null,
  });

  const afterArticle = await Article.findById(article._id).lean();
  const afterContainer = await ContainersMaster.findById(CONTAINER_ID).lean();
  const afterRow = (afterContainer.activeItems || []).find((it) => String(it.article) === String(article._id));

  plan.dryRun = false;
  plan.writeResult = {
    articleMatched: articleRes?.matchedCount ?? articleRes?.n ?? null,
    articleModified: articleRes?.modifiedCount ?? articleRes?.nModified ?? null,
    containerMatched: containerRes?.matchedCount ?? containerRes?.n ?? null,
    containerModified: containerRes?.modifiedCount ?? containerRes?.nModified ?? null,
    qtyLogModified: qtyLogRes?.modifiedCount ?? qtyLogRes?.nModified ?? null,
    transferLogModified: transferLogRes?.modifiedCount ?? transferLogRes?.nModified ?? null,
    correctionLogId: correctionLog.id,
    knittingAfter: knitSlice(afterArticle),
    containerQtyAfter: afterRow ? n(afterRow.quantity) : null,
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(plan, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack || err);
  process.exitCode = 1;
});
