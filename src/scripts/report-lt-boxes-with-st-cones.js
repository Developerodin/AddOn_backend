#!/usr/bin/env node

/**
 * Report YarnBoxes still on LT racks that also have active cones on ST racks.
 *
 * A row qualifies when:
 *   - Box: storedStatus=true, boxWeight>0, storageLocation is LT (B7-02..05 or LT- prefix)
 *   - Cones: same boxId, coneWeight>0, issueStatus not used/returned_to_vendor,
 *            coneStorageId is ST (B7-01 or ST- prefix)
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/report-lt-boxes-with-st-cones.js
 *   NODE_ENV=development node src/scripts/report-lt-boxes-with-st-cones.js --po=PO-2026-1209
 *   NODE_ENV=development node src/scripts/report-lt-boxes-with-st-cones.js --out=./reports/lt-boxes-with-st-cones.xlsx
 *   NODE_ENV=production node src/scripts/report-lt-boxes-with-st-cones.js --mongo-url="$PROD_MONGODB_URL"
 *
 * Flags:
 *   --po=PO-NUMBER   Limit to one purchase order
 *   --out=PATH       Output .xlsx path (default ./reports/lt-boxes-with-st-cones-<timestamp>.xlsx)
 *   --mongo-url=     Override Mongo connection string
 */

import './lib/mongoUrlParsePatch.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { findLtBoxesWithStCones, buildLtBoxWithStConesRow } from './lib/ltBoxesWithStCones.lib.js';
import { num } from './lib/yarnLtStAuditHelpers.js';

/**
 * Reads `--prefix=value` CLI args.
 * @param {string} prefix
 * @returns {string|null}
 */
function getArg(prefix) {
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length).trim() || null;
}

const PO_FILTER = getArg('--po=');
const OUT_PATH = getArg('--out=');
const MONGO_URL = getArg('--mongo-url=');

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
 * Resolves MongoDB connection string from CLI, config, or env.
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cli = sanitizeMongoUrl(MONGO_URL || '');
  if (cli) return { url: cli, source: '--mongo-url' };
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  const env = sanitizeMongoUrl(String(process.env.MONGODB_URL || process.env.ATLAS_MONGODB_URL || ''));
  return { url: env, source: 'process.env' };
}

/**
 * Writes multi-sheet xlsx report.
 * @param {string} filePath
 * @param {object[]} summaryRows
 * @param {object[]} boxRows
 * @param {object[]} coneRows
 */
function writeReportXlsx(filePath, summaryRows, boxRows, coneRows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summaryRows.length ? summaryRows : [{ note: 'No rows' }]),
    'Summary'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(boxRows.length ? boxRows : [{ note: 'No LT boxes with ST cones' }]),
    'LtBoxesWithStCones'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(coneRows.length ? coneRows : [{ note: 'No ST cone rows' }]),
    'StCones'
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  XLSX.writeFile(wb, filePath);
}

/**
 * Builds ST cone detail rows for a box.
 * @param {Record<string, unknown>} box
 * @param {Record<string, unknown>[]} stCones
 * @returns {Record<string, unknown>[]}
 */
function buildConeRows(box, stCones) {
  return stCones.map((c) => ({
    boxBarcode: box.barcode ?? '',
    boxId: box.boxId ?? '',
    poNumber: box.poNumber ?? '',
    yarnName: box.yarnName ?? '',
    boxStorageLocation: box.storageLocation ?? '',
    boxWeight: num(box.boxWeight),
    coneBarcode: c.barcode ?? '',
    coneIssueStatus: c.issueStatus ?? '',
    coneWeight: num(c.coneWeight),
    tearWeight: num(c.tearWeight),
    netWeight: num(c.coneWeight) - num(c.tearWeight),
    coneStorageId: c.coneStorageId ?? '',
    orderId: c.orderId ? String(c.orderId) : '',
    articleId: c.articleId ? String(c.articleId) : '',
  }));
}

/**
 * Main entry: scan LT boxes and export those with active ST cones.
 * @returns {Promise<void>}
 */
async function main() {
  const { url, source } = resolveMongoConnectionString();
  if (!url) throw new Error('MongoDB URL missing. Set MONGODB_URL or pass --mongo-url=');

  logger.info(`[report-lt-boxes-with-st-cones] connecting via ${source}`);
  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    const candidates = await findLtBoxesWithStCones({ poFilter: PO_FILTER });

    /** @type {Record<string, unknown>[]} */
    const boxRows = [];
    /** @type {Record<string, unknown>[]} */
    const coneRows = [];

    for (const candidate of candidates) {
      boxRows.push(buildLtBoxWithStConesRow(candidate));
      coneRows.push(...buildConeRows(candidate.box, candidate.stCones));
    }

    boxRows.sort(
      (a, b) =>
        String(a.poNumber).localeCompare(String(b.poNumber)) ||
        String(a.boxId).localeCompare(String(b.boxId))
    );
    coneRows.sort(
      (a, b) =>
        String(a.boxId).localeCompare(String(b.boxId)) ||
        String(a.coneBarcode).localeCompare(String(b.coneBarcode))
    );

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outPath = path.resolve(
      process.cwd(),
      OUT_PATH || `./reports/lt-boxes-with-st-cones-${ts}.xlsx`
    );

    const totalStCones = coneRows.length;
    const totalStWeight = coneRows.reduce((sum, r) => sum + num(r.coneWeight), 0);

    const summaryRows = [
      { metric: 'ltBoxesWithActiveStCones', value: boxRows.length },
      { metric: 'activeStConesOnThoseBoxes', value: totalStCones },
      { metric: 'totalStConeWeightKg', value: totalStWeight },
      { metric: 'poFilter', value: PO_FILTER || '(all POs)' },
      { metric: 'mongoSource', value: source },
      { metric: 'outputFile', value: outPath },
    ];

    writeReportXlsx(outPath, summaryRows, boxRows, coneRows);

    // eslint-disable-next-line no-console
    console.log('\n=== LT boxes with ST cones report ===');
    // eslint-disable-next-line no-console
    console.log(`LT boxes with active ST cones:        ${boxRows.length}`);
    // eslint-disable-next-line no-console
    console.log(`Active ST cones:                      ${totalStCones}`);
    // eslint-disable-next-line no-console
    console.log(`Output: ${outPath}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
