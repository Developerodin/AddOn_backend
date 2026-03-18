#!/usr/bin/env node

/**
 * Test script for GET /containers-masters/:id/with-articles
 *
 * Usage:
 *   node src/scripts/test-container-with-articles.js              # Find container with valid article & test
 *   node src/scripts/test-container-with-articles.js <containerId> # Test specific container
 *   node src/scripts/test-container-with-articles.js <containerId> --fix  # Fix container: replace orphaned refs with valid article
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import ContainersMaster from '../models/production/containersMaster.model.js';
import { Article } from '../models/production/index.js';
import * as containersMasterService from '../services/production/containersMaster.service.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const CONTAINER_ID = args[0];
const FIX_ORPHANED = process.argv.includes('--fix');

const run = async () => {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    logger.info('Connected.\n');

    let containerId = CONTAINER_ID;

    // Get a valid article for testing/fixing
    const validArticle = await Article.findOne({}).select('_id id articleNumber').lean();
    if (!validArticle) {
      logger.error('No articles in DB. Create an article first.');
      return;
    }
    logger.info(`Valid article for test: ${validArticle._id} (${validArticle.articleNumber})\n`);

    if (FIX_ORPHANED && containerId) {
      // Fix: replace orphaned article refs with valid article
      const container = await ContainersMaster.findById(containerId);
      if (!container) {
        logger.error(`Container ${containerId} not found`);
        return;
      }
      let fixed = 0;
      for (const item of container.activeItems || []) {
        const aid = item.article?.toString?.() || item.article;
        if (aid) {
          const exists = await Article.findById(aid);
          if (!exists) {
            item.article = validArticle._id;
            logger.info(`Fixed orphaned ref ${aid} -> ${validArticle._id}`);
            fixed++;
          }
        }
      }
      if (fixed > 0) {
        await container.save();
        logger.info(`Container updated (${fixed} refs fixed). Re-run without --fix to verify.\n`);
      } else {
        logger.info('No orphaned refs to fix.\n');
      }
    }

    // Resolve container to test
    if (!containerId) {
      // Find a container that has a valid article
      const containers = await ContainersMaster.find({ 'activeItems.0': { $exists: true } }).limit(20).lean();
      for (const c of containers) {
        const aid = c.activeItems?.[0]?.article?.toString?.() || c.activeItems?.[0]?.article;
        if (aid && (await Article.findById(aid))) {
          containerId = c._id.toString();
          logger.info(`Using container ${containerId} (has valid article)\n`);
          break;
        }
      }
      if (!containerId && containers.length > 0) {
        // No container has valid article - use first and fix it
        containerId = containers[0]._id.toString();
        logger.info(`No container with valid article. Updating ${containerId} to use valid article...`);
        await ContainersMaster.updateOne(
          { _id: containerId },
          { $set: { 'activeItems.0.article': validArticle._id } }
        );
        logger.info('Updated. Testing...\n');
      }
    }

    if (!containerId) {
      logger.error('No container to test. Create a container with activeItems first.');
      return;
    }

    // Run the API
    logger.info('=== getContainerWithArticlesById result ===');
    const result = await containersMasterService.getContainerWithArticlesById(containerId);
    if (!result) {
      logger.error('Container not found');
      return;
    }

    logger.info(JSON.stringify(result, null, 2));
    logger.info('');

    const itemsWithArticle = (result?.activeItems || []).filter((i) => i.article != null);
    const itemsWithoutArticle = (result?.activeItems || []).filter((i) => i.article == null);

    logger.info(`Summary: ${itemsWithArticle.length} articles populated, ${itemsWithoutArticle.length} null (orphaned refs)`);

    if (itemsWithArticle.length > 0) {
      logger.info('\n✅ Article data present:');
      itemsWithArticle.forEach((i, idx) => {
        logger.info(`   [${idx}] articleNumber: ${i.article?.articleNumber}, orderNumber: ${i.article?.orderId?.orderNumber}`);
      });
    }
    if (itemsWithoutArticle.length > 0) {
      logger.info('\n⚠️  Orphaned refs (article deleted):');
      itemsWithoutArticle.forEach((i, idx) => {
        logger.info(`   [${idx}] articleId: ${i.articleId} - run with --fix to replace with valid article`);
      });
    }
  } catch (error) {
    logger.error('Script failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    logger.info('\nDisconnected.');
  }
};

run();
