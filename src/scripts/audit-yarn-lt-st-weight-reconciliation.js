#!/usr/bin/env node

/**
 * Fleet-wide read-only audit: LT box rows vs ST cone rows (double-count, weight drift, slot occupancy).
 *
 * Usage:
 *   node src/scripts/audit-yarn-lt-st-weight-reconciliation.js
 *   node src/scripts/audit-yarn-lt-st-weight-reconciliation.js --mongo-url=mongodb://...
 *   node src/scripts/audit-yarn-lt-st-weight-reconciliation.js --list-problems=doubleCountRisk --limit-problems=100
 *   node src/scripts/audit-yarn-lt-st-weight-reconciliation.js --list-problems=all --no-slots
 *   node src/scripts/audit-yarn-lt-st-weight-reconciliation.js --output-csv=./yarn-lt-st-audit.csv
 *   node src/scripts/audit-yarn-lt-st-weight-reconciliation.js --output-csv=./problems.csv --csv-scope=problems
 *
 * Remediation (separate scripts, use --dry-run first):
 *   backfill-lt-boxweight-from-st-cones.js, fix-yarnbox-reset-fully-transferred.js
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone, StorageSlot } from '../models/index.js';
import { STORAGE_ZONES } from '../models/storageManagement/storageSlot.model.js';
import {
  WEIGHT_EPS_KG,
  getLtStorageLocationRegex,
  isDoubleCountRisk,
  isFullyTransferredBox,
  isFullyTransferredButLtFieldsDirty,
  isLtWeightInconsistentWithModel,
  num,
  expectedRemainingBoxWeightGross,
} from './lib/yarnLtStAuditHelpers.js';
import { createCsvWriteStream, formatCsvLine } from './lib/yarnLtStAuditCsv.js';
import {
  loadConeMetricsByBoxId,
  loadActiveStRackBarcodesByBoxId,
  coneTotals,
  conesWithLtPatternStorage,
} from './lib/yarnLtStAuditAggregations.js';

const JSON_ONLY = process.argv.includes('--json-only');
const NO_SLOTS = process.argv.includes('--no-slots');

/** @returns {{ url: string, source: string }} */
function resolveMongoConnectionString() {
  const cliArg = process.argv.find((a) => a.startsWith('--mongo-url='));
  if (cliArg) {
    const v = cliArg.slice('--mongo-url='.length).trim().replace(/^\uFEFF/, '');
    if (v) return { url: v, source: '--mongo-url' };
  }
  const cfg = String(config?.mongoose?.url || '').trim();
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  const envOnly = String(process.env.MONGODB_URL || '').trim();
  return { url: envOnly, source: 'process.env.MONGODB_URL' };
}

/** @param {string} argPrefix */
function parseArgValue(argPrefix) {
  const raw = process.argv.find((a) => a.startsWith(argPrefix));
  if (!raw) return '';
  return raw.slice(argPrefix.length).trim();
}

/** @returns {{ mode: 'none'|'doubleCountRisk'|'weightInconsistent'|'fullyTransferredDirty'|'all', limit: number }} */
function parseListProblems() {
  const v = parseArgValue('--list-problems=').toLowerCase();
  const limitRaw = parseArgValue('--limit-problems=');
  const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 200) : 200;
  if (!v || v === 'none') return { mode: 'none', limit };
  if (v === 'doublecountrisk' || v === 'double_count_risk') return { mode: 'doubleCountRisk', limit };
  if (v === 'weightinconsistent' || v === 'weight_inconsistent') return { mode: 'weightInconsistent', limit };
  if (v === 'fullytransferreddirty' || v === 'fully_transferred_dirty')
    return { mode: 'fullyTransferredDirty', limit };
  if (v === 'all') return { mode: 'all', limit };
  return { mode: 'none', limit };
}

/** @returns {string} */
function parseOutputCsvPath() {
  return parseArgValue('--output-csv=').trim();
}

/** @returns {'all'|'problems'} */
function parseCsvScope() {
  const v = parseArgValue('--csv-scope=').toLowerCase();
  if (v === 'problems' || v === 'issue' || v === 'issues') return 'problems';
  return 'all';
}

/**
 * @returns {Promise<void>}
 */
async function connectMongo() {
  const { url: mongoUrl, source } = resolveMongoConnectionString();
  if (!mongoUrl) {
    throw new Error('MongoDB URL is empty. Set MONGODB_URL in .env or pass --mongo-url=');
  }
  const redacted = mongoUrl.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`MongoDB URL (${source}): ${redacted}`);
  await mongoose.connect(mongoUrl, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
}

