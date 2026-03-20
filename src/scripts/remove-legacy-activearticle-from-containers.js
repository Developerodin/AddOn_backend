#!/usr/bin/env node

/**
 * Remove legacy activeArticle and quantity from ALL containers.
 * activeItems is the source of truth; activeArticle is deprecated.
 * Run: node src/scripts/remove-legacy-activearticle-from-containers.js
 * Options:
 *   --dry-run  Preview only, don't update
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';

const DRY_RUN = process.argv.includes('--dry-run');

const run = async () => {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    logger.info('Connected.\n');

    if (DRY_RUN) logger.info('DRY RUN - no changes will be made\n');

    const query = { $or: [{ activeArticle: { $exists: true } }, { quantity: { $exists: true } }] };
    const coll = mongoose.connection.db.collection('containers_masters');
    const count = await coll.countDocuments(query);
    logger.info(`Found ${count} container(s) with legacy activeArticle/quantity`);

    let modified = 0;
    if (!DRY_RUN && count > 0) {
      const result = await coll.updateMany(query, { $unset: { activeArticle: '', quantity: '' } });
      modified = result.modifiedCount ?? result.nModified ?? 0;
    } else if (DRY_RUN && count > 0) {
      modified = count;
    }
    logger.info(`${DRY_RUN ? 'Would remove' : 'Removed'} activeArticle/quantity from ${modified} container(s)`);
  } catch (error) {
    logger.error('Script failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    logger.info('\nDisconnected.');
  }
};

run();
