#!/usr/bin/env node

/**
 * Remove orphaned article refs from containers (articles that don't exist).
 * Keeps valid articles; removes only invalid refs. Clears container if all refs are orphaned.
 * Run: node src/scripts/clear-containers-with-orphaned-articles.js
 * Options:
 *   --dry-run  Preview only, don't update
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import ContainersMaster from '../models/production/containersMaster.model.js';
import { Article } from '../models/production/index.js';

const DRY_RUN = process.argv.includes('--dry-run');

const run = async () => {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    logger.info('Connected.\n');

    if (DRY_RUN) logger.info('DRY RUN - no changes will be made\n');

    // 1. Containers with activeItems - remove orphaned refs from array
    const containersWithItems = await ContainersMaster.find({ 'activeItems.0': { $exists: true } });
    let fixed = 0;

    for (const c of containersWithItems) {
      const items = c.activeItems || [];
      const validItems = [];
      const removed = [];
      for (const item of items) {
        const aid = item.article?.toString?.() || item.article;
        if (!aid) continue;
        const exists = await Article.findById(aid);
        if (exists) {
          validItems.push({ article: item.article, quantity: item.quantity ?? 0 });
        } else {
          removed.push(aid);
        }
      }
      if (removed.length > 0) {
        fixed++;
        logger.info(`Container ${c._id} (${c.containerName}) - removing ${removed.length} orphaned from activeItems: ${removed.join(', ')}`);
        if (!DRY_RUN) {
          c.activeItems = validItems;
          if (validItems.length === 0) c.activeFloor = '';
          await c.save();
        }
      }
    }

    // 2. Legacy: activeItems empty but activeArticle set - remove if orphaned (use raw collection; activeArticle not in schema)
    const containersLegacy = await mongoose.connection.db
      .collection('containers_masters')
      .find({
        activeArticle: { $exists: true, $nin: [null, ''] },
        $or: [{ activeItems: { $size: 0 } }, { activeItems: { $exists: false } }]
      })
      .toArray();

    for (const c of containersLegacy) {
      const aid = c.activeArticle?.toString?.() || c.activeArticle;
      if (!aid) continue;
      const exists = await Article.findById(aid);
      if (!exists) {
        fixed++;
        logger.info(`Container ${c._id} (${c.containerName}) - removing orphaned activeArticle: ${aid}`);
        if (!DRY_RUN) {
          await mongoose.connection.db.collection('containers_masters').updateOne(
            { _id: c._id },
            { $unset: { activeArticle: '', quantity: '' }, $set: { activeFloor: '' } }
          );
        }
      }
    }

    logger.info(`\n${DRY_RUN ? 'Would fix' : 'Fixed'}: ${fixed} container(s)`);
  } catch (error) {
    logger.error('Script failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    logger.info('\nDisconnected.');
  }
};

run();
