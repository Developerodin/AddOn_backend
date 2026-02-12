#!/usr/bin/env node

/**
 * Seed MachineOrderAssignment for all machines.
 * For each machine, creates one assignment with activeNeedle from machine.needleSizeConfig
 * (first entry); if needleSizeConfig is empty, uses default "12". productionOrderItems = [].
 */

import mongoose from 'mongoose';
import Machine from '../models/machine.model.js';
import MachineOrderAssignment from '../models/production/machineOrderAssignment.model.js';
import config from '../config/config.js';
import logger from '../config/logger.js';

const DEFAULT_NEEDLE_SIZE = '12';

const run = async () => {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    const machines = await Machine.find({ isActive: { $ne: false } }).lean();
    logger.info(`Found ${machines.length} active machines.`);

    let created = 0;
    let skipped = 0;

    for (const machine of machines) {
      const existing = await MachineOrderAssignment.findOne({ machine: machine._id });
      if (existing) {
        skipped += 1;
        logger.info(`Assignment already exists for machine ${machine.machineCode || machine._id}, skipping.`);
        continue;
      }

      const needleConfig = machine.needleSizeConfig;
      const activeNeedle =
        Array.isArray(needleConfig) && needleConfig.length > 0 && needleConfig[0].needleSize
          ? String(needleConfig[0].needleSize).trim()
          : DEFAULT_NEEDLE_SIZE;

      await MachineOrderAssignment.create({
        machine: machine._id,
        activeNeedle,
        productionOrderItems: [],
        isActive: true,
      });
      created += 1;
      logger.info(
        `Created assignment for machine ${machine.machineCode || machine._id} with activeNeedle="${activeNeedle}".`
      );
    }

    logger.info(`Done. Created: ${created}, Skipped (already exist): ${skipped}.`);
  } catch (error) {
    logger.error('Seed machine order assignments failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
