#!/usr/bin/env node

/**
 * List (or export CSV) all yarn cones currently issued to a production order + article.
 *
 * Data source: YarnCone with issueStatus === 'issued', matching ProductionOrder._id
 * and Article._id (article must belong to that order).
 *
 * Usage:
 *   cross-env NODE_ENV=development node src/scripts/list-issued-cones-by-order-article.js ORD-000053 A5632
 *   cross-env NODE_ENV=development node src/scripts/list-issued-cones-by-order-article.js ORD-000053 A5632 --json
 *   cross-env NODE_ENV=development node src/scripts/list-issued-cones-by-order-article.js ORD-000053 A5632 --csv=./issued-cones-ORD-000053-A5632.csv
 */

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import config from '../config/config.js';
import { ProductionOrder, Article } from '../models/production/index.js';
import YarnCone from '../models/yarnReq/yarnCone.model.js';

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
const csvPath = readArg('csv');

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
 * @param {Date|string|number|null|undefined} d
 * @returns {string}
 */
function isoOrEmpty(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString();
}

async function main() {
  const orderNumber = (args[0] || '').trim();
  const articleNumber = (args[1] || '').trim();

  if (!orderNumber || !articleNumber) {
    console.error(
      'Usage: node src/scripts/list-issued-cones-by-order-article.js <orderNumber> <articleNumber> [--json] [--csv=path]'
    );
    console.error('Example: node src/scripts/list-issued-cones-by-order-article.js ORD-000053 A5632');
    process.exit(1);
  }

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
    .select('_id id articleNumber orderId')
    .lean();

  if (!articles.length) {
    console.error(
      `No Article on order ${orderNumber} with articleNumber matching "${articleNumber}" (case-insensitive).`
    );
    process.exit(1);
  }

  const articleIds = articles.map((a) => a._id);

  const cones = await YarnCone.find({
    orderId: order._id,
    articleId: { $in: articleIds },
    issueStatus: 'issued',
    returnedToVendorAt: null,
  })
    .sort({ issueDate: -1, barcode: 1 })
    .lean();

  const summary = {
    orderNumber,
    articleNumber,
    productionOrderId: String(order._id),
    matchedArticles: articles.map((a) => ({
      _id: String(a._id),
      id: a.id,
      articleNumber: a.articleNumber,
    })),
    issuedConeCount: cones.length,
    cones: cones.map((c) => ({
      _id: String(c._id),
      barcode: c.barcode,
      boxId: c.boxId,
      poNumber: c.poNumber,
      yarnName: c.yarnName,
      yarnCatalogId: c.yarnCatalogId ? String(c.yarnCatalogId) : '',
      shadeCode: c.shadeCode ?? '',
      coneWeight: c.coneWeight,
      tearWeight: c.tearWeight,
      issueDate: c.issueDate ? new Date(c.issueDate).toISOString() : '',
      issueWeight: c.issueWeight,
      issuedByUsername: c.issuedBy?.username ?? '',
      coneStorageId: c.coneStorageId ?? '',
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : '',
    })),
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
      'barcode',
      'boxId',
      'poNumber',
      'yarnName',
      'shadeCode',
      'coneWeight',
      'tearWeight',
      'issueWeight',
      'issueDate',
      'issuedByUsername',
      'coneStorageId',
      'coneId',
    ];
    const lines = [headers.join(',')];
    for (const c of cones) {
      const row = [
        csvCell(orderNumber),
        csvCell(articleNumber),
        csvCell(c.barcode),
        csvCell(c.boxId),
        csvCell(c.poNumber),
        csvCell(c.yarnName),
        csvCell(c.shadeCode),
        csvCell(c.coneWeight),
        csvCell(c.tearWeight),
        csvCell(c.issueWeight),
        csvCell(isoOrEmpty(c.issueDate)),
        csvCell(c.issuedBy?.username),
        csvCell(c.coneStorageId),
        csvCell(String(c._id)),
      ];
      lines.push(row.join(','));
    }
    fs.writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
    console.log(`Wrote ${cones.length} rows to ${out}`);
    await mongoose.disconnect();
    return;
  }

  console.log(
    `Order ${orderNumber} / article ${articleNumber}: ${cones.length} cone(s) with issueStatus=issued (returnedToVendorAt null).`
  );
  if (articles.length > 1) {
    console.log(`Matched ${articles.length} article document(s) on this order (same articleNumber pattern).`);
  }
  cones.forEach((c, i) => {
    const when = c.issueDate ? isoOrEmpty(c.issueDate) : '';
    const who = c.issuedBy?.username || '-';
    console.log(
      `${i + 1}.\t${c.barcode || '(no barcode)'}\tbox=${c.boxId}\t${c.yarnName || '-'}\tissue=${when}\tby=${who}`
    );
  });

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
