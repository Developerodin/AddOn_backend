#!/usr/bin/env node

/**
 * Run yarn daily closing snapshot once (same logic as cron).
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/yarn-snapshot-run-once.js
 *   NODE_ENV=development node src/scripts/yarn-snapshot-run-once.js --dates=2026-04-21,2026-04-23
 *
 * `--dates` writes **current** physical kg under each snapshotDate key (manual backfill when
 * nightly job never ran — not historically reconstructed balances).
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import { runYarnDailySnapshot } from '../cron/yarnDailySnapshot.cron.js';

/**
 * @param {string} raw
 * @returns {string[]}
 */
function parseDatesArg(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const datesArg = process.argv.find((a) => a.startsWith('--dates='));
  const dates = datesArg ? parseDatesArg(datesArg.slice('--dates='.length)) : [];

  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  if (!dates.length) {
    const out = await runYarnDailySnapshot({});
    console.log(JSON.stringify(out, null, 2));
  } else {
    for (const d of dates) {
      const out = await runYarnDailySnapshot({ snapshotDate: d });
      console.log(JSON.stringify(out, null, 2));
    }
  }

  await mongoose.connection.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
