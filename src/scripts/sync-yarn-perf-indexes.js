#!/usr/bin/env node
/**
 * Sync MongoDB indexes for yarn return / yarn issue performance paths.
 *
 * Usage (from AddOn_backend, MONGODB_URL in .env):
 *   NODE_ENV=production node src/scripts/sync-yarn-perf-indexes.js
 */

import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

import YarnTransaction from '../models/yarnReq/yarnTransaction.model.js';
import MachineOrderAssignment from '../models/production/machineOrderAssignment.model.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

const url = process.env.MONGODB_URL;
if (!url) {
  console.error('MONGODB_URL missing in .env');
  process.exit(1);
}

async function main() {
  await mongoose.connect(url);
  console.log('[sync-yarn-perf-indexes] connected');

  const yarnTxn = await YarnTransaction.syncIndexes();
  console.log('[YarnTransaction] syncIndexes:', yarnTxn);

  const moa = await MachineOrderAssignment.syncIndexes();
  console.log('[MachineOrderAssignment] syncIndexes:', moa);

  await mongoose.disconnect();
  console.log('[sync-yarn-perf-indexes] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});