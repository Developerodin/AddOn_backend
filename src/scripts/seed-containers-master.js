#!/usr/bin/env node

/**
 * Seed script: creates 1100 ContainersMaster entries.
 * Run: node src/scripts/seed-containers-master.js
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import ContainersMaster from '../models/production/containersMaster.model.js';
import { ContainerStatus } from '../models/production/enums.js';

const TOTAL = 1100;
const BATCH_SIZE = 100;

const run = async () => {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    const existing = await ContainersMaster.countDocuments();
    if (existing >= TOTAL) {
      logger.info(`Already ${existing} containers; skipping seed. To re-seed, delete some first.`);
      return;
    }

    const toCreate = TOTAL - existing;
    logger.info(`Creating ${toCreate} container(s) (target total: ${TOTAL})...`);

    for (let offset = 0; offset < toCreate; offset += BATCH_SIZE) {
      const batchSize = Math.min(BATCH_SIZE, toCreate - offset);
      const batch = Array.from({ length: batchSize }, (_, i) => {
        const n = existing + offset + i + 1;
        const _id = new mongoose.Types.ObjectId();
        return {
          _id,
          containerName: `Container ${n}`,
          status: ContainerStatus.ACTIVE,
          barcode: _id.toString(),
        };
      });
      await ContainersMaster.insertMany(batch);
      logger.info(`Inserted batch ${Math.floor(offset / BATCH_SIZE) + 1}: ${batch.length} containers`);
    }

    const finalCount = await ContainersMaster.countDocuments();
    logger.info(`Done. Total containers_masters: ${finalCount}`);
  } catch (error) {
    logger.error('Seed containers master failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
