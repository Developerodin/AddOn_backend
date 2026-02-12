#!/usr/bin/env node

/**
 * Migrates legacy machine.needleSize (string) into needleSizeConfig array.
 * For each machine that has needleSize set, adds { needleSize, cutoffQuantity: 0 }
 * to needleSizeConfig and removes the old needleSize field.
 */

import mongoose from 'mongoose';
import Machine from '../models/machine.model.js';
import config from '../config/config.js';
import logger from '../config/logger.js';

const run = async () => {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    const docs = await Machine.collection
      .find({ needleSize: { $exists: true, $nin: [null, ''] } })
      .toArray();

    let migrated = 0;
    let skipped = 0;

    for (const doc of docs) {
      const oldNeedleSize = doc.needleSize;
      if (!oldNeedleSize || String(oldNeedleSize).trim() === '') {
        skipped += 1;
        continue;
      }

      const result = await Machine.collection.updateOne(
        { _id: doc._id },
        {
          $set: {
            needleSizeConfig: [{ needleSize: String(oldNeedleSize).trim(), cutoffQuantity: 0 }],
          },
          $unset: { needleSize: '' },
        }
      );

      if (result.modifiedCount) {
        migrated += 1;
        logger.info(`Migrated machine ${doc.machineCode || doc._id}: needleSize "${oldNeedleSize}" -> needleSizeConfig`);
      }
    }

    logger.info(`Done. Migrated: ${migrated}, Skipped: ${skipped}`);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
