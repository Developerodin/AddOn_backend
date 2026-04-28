#!/usr/bin/env node

/**
 * Summarize YarnDailyClosingSnapshot coverage: which snapshot dates exist, row counts,
 * and example yarn-report query ranges (needs opening = day before start_date, and end_date).
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/report-yarn-daily-snapshot-coverage.js
 *   NODE_ENV=development node src/scripts/report-yarn-daily-snapshot-coverage.js --json
 *   NODE_ENV=development node src/scripts/report-yarn-daily-snapshot-coverage.js --mongo-url=mongodb+srv://...
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
  if (u.endsWith('>')) {
    u = u.slice(0, -1);
  }
  return u;
}

/**
 * @returns {string}
 */
function resolveMongoUrl() {
  const cliArg = process.argv.find((a) => a.startsWith('--mongo-url='));
  if (cliArg) {
    const v = sanitizeMongoUrl(cliArg.slice('--mongo-url='.length));
    if (v) return v;
  }
  return sanitizeMongoUrl(String(config?.mongoose?.url || ''));
}

/**
 * Calendar add for YYYY-MM-DD (UTC date math only; matches snapshotDate keys).
 * @param {string} isoDate
 * @param {number} deltaDays
 * @returns {string}
 */
function addCalendarDays(isoDate, deltaDays) {
  const parts = String(isoDate).split('-').map(Number);
  if (parts.length < 3) return isoDate;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

/**
 * List every calendar YYYY-MM-DD from startKey to endKey inclusive (lex order = chronological for ISO dates).
 * @param {string} startKey
 * @param {string} endKey
 * @returns {string[]}
 */
function enumerateDaysInclusive(startKey, endKey) {
  const out = [];
  let cur = startKey;
  while (cur <= endKey) {
    out.push(cur);
    cur = addCalendarDays(cur, 1);
    if (out.length > 4000) break;
  }
  return out;
}

/**
 * @param {Set<string>} present
 * @param {string} startKey
 * @param {string} endKey
 * @returns {string[]}
 */
function missingDaysInRange(present, startKey, endKey) {
  return enumerateDaysInclusive(startKey, endKey).filter((d) => !present.has(d));
}

/**
 * Widest (S, E) with S−1 and E both snapshot keys and S ≤ E (gaps between snapshot days OK).
 *
 * @param {Set<string>} dateSet
 * @returns {{ start_date: string, end_date: string } | null}
 */
function buildGlobalMaxReportRange(dateSet) {
  const sorted = [...dateSet].sort();
  if (!sorted.length) return null;
  const eMax = sorted[sorted.length - 1];
  const validStarts = sorted.map((d) => addCalendarDays(d, 1)).filter((s) => s <= eMax);
  if (!validStarts.length) return null;
  validStarts.sort();
  return { start_date: validStarts[0], end_date: eMax };
}

/**
 * @param {Set<string>} dateSet
 * @param {number} maxExamples
 * @returns {Array<{ start_date: string, end_date: string, openingSnapshot: string, closingSnapshot: string }>}
 */
function buildExampleReportRanges(dateSet, maxExamples) {
  const sorted = [...dateSet].sort();
  const examples = [];
  for (let i = 0; i < sorted.length && examples.length < maxExamples; i += 1) {
    const closing = sorted[i];
    const opening = addCalendarDays(closing, -1);
    if (!dateSet.has(opening)) continue;
    const start_date = addCalendarDays(opening, 1);
    if (start_date > closing) continue;
    examples.push({
      start_date,
      end_date: closing,
      openingSnapshot: opening,
      closingSnapshot: closing,
    });
  }
  return examples;
}

/**
 * Longest valid yarn-report window inside a streak of consecutive snapshotDate keys.
 * Opening for `start_date` must exist as a snapshot row on calendar day `start_date - 1`.
 *
 * @param {Set<string>} dateSet
 * @param {string} streakFirst
 * @param {string} streakLast
 * @returns {{ start_date: string, end_date: string, snapshotStreak: string } | null}
 */
function maxReportWindowInsideSnapshotStreak(dateSet, streakFirst, streakLast) {
  let sLow = null;
  let cur = streakFirst;
  while (cur <= streakLast) {
    const dayBefore = addCalendarDays(cur, -1);
    if (dateSet.has(dayBefore)) {
      sLow = cur;
      break;
    }
    cur = addCalendarDays(cur, 1);
  }
  if (sLow === null) return null;
  return {
    start_date: sLow,
    end_date: streakLast,
    snapshotStreak: `${streakFirst}..${streakLast}`,
  };
}

/**
 * @param {Set<string>} dateSet
 * @returns {Array<{ start_date: string, end_date: string, snapshotStreak: string }>}
 */
function buildMaxWindowsPerConsecutiveSnapshotStreak(dateSet) {
  const sorted = [...dateSet].sort();
  const windows = [];
  let streakFirst = null;
  let streakLast = null;
  for (const d of sorted) {
    if (streakFirst === null) {
      streakFirst = streakLast = d;
      continue;
    }
    if (addCalendarDays(streakLast, 1) === d) {
      streakLast = d;
      continue;
    }
    const w = maxReportWindowInsideSnapshotStreak(dateSet, streakFirst, streakLast);
    if (w) windows.push(w);
    streakFirst = streakLast = d;
  }
  if (streakFirst !== null) {
    const w = maxReportWindowInsideSnapshotStreak(dateSet, streakFirst, streakLast);
    if (w) windows.push(w);
  }
  return windows;
}

async function main() {
  const asJson = process.argv.includes('--json');

  const mongoUrl = resolveMongoUrl();
  if (!mongoUrl) {
    throw new Error('No MongoDB URL: set MONGODB_URL in .env or pass --mongo-url=');
  }
  await mongoose.connect(mongoUrl, config.mongoose.options);

  const perDate = await YarnDailyClosingSnapshot.aggregate([
    {
      $group: {
        _id: '$snapshotDate',
        rowCount: { $sum: 1 },
        totalClosingKg: { $sum: '$closingKg' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const totalRows = perDate.reduce((a, r) => a + r.rowCount, 0);
  const distinctDates = perDate.map((r) => r._id).filter(Boolean);
  const dateSet = new Set(distinctDates);
  const minDate = distinctDates[0] || null;
  const maxDate = distinctDates[distinctDates.length - 1] || null;

  let missingInSpan = [];
  if (minDate && maxDate) {
    missingInSpan = missingDaysInRange(dateSet, minDate, maxDate);
  }

  const exampleRanges = buildExampleReportRanges(dateSet, 12);
  const streakWindows = buildMaxWindowsPerConsecutiveSnapshotStreak(dateSet);
  const globalMaxRange = buildGlobalMaxReportRange(dateSet);

  await mongoose.connection.close();

  const summary = {
    collection: 'YarnDailyClosingSnapshot',
    totalDocuments: totalRows,
    distinctSnapshotDates: distinctDates.length,
    minSnapshotDate: minDate,
    maxSnapshotDate: maxDate,
    perDate: perDate.map((r) => ({
      snapshotDate: r._id,
      rowCount: r.rowCount,
      totalClosingKg: Math.round(r.totalClosingKg * 1000) / 1000,
    })),
    calendarGapsBetweenMinAndMax: missingInSpan,
    yarnReportRule:
      'GET /v1/yarn-management/yarn-report needs YarnDailyClosingSnapshot rows for (start_date minus 1 day) AND for end_date (both YYYY-MM-DD keys).',
    exampleValidQueryParams: exampleRanges.map((x) => ({
      start_date: x.start_date,
      end_date: x.end_date,
      requires_snapshot_keys: [x.openingSnapshot, x.closingSnapshot],
    })),
    maxReportWindowPerConsecutiveSnapshotStreak: streakWindows,
    globalMaxValidReportRange: globalMaxRange,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('=== YarnDailyClosingSnapshot coverage ===\n');
  console.log(`Total documents:     ${totalRows}`);
  console.log(`Distinct dates:      ${distinctDates.length}`);
  console.log(`Earliest snapshot:   ${minDate ?? '(none)'}`);
  console.log(`Latest snapshot:     ${maxDate ?? '(none)'}`);
  console.log('\n--- Per snapshotDate (row count, sum closingKg) ---');
  const rows = summary.perDate;
  const maxLines = 50;
  if (rows.length <= maxLines) {
    for (const row of rows) {
      console.log(`  ${row.snapshotDate}  rows=${row.rowCount}  totalKg=${row.totalClosingKg}`);
    }
  } else {
    console.log(`  (showing first 25 and last 25 of ${rows.length} dates; use --json for full list)`);
    for (const row of rows.slice(0, 25)) {
      console.log(`  ${row.snapshotDate}  rows=${row.rowCount}  totalKg=${row.totalClosingKg}`);
    }
    console.log('  ...');
    for (const row of rows.slice(-25)) {
      console.log(`  ${row.snapshotDate}  rows=${row.rowCount}  totalKg=${row.totalClosingKg}`);
    }
  }

  if (missingInSpan.length) {
    console.log(
      `\n--- Calendar gaps between min and max (${missingInSpan.length} missing day keys) ---`
    );
    console.log(missingInSpan.join(', '));
  } else if (minDate && maxDate) {
    console.log('\n--- No calendar gaps between min and max snapshotDate ---');
  }

  console.log(`\n--- ${summary.yarnReportRule} ---`);
  if (summary.globalMaxValidReportRange) {
    const g = summary.globalMaxValidReportRange;
    console.log(
      `\nWidest valid report window (any gap days only need no snapshot; opening/closing keys must exist):`
    );
    console.log(`  start_date=${g.start_date}  end_date=${g.end_date}`);
  }
  console.log('\nExample valid start_date / end_date (one-day: closing and previous calendar day both snapshotted):');
  for (const ex of summary.exampleValidQueryParams.slice(0, 8)) {
    console.log(
      `  start_date=${ex.start_date}  end_date=${ex.end_date}  (snapshots: ${ex.requires_snapshot_keys.join(', ')})`
    );
  }

  if (streakWindows.length) {
    console.log('\nLargest valid window per consecutive snapshot-date streak (opening day must exist):');
    for (const r of streakWindows.slice(-8)) {
      console.log(
        `  start_date=${r.start_date}  end_date=${r.end_date}  (streak ${r.snapshotStreak})`
      );
    }
  }

  console.log('\nTip: pass --json for machine-readable output.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
