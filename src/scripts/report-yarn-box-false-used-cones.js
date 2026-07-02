#!/usr/bin/env node
/**
 * Report yarn boxes where cones were wrongly marked "used" (or left as zero-weight
 * placeholders) while the box still holds weight in LT — the pattern caused by
 * `migrate-cone-mark-used.js` matching generate-by-box cones (weight 0, not_issued, no slot).
 *
 * Problem signatures detected (per box):
 *   MISMATCHED_USED_MIGRATION  — used cones, 0 weight, no issueDate/issueWeight, no ST slot
 *   ZERO_WEIGHT_ALL_CONES      — every cone has coneWeight 0
 *   CONES_IN_LT_BOX            — box still stored in LT with weight while cones exist
 *   CONE_COUNT_MISMATCH        — box.numberOfCones ≠ actual cone rows
 *   CONES_EXIST_NOT_ISSUED_FLAG — cones exist but box.coneData.conesIssued is false
 *
 * Usage (from AddOn_backend):
 *   NODE_ENV=development node src/scripts/report-yarn-box-false-used-cones.js
 *   NODE_ENV=development node src/scripts/report-yarn-box-false-used-cones.js --po=PO-2026-997
 *   NODE_ENV=development node src/scripts/report-yarn-box-false-used-cones.js --out=./reports/false-used-boxes.xlsx
 *   NODE_ENV=development node src/scripts/report-yarn-box-false-used-cones.js --mongo-url="mongodb://..."
 *
 * Flags:
 *   --po=PO-NUMBER   Limit to one purchase order
 *   --out=PATH       Output .xlsx path (default ./reports/yarn-false-used-cones-<timestamp>.xlsx)
 *   --mongo-url=     Override Mongo connection string
 */

import './lib/mongoUrlParsePatch.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import config from '../config/config.js';
import logger from '../config/logger.js';

const WEIGHT_EPS = 1e-9;

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
 * @param {unknown} v
 * @returns {boolean}
 */
function isZeroWeight(v) {
  return Number(v ?? 0) <= WEIGHT_EPS;
}

/**
 * @param {Record<string, unknown>} cone
 * @returns {boolean}
 */
function hasNoStorage(cone) {
  const sid = cone.coneStorageId;
  return sid == null || String(sid).trim() === '';
}

/**
 * Matches cones flipped by migrate-cone-mark-used.js (only issueStatus changed).
 * @param {Record<string, unknown>} cone
 * @returns {boolean}
 */
function isMismarkedUsedByMigration(cone) {
  return (
    cone.issueStatus === 'used' &&
    isZeroWeight(cone.coneWeight) &&
    isZeroWeight(cone.tearWeight) &&
    hasNoStorage(cone) &&
    !cone.issueDate &&
    isZeroWeight(cone.issueWeight) &&
    !cone.orderId &&
    !cone.articleId
  );
}

/**
 * @param {Record<string, unknown>} box
 * @returns {boolean}
 */
function isBoxStillInLt(box) {
  return (
    Boolean(box.storedStatus) &&
    Number(box.boxWeight ?? 0) > WEIGHT_EPS &&
    String(box.storageLocation || '').trim() !== ''
  );
}

/**
 * Classifies cone-level problems for a box.
 * @param {Record<string, unknown>} box
 * @param {Record<string, unknown>[]} cones
 * @returns {string[]}
 */
function classifyBoxProblems(box, cones) {
  if (!cones.length) return [];

  /** @type {Set<string>} */
  const problems = new Set();

  const mismarked = cones.filter(isMismarkedUsedByMigration);
  const zeroWeight = cones.filter((c) => isZeroWeight(c.coneWeight) && isZeroWeight(c.tearWeight));
  const boxConeCount = Number(box.numberOfCones ?? box.coneData?.numberOfCones ?? 0);

  if (mismarked.length > 0) problems.add('MISMATCHED_USED_MIGRATION');
  if (zeroWeight.length === cones.length) problems.add('ZERO_WEIGHT_ALL_CONES');
  if (isBoxStillInLt(box)) problems.add('CONES_IN_LT_BOX');
  if (boxConeCount > 0 && boxConeCount !== cones.length) problems.add('CONE_COUNT_MISMATCH');
  if (!box.coneData?.conesIssued && cones.length > 0) problems.add('CONES_EXIST_NOT_ISSUED_FLAG');

  // Actionable combo: migration false-positive while box never opened properly
  if (mismarked.length > 0 && isBoxStillInLt(box)) {
    problems.add('LIKELY_FALSE_USED_LT_BOX');
  }
  if (zeroWeight.length === cones.length && isBoxStillInLt(box)) {
    problems.add('LIKELY_UNOPENED_BOX_WITH_PLACEHOLDER_CONES');
  }

  return problems.size ? [...problems] : [];
}