/**
 * @param {Record<string, unknown>} box
 * @param {{ activeStCount: number, activeStGrossKg: number, issuedConeCount: number, totalConeCount: number, anySlotGrossKg: number }} metrics
 * @returns {Record<string, unknown>}
 */
function buildProblemRow(box, metrics) {
  const expected = expectedRemainingBoxWeightGross(box, metrics.anySlotGrossKg);
  const declaredConeCount =
    box.numberOfCones != null && box.numberOfCones !== '' ? Math.round(num(box.numberOfCones)) : null;
  const deltaConesVsBox =
    declaredConeCount != null && Number.isFinite(declaredConeCount)
      ? metrics.activeStCount - declaredConeCount
      : null;
  const totalActivePlusIssued = (metrics.activeStCount || 0) + (metrics.issuedConeCount || 0);
  return {
    boxId: box.boxId,
    barcode: box.barcode,
    poNumber: box.poNumber,
    storageLocation: box.storageLocation,
    storedStatus: box.storedStatus,
    boxWeightKg: Math.round(num(box.boxWeight) * 1000) / 1000,
    initialBoxWeightKg:
      box.initialBoxWeight != null ? Math.round(num(box.initialBoxWeight) * 1000) / 1000 : null,
    numberOfCones_onBox: declaredConeCount,
    delta_shortTermActiveCones_minus_boxNumberOfCones: deltaConesVsBox,
    stActiveConeCount: metrics.activeStCount,
    stActiveConeGrossKg: Math.round(metrics.activeStGrossKg * 1000) / 1000,
    issuedConeCount_inactiveUsed: metrics.issuedConeCount || 0,
    totalConeCount_activePlusIssued: totalActivePlusIssued,
    totalConeDocuments_anyStatus: metrics.totalConeCount || 0,
    anySlotConeGrossKg: Math.round(metrics.anySlotGrossKg * 1000) / 1000,
    expectedRemainingBoxGrossKg: Math.round(expected * 1000) / 1000,
  };
}

