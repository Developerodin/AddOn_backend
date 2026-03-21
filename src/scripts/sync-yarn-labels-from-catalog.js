#!/usr/bin/env node
/**
 * Refresh denormalized yarnName from YarnCatalog (CLI).
 * Same logic as API-triggered sync: yarnLabelSyncFromCatalog.service.js
 *
 *   node src/scripts/sync-yarn-labels-from-catalog.js [--dry-run]
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { syncAllDenormalizedYarnLabelsFromCatalog } from '../services/yarnManagement/yarnLabelSyncFromCatalog.service.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  await mongoose.connect(config.mongoose.url);
  const result = await syncAllDenormalizedYarnLabelsFromCatalog({ dryRun: DRY_RUN });
  logger.info(
    `sync-yarn-labels-from-catalog ${DRY_RUN ? '(dry-run) ' : ''}totalUpdates=${result.totalUpdates} byCollection=${JSON.stringify(result.byCollection)}`
  );
  console.log(JSON.stringify({ dryRun: DRY_RUN, ...result }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
