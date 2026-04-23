#!/usr/bin/env node

/**
 * Audit long-term vs short-term yarn for one or more boxes, keyed by box barcode,
 * cone barcode, or boxId (read-only).
 *
 * Long-term (LT): YarnBox with storageLocation matching LT rack pattern (LT-* or B7-02..B7-05-*).
 * Short-term (ST): YarnCone rows with non-empty coneStorageId, not issued, coneWeight > 0
 * (matches getShortTermConesByBoxId semantics).
 *
 * Flags the "double count" case: box still shows weight in LT while cones already sit in ST.
 *
 * Usage:
 *   node src/scripts/check-yarn-lt-st-by-barcode.js --barcode=69a03a657317942502214fc3
 *   node src/scripts/check-yarn-lt-st-by-barcode.js --barcode=69a03a657317942502214fc3,69a03a657317942502214fc5
 *   node src/scripts/check-yarn-lt-st-by-barcode.js --box-id=BOX-PO-2026-1009-2554104464-1772108389331-3
 *   node src/scripts/check-yarn-lt-st-by-barcode.js --json-only --barcode=...
 *
 * MongoDB URL: same as the app — `config.mongoose.url` comes from `MONGODB_URL` in `.env`
 * (see `src/config/config.js`). Override: `--mongo-url=mongodb+srv://...`
 * If you see "URI malformed", the userinfo part usually has reserved chars (@ : / ? # % space)
 * that must be percent-encoded in `.env`, or use this script's retry (auto-encode credentials).
 */

// Node 25+ made url.parse() throw on comma-separated hosts (mongodb multi-host URIs).
// The mongodb driver 3.x uses url.parse() as a pre-check before its own regex parser,
// so we patch it to return a best-effort result instead of throwing.
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
import { YarnBox, YarnCone } from '../models/index.js';
import { LT_SECTION_CODES } from '../models/storageManagement/storageSlot.model.js';

/** @type {RegExp} */
const LT_STORAGE_PATTERN = new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i');

const JSON_ONLY = process.argv.includes('--json-only');

/**
 * @typedef {{ key: string, boxId: string, source: 'box_barcode'|'cone_barcode'|'box_id', error?: string }} ResolveInput
 */

/**
 * Normalize Mongo URL (quotes, BOM, stray CR, Atlas paste typo).
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
 * Resolve connection string: CLI wins, then app config (includes `-test` db suffix when NODE_ENV=test), then raw env.
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
    return { url: cfg, source: 'config.mongoose.url (MONGODB_URL from .env, plus -test suffix when NODE_ENV=test)' };
  }
  const envOnly = sanitizeMongoUrl(String(process.env.MONGODB_URL || ''));
  return { url: envOnly, source: 'process.env.MONGODB_URL' };
}

/** Same subset as `src/index.js` — required so mongodb+srv parses with the new URL parser. */
const MONGO_CONNECT_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

/**
 * Connect to MongoDB (aligned with app `index.js` options).
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
 * @param {string} argPrefix e.g. '--barcode='
 * @returns {string[]}
 */
