#!/usr/bin/env node
/**
 * Re-add a (production order, article) row to a machine assignment queue after erroneous removal.
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/restore-moa-queue-item.js \
 *     --machine=K003 --order=ORD-000048 --article=A6151
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
import { OrderStatus, YarnIssueStatus, YarnReturnStatus } from '../models/production/enums.js';
import { updateMachineOrderAssignmentById } from '../services/production/machineOrderAssignment.service.js';

const MONGO_CONNECT_OPTIONS = { useNewUrlParser: true, useUnifiedTopology: true };

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
  let u = String(rawUrl || '').trim();
  if (u.endsWith('>')) u = u.slice(0, -1);
  return u;
}

const machineCode = readArg('machine') || 'K003';
const orderNumber = readArg('order') || 'ORD-000048';
const articleNumber = readArg('article') || 'A6151';

await mongoose.connect(sanitizeMongoUrl(config.mongoose.url), MONGO_CONNECT_OPTIONS);

const order = await ProductionOrder.findOne({ orderNumber }).lean();
if (!order) throw new Error(`Order not found: ${orderNumber}`);

const article = await Article.findOne({ orderId: order._id, articleNumber }).lean();
if (!article) throw new Error(`Article not found: ${articleNumber} on ${orderNumber}`);

const machine = await Machine.findOne({
  $or: [{ machineCode }, { name: machineCode }],
}).lean();
if (!machine) throw new Error(`Machine not found: ${machineCode}`);

const assignment = await MachineOrderAssignment.findOne({ machine: machine._id });
if (!assignment) throw new Error(`No assignment for machine ${machineCode}`);

const already = (assignment.productionOrderItems || []).some(
  (i) =>
    String(i.productionOrder) === String(order._id) && String(i.article) === String(article._id)
);
if (already) {
  console.log(JSON.stringify({ ok: true, message: 'Item already on queue', assignmentId: assignment._id }));
  await mongoose.disconnect();
  process.exit(0);
}

const updated = await updateMachineOrderAssignmentById(
  assignment._id,
  {
    addProductionOrderItems: [
      {
        productionOrder: order._id,
        article: article._id,
        status: OrderStatus.COMPLETED,
        yarnIssueStatus: YarnIssueStatus.COMPLETED,
        yarnReturnStatus: YarnReturnStatus.IN_PROGRESS,
        priority: 10,
      },
    ],
    remarks: `Restore ${articleNumber} on ${orderNumber} to ${machineCode} queue (yarn return pending; cones still issued)`,
  },
  undefined
);

const row = (updated.productionOrderItems || []).find(
  (i) =>
    String(i.productionOrder?._id ?? i.productionOrder) === String(order._id) &&
    String(i.article?._id ?? i.article) === String(article._id)
);

console.log(
  JSON.stringify(
    {
      ok: true,
      assignmentId: String(updated._id),
      machine: machineCode,
      orderNumber,
      articleNumber,
      itemId: row?._id ? String(row._id) : null,
      status: row?.status,
      yarnIssueStatus: row?.yarnIssueStatus,
      yarnReturnStatus: row?.yarnReturnStatus,
      queueLength: updated.productionOrderItems?.length ?? 0,
    },
    null,
    2
  )
);

await mongoose.disconnect();
