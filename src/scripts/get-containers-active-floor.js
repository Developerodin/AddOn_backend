#!/usr/bin/env node

/**
 * Get activeFloor for specific containers.
 * Run: node src/scripts/get-containers-active-floor.js
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import ContainersMaster from '../models/production/containersMaster.model.js';

const CONTAINER_IDS = ['41', '116', '138', '256', '154', '268'];

const run = async () => {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    logger.info('Connected.\n');

    const ids = CONTAINER_IDS;
    const objectIds = ids
      .filter((id) => mongoose.Types.ObjectId.isValid(id) && id.length === 24)
      .map((id) => new mongoose.Types.ObjectId(id));

    const containerNames = ids.map((id) => `Container ${id}`);

    const query = {
      $or: [
        { barcode: { $in: ids } },
        { _id: { $in: objectIds } },
        { containerName: { $in: containerNames } },
      ],
    };

    const containers = await ContainersMaster.find(query).lean();

    const updateResult = await ContainersMaster.updateMany(query, { $set: { activeFloor: 'Linking' } });
    logger.info(`Updated activeFloor to "Linking" for ${updateResult.modifiedCount} container(s).\n`);

    const updated = await ContainersMaster.find(query).lean();
    const result = updated.map((c) => ({
      id: c._id.toString(),
      barcode: c.barcode,
      containerName: c.containerName,
      activeFloor: c.activeFloor || '',
    }));

    logger.info('Containers and their active floors:\n');
    console.log(JSON.stringify(result, null, 2));

    const foundIds = new Set();
    for (const c of containers) {
      foundIds.add((c.barcode || '').toString());
      foundIds.add(c._id.toString());
      const m = (c.containerName || '').match(/^Container\s+(\d+)$/);
      if (m) foundIds.add(m[1]);
    }
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length) {
      logger.warn(`Not found: ${missing.join(', ')}`);
    }
  } catch (error) {
    logger.error(error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected.');
  }
};

run();