/**
 * Builds one summary row per problematic box.
 * @param {Record<string, unknown>} box
 * @param {Record<string, unknown>[]} cones
 * @param {string[]} problemTypes
 * @returns {Record<string, unknown>}
 */
function buildBoxRow(box, cones, problemTypes) {
  const statusCounts = { not_issued: 0, used: 0, issued: 0, returned_to_vendor: 0 };
  let mismarkedUsed = 0;
  let zeroWeight = 0;

  for (const c of cones) {
    const st = String(c.issueStatus || '');
    if (statusCounts[st] != null) statusCounts[st] += 1;
    if (isMismarkedUsedByMigration(c)) mismarkedUsed += 1;
    if (isZeroWeight(c.coneWeight) && isZeroWeight(c.tearWeight)) zeroWeight += 1;
  }

  const createdDates = cones.map((c) => new Date(c.createdAt).getTime()).filter(Number.isFinite);
  const updatedDates = cones.map((c) => new Date(c.updatedAt).getTime()).filter(Number.isFinite);

  return {
    problemTypes: problemTypes.join(', '),
    boxBarcode: box.barcode ?? '',
    boxMongoId: String(box._id ?? ''),
    boxId: box.boxId ?? '',
    poNumber: box.poNumber ?? '',
    yarnName: box.yarnName ?? '',
    lotNumber: box.lotNumber ?? '',
    shadeCode: box.shadeCode ?? '',
    boxWeightKg: Number(box.boxWeight ?? 0),
    grossWeightKg: box.grossWeight ?? '',
    storedStatus: Boolean(box.storedStatus),
    storageLocation: box.storageLocation ?? '',
    numberOfConesOnBox: Number(box.numberOfCones ?? 0),
    coneDataNumberOfCones: Number(box.coneData?.numberOfCones ?? 0),
    conesIssuedFlag: Boolean(box.coneData?.conesIssued),
    actualConeCount: cones.length,
    conesNotIssued: statusCounts.not_issued,
    conesUsed: statusCounts.used,
    conesIssued: statusCounts.issued,
    conesReturnedToVendor: statusCounts.returned_to_vendor,
    conesZeroWeight: zeroWeight,
    conesMismarkedUsed: mismarkedUsed,
    coneFirstCreated: createdDates.length ? new Date(Math.min(...createdDates)).toISOString() : '',
    coneLastUpdated: updatedDates.length ? new Date(Math.max(...updatedDates)).toISOString() : '',
    boxReceivedDate: box.receivedDate ? new Date(box.receivedDate).toISOString() : '',
    recommendedAction:
      problemTypes.includes('LIKELY_FALSE_USED_LT_BOX')
        ? 'Revert cones to not_issued or delete placeholder cones and re-open box with weights'
        : problemTypes.includes('LIKELY_UNOPENED_BOX_WITH_PLACEHOLDER_CONES')
          ? 'Open box, enter cone weights, transfer to ST — do not mark used'
          : 'Review manually',
  };
}

/**
 * Builds detail rows for mismarked / zero-weight cones.
 * @param {Record<string, unknown>} box
 * @param {Record<string, unknown>[]} cones
 * @returns {Record<string, unknown>[]}
 */
function buildConeDetailRows(box, cones) {
  return cones
    .filter((c) => isMismarkedUsedByMigration(c) || (isZeroWeight(c.coneWeight) && c.issueStatus !== 'issued'))
    .map((c) => ({
      boxBarcode: box.barcode ?? '',
      boxId: box.boxId ?? '',
      poNumber: box.poNumber ?? '',
      coneBarcode: c.barcode ?? '',
      coneMongoId: String(c._id ?? ''),
      issueStatus: c.issueStatus ?? '',
      coneWeight: Number(c.coneWeight ?? 0),
      tearWeight: Number(c.tearWeight ?? 0),
      issueWeight: c.issueWeight ?? '',
      issueDate: c.issueDate ? new Date(c.issueDate).toISOString() : '',
      coneStorageId: c.coneStorageId ?? '',
      mismarkedUsedByMigration: isMismarkedUsedByMigration(c) ? 'yes' : 'no',
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : '',
      updatedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : '',
    }));
}

