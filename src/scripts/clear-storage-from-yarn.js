#!/usr/bin/env node

/**
 * Clears storage-related fields from yarn cones and boxes:
 * - YarnCone: coneStorageId → null
 * - YarnBox: storageLocation → null, storedStatus → false
 */

import mongoose from 'mongoose';
import { YarnBox, YarnCone } from '../models/index.js';
import config from '../config/config.js';
import logger from '../config/logger.js';

const run = async () => {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    logger.info('Clearing coneStorageId from YarnCone...');
    const coneResult = await YarnCone.updateMany({}, { $set: { coneStorageId: null } });
    const coneMatched = coneResult.matchedCount ?? coneResult.n ?? 0;
    const coneModified = coneResult.modifiedCount ?? coneResult.nModified ?? 0;
    logger.info(`YarnCone: matched ${coneMatched}, modified ${coneModified}.`);

    logger.info('Clearing storageLocation and setting storedStatus to false on YarnBox...');
    const boxResult = await YarnBox.updateMany(
      {},
      { $set: { storageLocation: null, storedStatus: false } }
    );
    const boxMatched = boxResult.matchedCount ?? boxResult.n ?? 0;
    const boxModified = boxResult.modifiedCount ?? boxResult.nModified ?? 0;
    logger.info(`YarnBox: matched ${boxMatched}, modified ${boxModified}.`);

    logger.info('Done. Storage fields cleared.');
  } catch (error) {
    logger.error('Failed to clear storage from yarn:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
