#!/usr/bin/env node

/**
 * Update ContainersMaster.tearWeight by barcode from XLSX.
 *
 * Source file format (sheet1):
 * - Column A: Barcode
 * - Column B: Weight in kg
 *
 * Run:
 *   node src/scripts/update-containers-tearweight-from-xlsx.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import xlsx from 'xlsx';
import config from '../config/config.js';
import logger from '../config/logger.js';
import ContainersMaster from '../models/production/containersMaster.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const XLSX_PATH = path.resolve(__dirname, '../models/production/Container Weight.xlsx');

function normalizeRows(rawRows) {
  if (!rawRows.length) return [];
  const body = rawRows.slice(1);

  return body
    .map((row) => {
      const barcode = (row[0] || '').toString().trim();
      const weightRaw = (row[1] || '').toString().trim();
      const tearWeight = Number(weightRaw);
      return { barcode, tearWeight };
    })
    .filter((row) => row.barcode && Number.isFinite(row.tearWeight) && row.tearWeight >= 0);
}

async function run() {
  if (!fs.existsSync(XLSX_PATH)) {
    throw new Error(`XLSX file not found: ${XLSX_PATH}`);
  }

  logger.info(`Reading XLSX: ${XLSX_PATH}`);
  const workbook = xlsx.readFile(XLSX_PATH);
  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = workbook.Sheets[firstSheetName];
  const rawRows = xlsx.utils.sheet_to_json(firstSheet, { header: 1, raw: false });
  const rows = normalizeRows(rawRows);

  logger.info(`Loaded ${rows.length} valid rows from XLSX`);
  if (!rows.length) {
    logger.warn('No valid barcode/weight rows found. Nothing to update.');
    return;
  }

  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  logger.info('Connected to MongoDB');

  let matched = 0;
  let modified = 0;
  let missing = 0;

  const bulkOps = rows.map(({ barcode, tearWeight }) => ({
    updateOne: {
      filter: { barcode },
      update: { $set: { tearWeight } },
    },
  }));

  const result = await ContainersMaster.bulkWrite(bulkOps, { ordered: false });
  matched = result.matchedCount || 0;
  modified = result.modifiedCount || 0;
  missing = rows.length - matched;

  logger.info(`Rows: ${rows.length}`);
  logger.info(`Matched: ${matched}`);
  logger.info(`Updated: ${modified}`);
  logger.info(`Missing barcodes: ${missing}`);
}

run()
  .catch((error) => {
    logger.error('Failed to update container tearWeight from XLSX:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      logger.info('MongoDB disconnected');
    }
  });
