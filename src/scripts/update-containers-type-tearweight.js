#!/usr/bin/env node

/**
 * Migration: Add type and tearWeight to ContainersMaster.
 * - Container 1–300 → type: 'bag', tearWeight: 0.412
 * - Container 301–500 → type: 'bigContainer', tearWeight: 4.120
 * - Container 501+ → type: 'container', tearWeight: 1.980
 * Run: node src/scripts/update-containers-type-tearweight.js
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import ContainersMaster from '../models/production/containersMaster.model.js';
import { ContainerType } from '../models/production/enums.js';

const BAG_MAX = 300;
const BIG_CONTAINER_MAX = 500;
const TEAR_WEIGHT = { bag: 0.412, bigContainer: 4.12, container: 1.98 };
const BATCH_SIZE = 200;

/** Extract numeric index from containerName (e.g. "Container 1" → 1) */
function parseContainerNumber(name) {
  if (!name || typeof name !== 'string') return null;
  const m = name.trim().match(/Container\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

const run = async () => {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    const total = await ContainersMaster.countDocuments();
    logger.info(`Found ${total} containers. Updating type and tearWeight...`);

    let updated = 0;
    let processed = 0;

    while (processed < total) {
      const docs = await ContainersMaster.find({})
        .select('_id containerName type tearWeight')
        .sort({ containerName: 1 })
        .skip(processed)
        .limit(BATCH_SIZE)
        .lean();

      if (docs.length === 0) break;

      const bulkOps = docs.map((doc) => {
        const num = parseContainerNumber(doc.containerName);
        let type = ContainerType.CONTAINER;
        let tearWeight = TEAR_WEIGHT.container;
        if (num !== null) {
          if (num <= BAG_MAX) {
            type = ContainerType.BAG;
            tearWeight = TEAR_WEIGHT.bag;
          } else if (num <= BIG_CONTAINER_MAX) {
            type = ContainerType.BIG_CONTAINER;
            tearWeight = TEAR_WEIGHT.bigContainer;
          }
        }
        const needsUpdate =
          doc.type !== type || doc.tearWeight !== tearWeight;

        if (!needsUpdate) return null;

        return {
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { type, tearWeight } },
          },
        };
      }).filter(Boolean);

      if (bulkOps.length > 0) {
        const result = await ContainersMaster.bulkWrite(bulkOps);
        updated += result.modifiedCount;
      }

      processed += docs.length;
      logger.info(`Processed ${processed}/${total}, updated ${updated} so far`);
    }

    logger.info(`Done. Updated ${updated} containers with type and tearWeight.`);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
