#!/usr/bin/env node

import mongoose from 'mongoose';
import StorageSlot from '../models/storageManagement/storageSlot.model.js';
import config from '../config/config.js';
import logger from '../config/logger.js';

const run = async () => {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    logger.info('Removing existing storage slots...');
    const deleted = await StorageSlot.deleteMany({});
    logger.info(`Removed ${deleted.deletedCount} existing slots.`);

    // Drop legacy unique index (zoneCode + shelfNumber + floorNumber without sectionCode).
    // LT has 4 sections so (LT,1,1) would duplicate without this; current schema uses 4-field unique.
    const legacyIndexName = 'zoneCode_1_shelfNumber_1_floorNumber_1';
    try {
      await StorageSlot.collection.dropIndex(legacyIndexName);
      logger.info(`Dropped legacy index: ${legacyIndexName}`);
    } catch (err) {
      if (err.code === 27 || err.codeName === 'IndexNotFound' || /index not found/i.test(err.message)) {
        logger.info(`Legacy index ${legacyIndexName} not present (ok).`);
      } else {
        throw err;
      }
    }

    logger.info('Seeding storage slots (LT/ST)...');
    const result = await StorageSlot.seedDefaultSlots();
    logger.info(
      `Storage slot seeding finished. Inserted: ${result.inserted}, Already present: ${result.matched}`
    );
  } catch (error) {
    logger.error('Failed to seed storage slots:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();


