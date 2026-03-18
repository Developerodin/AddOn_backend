#!/usr/bin/env node

/**
 * Migration: Convert containers from activeArticle/quantity to activeItems[].
 * Run: node src/scripts/migrate-containers-to-activeItems.js
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import ContainersMaster from '../models/production/containersMaster.model.js';

const run = async () => {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    const legacy = await ContainersMaster.find({
      $or: [
        { activeArticle: { $exists: true, $ne: null } },
        { quantity: { $exists: true, $gt: 0 } },
      ],
    }).lean();

    if (legacy.length === 0) {
      logger.info('No legacy containers to migrate.');
      return;
    }

    logger.info(`Migrating ${legacy.length} container(s)...`);
    let migrated = 0;

    for (const doc of legacy) {
      const activeArticle = doc.activeArticle;
      const quantity = doc.quantity || 0;
      const activeFloor = doc.activeFloor || '';

      if (activeArticle && quantity > 0) {
        await ContainersMaster.updateOne(
          { _id: doc._id },
          {
            $set: {
              activeItems: [{ article: activeArticle, quantity }],
              activeFloor,
            },
            $unset: { activeArticle: '', quantity: '' },
          }
        );
        migrated++;
      } else {
        await ContainersMaster.updateOne(
          { _id: doc._id },
          { $unset: { activeArticle: '', quantity: '' } }
        );
      }
    }

    logger.info(`Migrated ${migrated} container(s).`);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
