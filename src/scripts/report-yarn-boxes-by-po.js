#!/usr/bin/env node

/**
 * List every YarnBox for a PO (no GET /yarn-boxes filter): active, inactive, and hidden from that API.
 *
 * - `storedStatus`: physical “stored” flag on the box document.
 * - `listVisibility`: mirrors `ACTIVE_BOX_FILTER` in `yarnBox.service.js` — `visible_on_get_boxes_api` if the
 *   row would be returned by `GET /v1/yarn-management/yarn-boxes?po_number=...`; otherwise `hidden_from_get_boxes_api`
 *   (typically `coneData.conesIssued === true` and `boxWeight` not &gt; 0).
 *
 * Usage (from AddOn_backend):
 *   node src/scripts/report-yarn-boxes-by-po.js --po=PO-2026-1174
 *   node src/scripts/report-yarn-boxes-by-po.js PO-2026-1174
 *   node src/scripts/report-yarn-boxes-by-po.js --po=PO-2026-1174 --json-only
 */

// Node 25+ made url.parse() throw on comma-separated hosts; mongodb 3.x driver still calls url.parse.
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
import logger from '../config/logger.js';
import { YarnBox } from '../models/index.js';

const JSON_ONLY = process.argv.includes('--json-only');

/**
 * @param {string} rawUrl
 * @returns {string}
 */
function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  if (u.endsWith('>')) {
    u = u.slice(0, -1);
  }
  return u;
}

/**
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cliArg = process.argv.find((a) => a.startsWith('--mongo-url='));
  if (cliArg) {
    const v = sanitizeMongoUrl(cliArg.slice('--mongo-url='.length));
    if (v) return { url: v, source: '--mongo-url' };
  }
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) {
    return { url: cfg, source: 'config.mongoose.url' };
  }
  const envOnly = sanitizeMongoUrl(String(process.env.MONGODB_URL || ''));
  return { url: envOnly, source: 'process.env.MONGODB_URL' };
}

const MONGO_CONNECT_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

/**
 * @returns {Promise<void>}
 */
async function connectMongo() {
  logger.info('Connecting to MongoDB...');
  const { url: sanitizedUrl, source } = resolveMongoConnectionString();
  if (!sanitizedUrl) {
    throw new Error('MongoDB URL is empty. Set MONGODB_URL in .env or pass --mongo-url=');
  }
  const redactedUrl = sanitizedUrl.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`MongoDB URL (${source}): ${redactedUrl}`);
  await mongoose.connect(sanitizedUrl, MONGO_CONNECT_OPTIONS);
}

/**
 * Matches `ACTIVE_BOX_FILTER` in `yarnBox.service.js` — whether GET /yarn-boxes would include this box.
 * @param {Record<string, unknown>} box
 * @returns {boolean}
 */
function isVisibleOnGetYarnBoxesApi(box) {
  const conesIssuedTrue = box?.coneData?.conesIssued === true;
  const hasPositiveWeight = Number(box?.boxWeight ?? 0) > 0;
  return !conesIssuedTrue || hasPositiveWeight;
}

/**
 * @param {unknown} v
 * @returns {number}
 */
function num(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {import('mongoose').LeanDocument<any>} box
 * @returns {Record<string, unknown>}
 */
function summarizeBox(box) {
  const visible = isVisibleOnGetYarnBoxesApi(box);
  return {
    boxId: box.boxId,
    barcode: box.barcode,
    poNumber: box.poNumber,
    yarnName: box.yarnName,
    lotNumber: box.lotNumber,
    shadeCode: box.shadeCode,
    boxWeightKg: num(box.boxWeight),
    numberOfCones: box.numberOfCones,
    tearweightKg: num(box.tearweight),
    storedStatus: box.storedStatus === true,
    storageLocation: box.storageLocation || null,
    qcStatus: box.qcData?.status ?? null,
    conesIssuedFlag: box.coneData?.conesIssued === true,
    coneIssueDate: box.coneData?.coneIssueDate || null,
    initialBoxWeightKg: box.initialBoxWeight != null ? num(box.initialBoxWeight) : null,
    receivedDate: box.receivedDate || null,
    listVisibility: visible ? 'visible_on_get_boxes_api' : 'hidden_from_get_boxes_api',
  };
}

/**
 * @returns {string}
 */
function resolvePoNumber() {
  const arg = process.argv.find((a) => a.startsWith('--po='));
  if (arg) {
    return String(arg.slice('--po='.length)).trim();
  }
  const rest = process.argv
    .slice(2)
    .filter((a) => a !== '--json-only' && !a.startsWith('--mongo-url='));
  const pos = rest.find((x) => !String(x).startsWith('-'));
  return pos ? String(pos).trim() : '';
}

async function main() {
  const poNumber = resolvePoNumber();
  if (!poNumber) {
    console.error('Usage: node src/scripts/report-yarn-boxes-by-po.js --po=PO-2026-1174 [--json-only]');
    process.exit(1);
  }

  await connectMongo();

  const boxes = await YarnBox.find({ poNumber })
    .sort({ createdAt: 1 })
    .lean();

  const rows = boxes.map((b) => summarizeBox(b));
  const totalWeightKg = rows.reduce((s, r) => s + num(r.boxWeightKg), 0);

  let visibleCount = 0;
  let hiddenCount = 0;
  let storedTrue = 0;
  let storedFalse = 0;
  for (const r of rows) {
    if (r.listVisibility === 'visible_on_get_boxes_api') visibleCount += 1;
    else hiddenCount += 1;
    if (r.storedStatus) storedTrue += 1;
    else storedFalse += 1;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    poNumber,
    summary: {
      totalBoxes: rows.length,
      totalBoxWeightKg: Math.round(totalWeightKg * 1000) / 1000,
      byListVisibility: {
        visible_on_get_boxes_api: visibleCount,
        hidden_from_get_boxes_api: hiddenCount,
      },
      byStoredStatus: {
        stored_true: storedTrue,
        stored_false: storedFalse,
      },
    },
    boxes: rows,
  };

  console.log(JSON.stringify(payload, null, 2));

  if (!JSON_ONLY) {
    const s = payload.summary;
    logger.info(
      `${poNumber}: ${s.totalBoxes} box(es), total boxWeight=${s.totalBoxWeightKg} kg | ` +
        `GET /yarn-boxes visible=${s.byListVisibility.visible_on_get_boxes_api}, hidden=${s.byListVisibility.hidden_from_get_boxes_api} | ` +
        `storedStatus true=${s.byStoredStatus.stored_true}, false=${s.byStoredStatus.stored_false}`
    );
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
