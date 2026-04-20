#!/usr/bin/env node

/**
 * Reset YarnBox (boxWeight=0, storageLocation unset) when cones are already present in short-term storage.
 *
 * Safety rule used here (to avoid breaking partial transfers):
 * - Only reset when ST cone count >= expected cone count for the box.
 *   expected cone count = box.numberOfCones || box.coneData.numberOfCones
 *
 * Short-term cone definition:
 * - coneStorageId is set (non-empty)
 *
 * Usage:
 *   node src/scripts/fix-yarnbox-reset-by-cone-count.js --po=PO-2026-1144 [--dry-run] [--limit=N] [--verbose]
 *
 * Flags:
 *   --po=PO-XXXX-...   Required. PO number to process.
 *   --dry-run          Preview changes only (no writes).
 *   --limit=N          Process at most N boxes.
 *   --verbose          Log first 10 skipped boxes with reasons.
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone } from '../models/index.js';

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : 0;
const PO_ARG = process.argv.find((a) => a.startsWith('--po='));
const PO_NUMBER = PO_ARG ? String(PO_ARG.split('=')[1] || '').trim() : '';

const toNum = (v) => Number(v ?? 0);

async function run() {
  if (!PO_NUMBER) {
    logger.error('Missing required flag: --po=PO_NUMBER');
    process.exitCode = 1;
    return;
  }

  try {
    logger.info('Connecting to MongoDB...');
    // Some local .env files accidentally end Atlas URLs with ">" (copy/paste issue).
    // Also trim whitespace to avoid URI parse failures.
    const rawUrl = String(config?.mongoose?.url || '').trim();
    const sanitizedUrl = rawUrl.endsWith('>') ? rawUrl.slice(0, -1) : rawUrl;
    const redactedUrl = sanitizedUrl.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
    logger.info(`MongoDB URL: ${redactedUrl}`);
    // NOTE: Some older mongoose/mongodb-driver combos choke on mongodb+srv when passing legacy options.
    // The app server connects fine, but for scripts we keep it minimal.
    await mongoose.connect(sanitizedUrl);

    if (DRY_RUN) logger.info('DRY RUN – no writes will be performed');
    logger.info(`PO: ${PO_NUMBER}`);
    if (LIMIT) logger.info(`Limit: ${LIMIT} boxes`);
    if (VERBOSE) logger.info('--verbose: log first 10 skipped boxes');

    let q = YarnBox.find({
      poNumber: PO_NUMBER,
      boxWeight: { $gt: 0 },
    })
      .select('_id boxId poNumber boxWeight storageLocation storedStatus numberOfCones coneData')
      .sort({ createdAt: 1 })
      .lean();

    if (LIMIT > 0) q = q.limit(LIMIT);
    const boxes = await q;

    logger.info(`Found ${boxes.length} box(es) with boxWeight > 0 for this PO.`);

    let fixed = 0;
    let skipped = 0;
    let skippedLogged = 0;

    for (const box of boxes) {
      const boxId = String(box.boxId || '').trim();
      if (!boxId) {
        skipped += 1;
        continue;
      }

      const expectedCones =
        toNum(box.numberOfCones) > 0
          ? toNum(box.numberOfCones)
          : toNum(box?.coneData?.numberOfCones);

      if (!expectedCones || expectedCones <= 0) {
        skipped += 1;
        if (VERBOSE && skippedLogged < 10) {
          logger.info(`  [skip] ${boxId}: expected cones missing (numberOfCones/coneData.numberOfCones not set)`);
          skippedLogged += 1;
        }
        continue;
      }

      const stConeCount = await YarnCone.countDocuments({
        boxId,
        coneStorageId: { $exists: true, $nin: [null, ''] },
      });

      if (stConeCount <= 0) {
        skipped += 1;
        if (VERBOSE && skippedLogged < 10) {
          logger.info(`  [skip] ${boxId}: no cones in short-term storage`);
          skippedLogged += 1;
        }
        continue;
      }

      if (stConeCount < expectedCones) {
        skipped += 1;
        if (VERBOSE && skippedLogged < 10) {
          logger.info(`  [skip] ${boxId}: partial ST cones (${stConeCount}/${expectedCones}), not resetting box`);
          skippedLogged += 1;
        }
        continue;
      }

      const update = {
        $set: {
          boxWeight: 0,
          storedStatus: false,
          coneData: {
            ...(box.coneData && typeof box.coneData === 'object' ? box.coneData : {}),
            conesIssued: true,
            numberOfCones: expectedCones,
            coneIssueDate: new Date(),
          },
        },
        $unset: { storageLocation: '' },
      };

      if (DRY_RUN) {
        logger.info(`  [dry-run] ${boxId}: reset boxWeight ${box.boxWeight} → 0 (ST cones ${stConeCount}/${expectedCones})`);
      } else {
        await YarnBox.updateOne({ _id: box._id }, update);
        logger.info(`  ${boxId}: reset (boxWeight→0, storageLocation unset)`);
      }
      fixed += 1;
    }

    logger.info('---');
    logger.info(`Fixed: ${fixed}`);
    logger.info(`Skipped: ${skipped}`);
    if (DRY_RUN && fixed) logger.info('Run without --dry-run to apply changes.');
  } catch (err) {
    logger.error('Script failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB.');
  }
}

run();