async function main() {
  const { mode: listMode, limit: listLimit } = parseListProblems();
  const topN = 50;
  const csvPath = parseOutputCsvPath();
  const csvScope = parseCsvScope();

  await connectMongo();

  const LT_REGEX = getLtStorageLocationRegex();

  const [coneByBoxId, stRacksByBoxId, issuedAgg, badLtCones, stActiveTotals, ltBoxCount] = await Promise.all([
    loadConeMetricsByBoxId(),
    loadActiveStRackBarcodesByBoxId(),
    YarnCone.aggregate([
      { $match: { issueStatus: 'issued' } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          weightKg: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ['$issueWeight', null] }, { $gt: ['$issueWeight', 0] }] },
                '$issueWeight',
                { $ifNull: ['$coneWeight', 0] },
              ],
            },
          },
        },
      },
    ]),
    conesWithLtPatternStorage(LT_REGEX),
    coneTotals({
      coneStorageId: { $exists: true, $nin: [null, ''] },
      issueStatus: { $nin: ['issued', 'used'] },
      coneWeight: { $gt: WEIGHT_EPS_KG },
    }),
    YarnBox.countDocuments({ storageLocation: { $regex: LT_REGEX } }),
  ]);

  const issuedRow = issuedAgg[0] || { count: 0, weightKg: 0 };

  const anomalyCounts = {
    doubleCountRisk: 0,
    weightInconsistent: 0,
    fullyTransferredButLtFieldsDirty: 0,
  };

  const topDoubleCount = [];
  const problemLists = {
    doubleCountRisk: [],
    weightInconsistent: [],
    fullyTransferredDirty: [],
  };

  let ltStoredBoxesScanned = 0;
  let ltStoredBoxWeightSumKg = 0;

  let csvStream = null;
  let csvRowsWritten = 0;
  if (csvPath) {
    csvStream = createCsvWriteStream(csvPath);
    logger.info(`CSV export: ${csvPath} (scope=${csvScope})`);
  }

  const ltRegexCursor = YarnBox.find({ storageLocation: { $regex: LT_REGEX } })
    .select(
      'boxId barcode poNumber storageLocation storedStatus boxWeight initialBoxWeight numberOfCones coneData yarnName'
    )
    .lean()
    .cursor({ batchSize: 200 });

  /* eslint-disable no-await-in-loop -- sequential cursor iteration */
  let nextBox = await ltRegexCursor.next();
  while (nextBox != null) {
    const box = nextBox;
    const bid = String(box.boxId || '');
    const m = coneByBoxId.get(bid) || {
      activeStCount: 0,
      activeStGrossKg: 0,
      activeStNetKg: 0,
      issuedConeCount: 0,
      totalConeCount: 0,
      anySlotGrossKg: 0,
    };

    if (box.storedStatus === true) {
      ltStoredBoxesScanned += 1;
      ltStoredBoxWeightSumKg += num(box.boxWeight);
    }

    const dcr = isDoubleCountRisk(box, m.activeStCount);
    const wi = isLtWeightInconsistentWithModel(box, m.anySlotGrossKg);
    const ftDirty = isFullyTransferredButLtFieldsDirty(box, m.anySlotGrossKg);

    if (dcr) anomalyCounts.doubleCountRisk += 1;
    if (wi) anomalyCounts.weightInconsistent += 1;
    if (ftDirty) anomalyCounts.fullyTransferredButLtFieldsDirty += 1;

    if (dcr && topDoubleCount.length < topN) {
      topDoubleCount.push(bid);
    }

    const row = buildProblemRow(box, m);
    if (listMode !== 'none') {
      if ((listMode === 'all' || listMode === 'doubleCountRisk') && dcr && problemLists.doubleCountRisk.length < listLimit) {
        problemLists.doubleCountRisk.push({ ...row, flags: ['doubleCountRisk'] });
      }
      if ((listMode === 'all' || listMode === 'weightInconsistent') && wi && problemLists.weightInconsistent.length < listLimit) {
        problemLists.weightInconsistent.push({ ...row, flags: ['weightInconsistent'] });
      }
      if (
        (listMode === 'all' || listMode === 'fullyTransferredDirty') &&
        ftDirty &&
        problemLists.fullyTransferredDirty.length < listLimit
      ) {
        problemLists.fullyTransferredDirty.push({ ...row, flags: ['fullyTransferredButLtFieldsDirty'] });
      }
    }

    if (csvStream && (csvScope === 'all' || dcr || wi || ftDirty)) {
      const racks = stRacksByBoxId.get(bid) || [];
      const expectedKg = expectedRemainingBoxWeightGross(box, m.anySlotGrossKg);
      const actualKg = num(box.boxWeight);
      const declaredN =
        box.numberOfCones != null && box.numberOfCones !== '' ? Math.round(num(box.numberOfCones)) : null;
      const deltaCones =
        declaredN != null && Number.isFinite(declaredN) ? m.activeStCount - declaredN : '';
      csvStream.write(
        formatCsvLine([
          bid,
          box.barcode,
          box.poNumber,
          box.yarnName,
          box.storageLocation,
          box.storedStatus === true ? 'true' : 'false',
          Math.round(actualKg * 1000) / 1000,
          box.initialBoxWeight != null ? Math.round(num(box.initialBoxWeight) * 1000) / 1000 : '',
          declaredN != null ? declaredN : '',
          deltaCones,
          m.activeStCount,
          Math.round(m.activeStGrossKg * 1000) / 1000,
          Math.round(m.activeStNetKg * 1000) / 1000,
          m.issuedConeCount || 0,
          (m.activeStCount || 0) + (m.issuedConeCount || 0),
          racks.join('; '),
          Math.round(m.anySlotGrossKg * 1000) / 1000,
          Math.round(expectedKg * 1000) / 1000,
          Math.round((actualKg - expectedKg) * 1000) / 1000,
          dcr ? 'yes' : 'no',
          wi ? 'yes' : 'no',
          ftDirty ? 'yes' : 'no',
        ])
      );
      csvRowsWritten += 1;
    }

    nextBox = await ltRegexCursor.next();
  }
  /* eslint-enable no-await-in-loop */

  if (csvStream) {
    await new Promise((resolve, reject) => {
      csvStream.end((err) => {
        if (err) reject(err);
        else resolve(undefined);
      });
    });
    logger.info(`CSV wrote ${csvRowsWritten} row(s) to ${csvPath}`);
  }

  /** @type {Record<string, unknown>} */
  let slotSummary = { skipped: true };
  if (!NO_SLOTS) {
    const [ltSlots, stSlots] = await Promise.all([
      StorageSlot.find({ zoneCode: STORAGE_ZONES.LONG_TERM, isActive: true })
        .select('barcode label')
        .lean(),
      StorageSlot.find({ zoneCode: STORAGE_ZONES.SHORT_TERM, isActive: true })
        .select('barcode label')
        .lean(),
    ]);
    const ltBarcodeSet = new Set(
      ltSlots.map((s) => String(s.barcode || s.label || '').trim()).filter(Boolean)
    );
    const stBarcodeSet = new Set(
      stSlots.map((s) => String(s.barcode || s.label || '').trim()).filter(Boolean)
    );

    const boxesOnKnownLtSlots = await YarnBox.find({
      storageLocation: { $in: [...ltBarcodeSet] },
      storedStatus: true,
    })
      .select('boxId storageLocation boxWeight initialBoxWeight coneData')
      .lean();

    const boxIdsForCone = boxesOnKnownLtSlots.map((b) => b.boxId).filter(Boolean);
    const coneWRows =
      boxIdsForCone.length > 0
        ? await YarnCone.aggregate([
            {
              $match: {
                boxId: { $in: boxIdsForCone },
                coneStorageId: { $exists: true, $nin: [null, ''] },
              },
            },
            { $group: { _id: '$boxId', totalConeWeight: { $sum: '$coneWeight' } } },
          ])
        : [];
    const coneWeightByBox = new Map(
      coneWRows.map((row) => {
        const { _id: boxIdRef } = row;
        return [boxIdRef, num(row.totalConeWeight)];
      })
    );

    const slotBoxCount = {};
    const unknownLtPatternLocations = new Set();

    boxesOnKnownLtSlots.forEach((b) => {
      const cw = coneWeightByBox.get(b.boxId) || 0;
      if (isFullyTransferredBox(b, cw)) return;
      const loc = String(b.storageLocation || '').trim();
      if (!loc) return;
      slotBoxCount[loc] = (slotBoxCount[loc] || 0) + 1;
    });

    const unknownBoxes = await YarnBox.find({
      storageLocation: { $regex: LT_REGEX },
      storedStatus: true,
    })
      .select('storageLocation')
      .lean();

    unknownBoxes.forEach((ub) => {
      const loc = String(ub.storageLocation || '').trim();
      if (loc && !ltBarcodeSet.has(loc)) unknownLtPatternLocations.add(loc);
    });

    const multiBoxSlots = Object.entries(slotBoxCount)
      .filter(([, c]) => c > 1)
      .map(([barcode, boxCount]) => ({ barcode, boxCount }));

    slotSummary = {
      longTermSlotCount: ltSlots.length,
      shortTermSlotCount: stSlots.length,
      occupiedLongTermSlotCount: Object.keys(slotBoxCount).length,
      multiBoxLongTermSlots: multiBoxSlots.length,
      multiBoxLongTermSlotSamples: multiBoxSlots.slice(0, 20),
      unknownLtPatternLocationCount: unknownLtPatternLocations.size,
      unknownLtPatternLocationSamples: [...unknownLtPatternLocations].slice(0, 20),
      stBarcodeCountForReference: stBarcodeSet.size,
    };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    thresholds: { weightEpsKg: WEIGHT_EPS_KG },
    totals: {
      yarnBoxesWithLtPatternStorageLocation: ltBoxCount,
      yarnBoxesLtPatternWithStoredStatusTrueScanned: ltStoredBoxesScanned,
      sumBoxWeightKgOnLtPatternStored: Math.round(ltStoredBoxWeightSumKg * 1000) / 1000,
      shortTermActiveCones: {
        count: stActiveTotals.count,
        grossWeightKg: Math.round(stActiveTotals.grossKg * 1000) / 1000,
      },
      issuedCones: {
        count: issuedRow.count || 0,
        weightKg: Math.round(num(issuedRow.weightKg || 0) * 1000) / 1000,
      },
    },
    anomalies: {
      conesWithLongTermPatternConeStorageId: badLtCones,
    },
    anomalyCounts,
    topProblemBoxIds: { doubleCountRisk: topDoubleCount },
    ...(listMode !== 'none' ? { problemLists } : {}),
    slotSummary,
    cli: {
      listProblems: listMode,
      listLimit,
      noSlots: NO_SLOTS,
      outputCsv: csvPath || null,
      csvScope: csvPath ? csvScope : null,
      csvRowsWritten: csvPath ? csvRowsWritten : null,
    },
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload, null, 2));

  if (!JSON_ONLY) {
    // eslint-disable-next-line no-console
    console.error(
      `\nSummary: doubleCountRisk=${anomalyCounts.doubleCountRisk} | weightInconsistent=${anomalyCounts.weightInconsistent} | fullyTransferredDirty=${anomalyCounts.fullyTransferredButLtFieldsDirty}`
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
