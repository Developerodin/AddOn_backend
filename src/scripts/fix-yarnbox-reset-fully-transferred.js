#!/usr/bin/env node

/**
 * Fix existing YarnBox records that are fully transferred to cones but still have
 * storageLocation, boxWeight, and storedStatus set. Resets them to: boxWeight=0,
 * storageLocation unset, storedStatus=false, coneData updated.
 *
 * Default: reset box if it has any cones linked (boxId). Use flags to require storage or weight match.
 *
 * Usage: node src/scripts/fix-yarnbox-reset-fully-transferred.js [--dry-run] [--limit=N] [--verbose]
 *   --dry-run         Preview changes only (no writes).
 *   --limit=N         Process at most N boxes (default: no limit).
 *   --verbose         Log reason for first 5 skipped boxes.
 *   --require-storage Only reset when cones have coneStorageId set (default: any cones linked).
 *   --require-weight  Only reset when total cone weight >= box weight (default: ignore weight).
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone } from '../models/index.js';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : 0;
const VERBOSE = process.argv.includes('--verbose');
const REQUIRE_STORAGE = process.argv.includes('--require-storage');
const REQUIRE_WEIGHT = process.argv.includes('--require-weight');
const WEIGHT_TOLERANCE = 0.001;

// Cones "in storage" = any non-empty coneStorageId (no prefix required)
const CONE_HAS_ANY_STORAGE = { coneStorageId: { $exists: true, $nin: [null, ''] } };

async function run() {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    if (DRY_RUN) logger.info('DRY RUN – no writes will be performed');
    if (LIMIT) logger.info(`Limit: ${LIMIT} boxes`);
    if (REQUIRE_STORAGE) logger.info('--require-storage: only boxes whose cones have coneStorageId set');
    if (REQUIRE_WEIGHT) logger.info('--require-weight: only when total cone weight >= box weight');
    if (VERBOSE) logger.info('--verbose: log first 5 skipped boxes');

    // Boxes that look "stored" (have weight and location or storedStatus) – candidates to check
    const candidateQuery = {
      boxWeight: { $gt: 0 },
      $or: [
        { storageLocation: { $exists: true, $ne: null, $ne: '' } },
        { storedStatus: true },
      ],
    };
    let q = YarnBox.find(candidateQuery).select('_id boxId boxWeight storageLocation storedStatus coneData').lean();
    if (LIMIT > 0) q = q.limit(LIMIT);
    const boxes = await q;
    logger.info(`Found ${boxes.length} candidate box(es) to check.`);

    let fixed = 0;
    let skippedNotFullyTransferred = 0;
    const errors = [];

    for (const box of boxes) {
      const boxId = box.boxId;
      const boxWeight = box.boxWeight || 0;

      // Default: any cones linked (boxId). With --require-storage: only cones with coneStorageId set.
      const coneQuery = REQUIRE_STORAGE ? { boxId, ...CONE_HAS_ANY_STORAGE } : { boxId };
      const conesInST = await YarnCone.find(coneQuery)
        .select('coneWeight coneStorageId')
        .lean();
      const totalConeWeight = conesInST.reduce((sum, c) => sum + (c.coneWeight || 0), 0);
      const coneCount = conesInST.length;
      const weightMatches = coneCount > 0 && totalConeWeight >= boxWeight - WEIGHT_TOLERANCE;
      const fullyTransferred = REQUIRE_WEIGHT ? weightMatches : coneCount > 0;

      if (!fullyTransferred) {
        if (VERBOSE && skippedNotFullyTransferred < 5) {
          const anyCones = await YarnCone.countDocuments({ boxId });
          const sampleIds = conesInST.slice(0, 3).map((c) => c.coneStorageId).filter(Boolean);
          logger.info(
            `  [skip] ${boxId}: boxWeight=${boxWeight}, cones with boxId=${anyCones}, conesInST=${coneCount}, totalConeWeight=${totalConeWeight.toFixed(2)}` +
              (sampleIds.length ? `, sample coneStorageIds=[${sampleIds.join(', ')}]` : '')
          );
        }
        skippedNotFullyTransferred += 1;
        continue;
      }

      const update = {
        $set: {
          boxWeight: 0,
          storedStatus: false,
          coneData: {
            ...(box.coneData && typeof box.coneData === 'object' ? box.coneData : {}),
            conesIssued: true,
            numberOfCones: coneCount,
            coneIssueDate: new Date(),
          },
        },
        $unset: { storageLocation: '' },
      };

      if (DRY_RUN) {
        logger.info(`  [dry-run] ${boxId}: boxWeight ${boxWeight} → 0, storageLocation unset, storedStatus false (${coneCount} cones, total cone weight ${totalConeWeight})`);
      } else {
        try {
          await YarnBox.updateOne({ _id: box._id }, update);
          logger.info(`  ${boxId}: reset (boxWeight→0, storageLocation unset, ${coneCount} cones)`);
        } catch (err) {
          errors.push({ boxId, error: err.message });
        }
      }
      fixed += 1;
    }

    logger.info('---');
    logger.info(`Fixed: ${fixed}`);
    logger.info(`Skipped (not fully transferred): ${skippedNotFullyTransferred}`);
    if (errors.length) logger.error('Errors:', errors);
    if (DRY_RUN && fixed) logger.info('Run without --dry-run to apply changes.');
  } catch (error) {
    logger.error('Script failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB.');
  }
}

run();