function parseListArg(argPrefix) {
  const raw = process.argv.find((a) => a.startsWith(argPrefix));
  if (!raw) return [];
  const v = raw.slice(argPrefix.length).trim();
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Find YarnBox by exact or case-insensitive barcode.
 * @param {string} barcode
 * @returns {Promise<import('mongoose').LeanDocument<any>|null>}
 */
async function findBoxByBarcode(barcode) {
  const b = String(barcode || '').trim();
  if (!b) return null;
  let box = await YarnBox.findOne({ barcode: b }).lean();
  if (box) return box;
  const esc = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return YarnBox.findOne({ barcode: new RegExp(`^${esc}$`, 'i') }).lean();
}

/**
 * Resolve boxId from a cone barcode.
 * @param {string} barcode
 * @returns {Promise<string|null>}
 */
async function findBoxIdFromConeBarcode(barcode) {
  const b = String(barcode || '').trim();
  if (!b) return null;
  let cone = await YarnCone.findOne({ barcode: b }).select('boxId').lean();
  if (!cone) {
    const esc = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cone = await YarnCone.findOne({ barcode: new RegExp(`^${esc}$`, 'i') }).select('boxId').lean();
  }
  const id = cone?.boxId != null ? String(cone.boxId).trim() : '';
  return id || null;
}

/**
 * @param {string} key
 * @returns {Promise<ResolveInput>}
 */
async function resolveOneKey(key) {
  const k = String(key || '').trim();
  if (!k) {
    return { key: k, boxId: '', source: 'box_barcode', error: 'empty key' };
  }
  const byBox = await YarnBox.findOne({ boxId: k }).select('boxId').lean();
  if (byBox?.boxId) {
    return { key: k, boxId: String(byBox.boxId), source: 'box_id' };
  }
  const boxFromBarcode = await findBoxByBarcode(k);
  if (boxFromBarcode?.boxId) {
    return { key: k, boxId: String(boxFromBarcode.boxId), source: 'box_barcode' };
  }
  const fromCone = await findBoxIdFromConeBarcode(k);
  if (fromCone) {
    return { key: k, boxId: fromCone, source: 'cone_barcode' };
  }
  return { key: k, boxId: '', source: 'box_barcode', error: 'no YarnBox or YarnCone found for this barcode/boxId' };
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
 * True when cone counts as physically in short-term (inventory sync path).
 * @param {Record<string, unknown>} c
 * @returns {boolean}
 */
function isActiveShortTermCone(c) {
  const storage = c.coneStorageId != null && String(c.coneStorageId).trim() !== '';
  const notIssued = c.issueStatus !== 'issued';
  const w = num(c.coneWeight);
  return storage && notIssued && w > 0;
}

/**
 * Build audit row for one box document + its cones.
 * @param {import('mongoose').LeanDocument<any>} box
 * @param {import('mongoose').LeanDocument<any>[]} cones
 * @returns {Record<string, unknown>}
 */
function buildReport(box, cones) {
  const storageLocation = box.storageLocation != null ? String(box.storageLocation) : '';
  const isLtSlot = Boolean(storageLocation && LT_STORAGE_PATTERN.test(storageLocation));
  const boxWeight = num(box.boxWeight);
  const stored = box.storedStatus === true;
  const remainingInLongTerm = isLtSlot && stored && boxWeight > 0;

  const stCones = cones.filter((c) => isActiveShortTermCone(c));
  const stWeight = stCones.reduce((s, c) => s + num(c.coneWeight), 0);
  const stNet = stCones.reduce((s, c) => s + Math.max(0, num(c.coneWeight) - num(c.tearWeight)), 0);

  const issuedCones = cones.filter((c) => c.issueStatus === 'issued');
  const issuedWeight = issuedCones.reduce((s, c) => s + num(c.issueWeight || c.coneWeight), 0);

  const transferredToShortTerm = stCones.length > 0;
  const doubleCountRisk = remainingInLongTerm && transferredToShortTerm;

  return {
    boxId: box.boxId,
    boxBarcode: box.barcode,
    poNumber: box.poNumber,
    yarnName: box.yarnName,
    lotNumber: box.lotNumber,
    shadeCode: box.shadeCode,
    numberOfConesOnBox: box.numberOfCones,
    qcStatus: box.qcData?.status,
    storageLocation,
    isLongTermSlotPattern: isLtSlot,
    storedStatus: stored,
    boxWeightKg: Math.round(boxWeight * 1000) / 1000,
    initialBoxWeightKg: box.initialBoxWeight != null ? Math.round(num(box.initialBoxWeight) * 1000) / 1000 : null,
    flags: {
      remainingInLongTermUiSense: remainingInLongTerm,
      hasActiveShortTermCones: transferredToShortTerm,
      /** Same symptom as client: LT report shows stock, yarn already staged/held in ST */
      doubleCountRisk,
    },
    longTerm: {
      /** Weight still attributed to the closed box in LT (YarnBox.boxWeight) */
      reportedBoxWeightKg: Math.round(boxWeight * 1000) / 1000,
    },
    shortTerm: {
      activeConeCount: stCones.length,
      activeConeGrossWeightKg: Math.round(stWeight * 1000) / 1000,
      activeConeNetWeightKg: Math.round(stNet * 1000) / 1000,
      cones: stCones.map((c) => ({
        barcode: c.barcode,
        coneStorageId: c.coneStorageId,
        coneWeightKg: num(c.coneWeight),
        tearWeightKg: num(c.tearWeight),
      })),
    },
    issued: {
      coneCount: issuedCones.length,
      weightKg: Math.round(issuedWeight * 1000) / 1000,
    },
    allConesSummary: {
      totalConeDocuments: cones.length,
      byIssueStatus: cones.reduce((acc, c) => {
        const st = String(c.issueStatus || 'unknown');
        acc[st] = (acc[st] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

/**
 * @param {string} boxId
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function analyzeBoxId(boxId) {
  const id = String(boxId || '').trim();
  if (!id) return null;
  const box = await YarnBox.findOne({ boxId: id }).lean();
  if (!box) {
    return { boxId: id, error: 'YarnBox not found' };
  }
  const cones = await YarnCone.find({ boxId: id }).sort({ createdAt: 1 }).lean();
  return buildReport(box, cones);
}

/**
 * @param {string} line
 */
function logLine(line) {
  if (!JSON_ONLY) {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

async function main() {
  const barcodes = parseListArg('--barcode=');
  const boxIdsArg = parseListArg('--box-id=');
  const keys = [...new Set([...barcodes, ...boxIdsArg])];

  if (keys.length === 0) {
    // eslint-disable-next-line no-console
    console.error(
      'Usage: node src/scripts/check-yarn-lt-st-by-barcode.js --barcode=<boxOrConeBarcode>[,...] [--json-only]\n' +
        '    or: node src/scripts/check-yarn-lt-st-by-barcode.js --box-id=<BOX-ID>[,...] [--json-only]'
    );
    process.exit(1);
  }

  await connectMongo();

  const resolutions = [];
  for (const key of keys) {
    resolutions.push(await resolveOneKey(key));
  }

  const uniqueBoxIds = [...new Set(resolutions.filter((r) => r.boxId).map((r) => r.boxId))];
  const reports = [];
  for (const boxId of uniqueBoxIds) {
    reports.push(await analyzeBoxId(boxId));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    inputs: keys,
    resolutions,
    reports,
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload, null, 2));

  if (!JSON_ONLY) {
    logLine('\n--- Summary ---');
    for (const r of resolutions) {
      if (r.error) {
        logLine(`[${r.key}] ERROR: ${r.error}`);
        continue;
      }
      const rep = reports.find((x) => x && x.boxId === r.boxId);
      if (!rep || rep.error) {
        logLine(`[${r.key}] -> ${r.boxId} (${r.source}) — ${rep?.error || 'no report'}`);
        continue;
      }
      const f = rep.flags;
      logLine(
        `[${r.key}] -> ${r.boxId} (${r.source}) | LT box kg: ${rep.longTerm.reportedBoxWeightKg} @ ${rep.storageLocation || '-'} | ST active cones: ${rep.shortTerm.activeConeCount} (${rep.shortTerm.activeConeGrossWeightKg} kg) | issued cones: ${rep.issued.coneCount}`
      );
      if (f.doubleCountRisk) {
        logLine(`  *** doubleCountRisk: LT still shows box weight while ${rep.shortTerm.activeConeCount} cone(s) in short-term ***`);
      }
    }
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