/**
 * Writes multi-sheet xlsx report.
 * @param {string} filePath
 * @param {object[]} boxRows
 * @param {object[]} coneRows
 * @param {object[]} summaryRows
 */
function writeReportXlsx(filePath, boxRows, coneRows, summaryRows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summaryRows.length ? summaryRows : [{ note: 'No problems found' }]),
    'Summary'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(boxRows.length ? boxRows : [{ note: 'No boxes matched' }]),
    'Boxes'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(coneRows.length ? coneRows : [{ note: 'No cone detail rows' }]),
    'ConeDetails'
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  XLSX.writeFile(wb, filePath);
}

/**
 * Main entry: scan boxes with cones and export anomalies to Excel.
 * @returns {Promise<void>}
 */
async function main() {
  const { url, source } = resolveMongoConnectionString();
  if (!url) throw new Error('MongoDB URL missing. Set MONGODB_URL or pass --mongo-url=');

  logger.info(`[report-yarn-box-false-used-cones] connecting via ${source}`);
  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    const db = mongoose.connection.db;

    /** @type {Record<string, unknown>} */
    const boxQuery = { returnedToVendorAt: null };
    if (PO_FILTER) boxQuery.poNumber = PO_FILTER;

    const boxes = await db.collection('yarnboxes').find(boxQuery).toArray();
    const boxByBoxId = new Map(boxes.map((b) => [String(b.boxId), b]));

    /** @type {Record<string, unknown>} */
    const coneQuery = { returnedToVendorAt: null };
    if (PO_FILTER) coneQuery.poNumber = PO_FILTER;

    const allCones = await db.collection('yarncones').find(coneQuery).toArray();

    /** @type {Map<string, Record<string, unknown>[]>} */
    const conesByBoxId = new Map();
    for (const cone of allCones) {
      const key = String(cone.boxId || '');
      if (!key) continue;
      if (!conesByBoxId.has(key)) conesByBoxId.set(key, []);
      conesByBoxId.get(key).push(cone);
    }

    /** @type {Record<string, unknown>[]} */
    const boxRows = [];
    /** @type {Record<string, unknown>[]} */
    const coneRows = [];
    /** @type {Map<string, number>} */
    const problemCounts = new Map();

    for (const [boxId, cones] of conesByBoxId) {
      const box = boxByBoxId.get(boxId);
      if (!box) continue;

      const problemTypes = classifyBoxProblems(box, cones);
      if (!problemTypes.length) continue;

      boxRows.push(buildBoxRow(box, cones, problemTypes));
      coneRows.push(...buildConeDetailRows(box, cones));

      for (const p of problemTypes) {
        problemCounts.set(p, (problemCounts.get(p) || 0) + 1);
      }
    }

    boxRows.sort((a, b) => String(a.poNumber).localeCompare(String(b.poNumber)) || String(a.boxId).localeCompare(String(b.boxId)));

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outPath = path.resolve(process.cwd(), OUT_PATH || `./reports/yarn-false-used-cones-${ts}.xlsx`);

    const summaryRows = [
      { metric: 'boxesScanned', value: boxes.length },
      { metric: 'boxesWithCones', value: conesByBoxId.size },
      { metric: 'problematicBoxes', value: boxRows.length },
      { metric: 'problematicConesInDetailSheet', value: coneRows.length },
      { metric: 'poFilter', value: PO_FILTER || '(all POs)' },
      { metric: 'mongoSource', value: source },
      ...[...problemCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([problemType, count]) => ({ metric: `problem_${problemType}`, value: count })),
    ];

    writeReportXlsx(outPath, boxRows, coneRows, summaryRows);

    console.log('\n=== Yarn false-used / placeholder cone report ===');
    console.log(`Output: ${outPath}`);
    console.log(`Problematic boxes: ${boxRows.length}`);
    console.log(`Cone detail rows: ${coneRows.length}`);
    for (const [p, n] of [...problemCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${p}: ${n}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
