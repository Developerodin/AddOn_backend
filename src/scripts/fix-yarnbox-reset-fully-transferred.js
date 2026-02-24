#!/usr/bin/env node

/**
 * Fix existing YarnBox records that are fully transferred to cones but still have
 * storageLocation, boxWeight, and storedStatus set. Resets them to: boxWeight=0,
 * storageLocation unset, storedStatus=false, coneData updated.
 *
 * Criteria: box has cones in ST and total cone weight >= box weight (with 0.001 tolerance).
 *
 * Usage: node src/scripts/fix-yarnbox-reset-fully-transferred.js [--dry-run] [--limit=N]
 *   --dry-run  Preview changes only (no writes).
 *   --limit=N  Process at most N boxes (default: no limit).
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone } from '../models/index.js';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : 0;
const WEIGHT_TOLERANCE = 0.001;

async function run() {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    if (DRY_RUN) logger.info('DRY RUN – no writes will be performed');
    if (LIMIT) logger.info(`Limit: ${LIMIT} boxes`);

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

      const conesInST = await YarnCone.find({
        boxId,
        coneStorageId: { $regex: /^ST-/i },
      })
        .select('coneWeight')
        .lean();
      const totalConeWeight = conesInST.reduce((sum, c) => sum + (c.coneWeight || 0), 0);
      const fullyTransferred = conesInST.length > 0 && totalConeWeight >= boxWeight - WEIGHT_TOLERANCE;

      if (!fullyTransferred) {
        skippedNotFullyTransferred += 1;
        continue;
      }

      const coneCount = conesInST.length;
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
