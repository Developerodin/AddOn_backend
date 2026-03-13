#!/usr/bin/env node

/**
 * Clears all YarnTransaction records from the database.
 *
 * Usage:
 *   node src/scripts/clear-yarn-transactions.js
 *   node src/scripts/clear-yarn-transactions.js --dry-run
 *   node src/scripts/clear-yarn-transactions.js --type=yarn_issued
 *
 * Options:
 *   --dry-run    Show count and what would be deleted, no actual delete
 *   --type=TYPE  Only delete transactions of given type (yarn_issued, yarn_blocked, yarn_stocked, internal_transfer, yarn_returned)
 */

import mongoose from 'mongoose';
import { YarnTransaction } from '../models/index.js';
import { yarnTransactionTypes } from '../models/yarnReq/yarnTransaction.model.js';
import config from '../config/config.js';
import logger from '../config/logger.js';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const typeArg = args.find((a) => a.startsWith('--type='));
const typeFilter = typeArg ? typeArg.split('=')[1]?.trim() : null;

if (typeFilter && !yarnTransactionTypes.includes(typeFilter)) {
  logger.error(`Invalid type: ${typeFilter}. Valid: ${yarnTransactionTypes.join(', ')}`);
  process.exit(1);
}

async function run() {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    if (isDryRun) logger.info('DRY RUN – no deletes will be performed');

    const query = typeFilter ? { transactionType: typeFilter } : {};
    const count = await YarnTransaction.countDocuments(query);
    logger.info(`Found ${count} yarn transaction(s)${typeFilter ? ` of type ${typeFilter}` : ''}.`);

    if (count === 0) {
      logger.info('Nothing to clear.');
      return;
    }

    if (!isDryRun) {
      const result = await YarnTransaction.deleteMany(query);
      logger.info(`Deleted ${result.deletedCount} yarn transaction(s).`);
    }

    logger.info('Done.');
  } catch (error) {
    logger.error('Script failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
