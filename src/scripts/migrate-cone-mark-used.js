#!/usr/bin/env node
/**
 * Backfill issueStatus = 'used' for legacy yarn cones that were empty-returned
 * before the dedicated 'used' lifecycle status existed.
 *
 * Domain rule (confirmed by user):
 *   Cones are only generated when a box is opened, and when a box is opened the
 *   operator enters all cone weights together. Therefore, any cone that today has
 *   coneWeight = 0/null AND issueStatus = 'not_issued' AND no coneStorageId has
 *   already been weighed at some point, issued out for production, and returned
 *   empty -- i.e. it has been used.
 *
 * Usage:
 *   node src/scripts/migrate-cone-mark-used.js --dry-run
 *   node src/scripts/migrate-cone-mark-used.js
 *   node src/scripts/migrate-cone-mark-used.js --limit=5000
 *
 * Flags:
 *   --dry-run     Preview matched cones (count + first 100 sample) without writing.
 *   --limit=<n>   Cap the number of cones updated in this run (paginated by _id).
 *
 * Exit codes:
 *   0 success, 1 unhandled error.
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnCone } from '../models/index.js';

const PREVIEW_SAMPLE_SIZE = 100;
const BATCH_SIZE = 1000;

/**
 * Parse the CLI argv for --dry-run and --limit=N.
 *
 * @returns {{ dryRun: boolean, limit: number | null }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  let limit = null;
  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      const raw = arg.slice('--limit='.length).trim();
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
      }
    }
  }
  return { dryRun, limit };
}

/**
 * Build the MongoDB filter that matches legacy "used" cones.
 *
 * @returns {import('mongoose').FilterQuery<unknown>}
 */
function buildFilter() {
  return {
    $and: [
      {
        $or: [
          { coneWeight: { $exists: false } },
          { coneWeight: null },
          { coneWeight: 0 },
        ],
      },
      { issueStatus: 'not_issued' },
      {
        $or: [
          { coneStorageId: { $exists: false } },
          { coneStorageId: null },
          { coneStorageId: '' },
        ],
      },
    ],
  };
}

/**
 * Print a summary of the matched cones without writing.
 *
 * @param {import('mongoose').FilterQuery<unknown>} filter
 * @returns {Promise<{ matchedCount: number, sampleSize: number }>}
 */
async function previewDryRun(filter) {
  const [matchedCount, sample] = await Promise.all([
    YarnCone.countDocuments(filter),
    YarnCone.find(filter)
      .select('_id boxId barcode coneWeight tearWeight issueStatus coneStorageId')
      .sort({ _id: 1 })
      .limit(PREVIEW_SAMPLE_SIZE)
      .lean(),
  ]);

  console.log('--- DRY RUN: cones that would be marked as used ---');
  console.log(`Total matches: ${matchedCount}`);
  console.log(`Showing first ${sample.length} (out of ${matchedCount}):`);
  for (const cone of sample) {
    console.log(
      `  ${String(cone._id)}  box=${cone.boxId || '-'}  barcode=${
        cone.barcode || '-'
      }  weight=${cone.coneWeight ?? 0}`
    );
  }

  return { matchedCount, sampleSize: sample.length };
}

/**
 * Update all matching cones in batches keyed by _id (safe for large collections).
 *
 * @param {import('mongoose').FilterQuery<unknown>} filter
 * @param {number | null} limit - Optional cap on number of cones updated.
 * @returns {Promise<number>} Number of cones updated.
 */
async function applyMigration(filter, limit) {
  let totalUpdated = 0;
  let cursor = null;
  const remaining = () => (limit == null ? BATCH_SIZE : Math.max(0, limit - totalUpdated));

  while (remaining() > 0) {
    const batchSize = Math.min(BATCH_SIZE, remaining());
    const idQuery = cursor ? { ...filter, _id: { $gt: cursor } } : filter;

    const ids = await YarnCone.find(idQuery)
      .select('_id')
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();

    if (ids.length === 0) break;

    const idArr = ids.map((doc) => doc._id);
    const result = await YarnCone.updateMany(
      { _id: { $in: idArr } },
      { $set: { issueStatus: 'used' } }
    );

    // mongoose 5.7.x / mongodb 3.x exposes the modified count as either
    // `modifiedCount` (driver-style) or `nModified` (legacy) depending on
    // server response. Coerce to a single number for accurate logging.
    const batchUpdated = Number(
      result?.modifiedCount ?? result?.nModified ?? result?.result?.nModified ?? 0
    );
    totalUpdated += Number.isFinite(batchUpdated) ? batchUpdated : 0;
    cursor = idArr[idArr.length - 1];

    logger.info(
      `[migrate-cone-mark-used] batch updated=${batchUpdated} totalUpdated=${totalUpdated}`
    );
  }

  return totalUpdated;
}

async function main() {
  const { dryRun, limit } = parseArgs();
  const filter = buildFilter();

  // Use unified topology so the driver tracks Atlas primary stepdowns / re-elections correctly.
  // Without this, mongodb 3.x falls back to the legacy SDAM engine and can return
  // "no primary server available" mid-write even when the cluster is healthy.
  await mongoose.connect(config.mongoose.url, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30_000,
  });

  try {
    if (dryRun) {
      const preview = await previewDryRun(filter);
      console.log(JSON.stringify({ dryRun: true, ...preview }, null, 2));
      return;
    }

    const matchedBefore = await YarnCone.countDocuments(filter);
    logger.info(
      `[migrate-cone-mark-used] starting live migration matched=${matchedBefore} limit=${
        limit ?? 'none'
      }`
    );

    const conesUpdated = await applyMigration(filter, limit);
    const matchedAfter = await YarnCone.countDocuments(filter);

    logger.info(
      `[migrate-cone-mark-used] done updated=${conesUpdated} remaining=${matchedAfter}`
    );
    console.log(
      JSON.stringify(
        {
          dryRun: false,
          conesMatched: matchedBefore,
          conesUpdated,
          conesRemaining: matchedAfter,
          limit: limit ?? null,
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
