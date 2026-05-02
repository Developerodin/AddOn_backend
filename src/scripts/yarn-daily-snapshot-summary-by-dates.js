#!/usr/bin/env node

/**
 * Per-day YarnDailyClosingSnapshot summaries: Σ closingKg, row counts, computedAt bounds.
 * Use to compare totals across consecutive snapshot dates (e.g. 2026-04-27 … 04-30).
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/yarn-daily-snapshot-summary-by-dates.js
 *   NODE_ENV=development node src/scripts/yarn-daily-snapshot-summary-by-dates.js \
 *     --dates=2026-04-27,2026-04-28,2026-04-29,2026-04-30
 *   NODE_ENV=development node src/scripts/yarn-daily-snapshot-summary-by-dates.js --json
 *   NODE_ENV=development node src/scripts/yarn-daily-snapshot-summary-by-dates.js --mongo-url=...
 *
 * Troubleshooting Atlas: prefer `mongodb+srv://...@cluster.mongodb.net/...` in MONGODB_URL (single host).
 * Legacy `mongodb://host1:27017,host2,...` URIs warn on newer Node.js; whitelist your IP / VPN on Atlas Network Access.
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
import { YarnDailyClosingSnapshot } from '../models/index.js';

/** Same as app startup + longer timeouts for cold Atlas / flaky replica picks. */
const MONGO_SCRIPT_OPTIONS = {
  ...config.mongoose.options,
  serverSelectionTimeoutMS: 60000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 120000,
};

const DEFAULT_DATES_ISO = ['2026-04-27', '2026-04-28', '2026-04-29', '2026-04-30'];

/** @param {string} rawUrl @returns {string} */
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

/** @returns {string} */
function resolveMongoUrl() {
  const cliArg = process.argv.find((a) => a.startsWith('--mongo-url='));
  if (cliArg) {
    const v = sanitizeMongoUrl(cliArg.slice('--mongo-url='.length));
    if (v) return v;
  }
  return sanitizeMongoUrl(String(config?.mongoose?.url || ''));
}

/** @returns {boolean} */
function cliHasFlag(name) {
  return process.argv.includes(name);
}

/** @param {string} s @returns {boolean} */
function isIsoYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());
}

/**
 * Parse `--dates=2026-04-27,2026-04-28,...` into sorted unique ISO keys (invalid entries dropped).
 * @returns {string[]}
 */
function parseDatesArg() {
  const raw = process.argv.find((a) => a.startsWith('--dates='));
  if (!raw) return [...DEFAULT_DATES_ISO];
  const list = raw
    .slice('--dates='.length)
    .split(/[,;]+/)
    .map((d) => d.trim())
    .filter(isIsoYmd);
  return [...new Set(list)].sort();
}

/**
 * Runs aggregation summaries for YarnDailyClosingSnapshot for the given ISO dates.
 * @param {string[]} snapshotDatesSorted
 * @returns {Promise<Array<{
 *   snapshotDate: string,
 *   totalClosingKg: number,
 *   yarnRowCount: number,
 *   minComputedAt: Date | null,
 *   maxComputedAt: Date | null
 * }>>}
 */
async function snapshotSummaryByDates(snapshotDatesSorted) {
  if (!snapshotDatesSorted.length) {
    throw new Error('No valid --dates keys (expect YYYY-MM-DD, comma-separated).');
  }

  const rows = await YarnDailyClosingSnapshot.aggregate([
    { $match: { snapshotDate: { $in: snapshotDatesSorted } } },
    {
      $group: {
        _id: '$snapshotDate',
        totalClosingKg: { $sum: '$closingKg' },
        yarnRowCount: { $sum: 1 },
        minComputedAt: { $min: '$computedAt' },
        maxComputedAt: { $max: '$computedAt' },
      },
    },
    { $sort: { _id: 1 } },
  ]).exec();

  const byKey = new Map(rows.map((r) => [r._id, r]));

  return snapshotDatesSorted.map((snapshotDate) => {
    const r = byKey.get(snapshotDate);
    return {
      snapshotDate,
      totalClosingKg: r ? Number(r.totalClosingKg) : 0,
      yarnRowCount: r ? r.yarnRowCount : 0,
      minComputedAt: r?.minComputedAt ?? null,
      maxComputedAt: r?.maxComputedAt ?? null,
    };
  });
}

async function main() {
  const mongoUrl = resolveMongoUrl();
  if (!mongoUrl) {
    console.error('Missing mongo URL — set mongoose.url in env / config or pass --mongo-url=');
    process.exit(2);
    return;
  }

  const dates = parseDatesArg();
  await mongoose.connect(mongoUrl, MONGO_SCRIPT_OPTIONS);

  try {
    const summaries = await snapshotSummaryByDates(dates);

    if (cliHasFlag('--json')) {
      console.log(JSON.stringify({ dates: summaries }, null, 2));
      return;
    }

    console.log('YarnDailyClosingSnapshot — totals per snapshotDate (Σ closingKg, one row per yarnCatalogId)');
    console.log('='.repeat(72));
    for (const s of summaries) {
      console.log('');
      console.log(`  snapshotDate:        ${s.snapshotDate}`);
      console.log(`  yarn row count:      ${s.yarnRowCount}`);
      console.log(
        `  totalClosingKg (Σ): ${s.totalClosingKg.toLocaleString('en-IN', { maximumFractionDigits: 6 })} kg`
      );
      if (s.minComputedAt) {
        console.log(`  computedAt min:      ${s.minComputedAt.toISOString?.() ?? s.minComputedAt}`);
      } else console.log(`  computedAt min:      (no docs)`);
      if (s.maxComputedAt) {
        console.log(`  computedAt max:      ${s.maxComputedAt.toISOString?.() ?? s.maxComputedAt}`);
      } else console.log(`  computedAt max:      (no docs)`);
    }

    console.log('');
    console.log('='.repeat(72));
    console.table(
      summaries.map((s) => ({
        snapshotDate: s.snapshotDate,
        yarnRows: s.yarnRowCount,
        totalClosingKg: Number(s.totalClosingKg.toFixed(6)),
      }))
    );

    console.log('');
    console.log(
      'Note: Rows are keyed by YarnDailyClosingSnapshot.snapshotDate — compare Δ totalClosingKg across days.'
    );
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
