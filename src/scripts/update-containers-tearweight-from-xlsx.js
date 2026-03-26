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
import { execFileSync } from 'child_process';
import mongoose from 'mongoose';
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

async function loadRawRowsFromXlsx(filePath) {
  // Primary path: use xlsx package if available on this machine.
  try {
    const xlsx = await import('xlsx');
    const workbook = xlsx.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = workbook.Sheets[firstSheetName];
    return xlsx.utils.sheet_to_json(firstSheet, { header: 1, raw: false });
  } catch (error) {
    logger.warn('xlsx package not found. Falling back to Python parser.');
  }

  // Fallback path: Python stdlib parser (no pip install needed).
  const pyScript = `
import json, zipfile, xml.etree.ElementTree as ET
path = ${JSON.stringify(filePath)}
ns = {'a':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(path) as z:
    sst=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        root=ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall('a:si', ns):
            sst.append(''.join((t.text or '') for t in si.findall('.//a:t', ns)))
    sheet=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    out=[]
    for row in sheet.findall('.//a:sheetData/a:row', ns):
        vals=[]
        for c in row.findall('a:c', ns):
            t=c.attrib.get('t')
            v=c.find('a:v', ns)
            if v is None:
                vals.append('')
            else:
                val=v.text or ''
                if t=='s':
                    idx=int(val) if val.isdigit() else 0
                    val=sst[idx] if idx < len(sst) else ''
                vals.append(val)
        out.append(vals)
print(json.dumps(out))
`;

  const output = execFileSync('python3', ['-c', pyScript], { encoding: 'utf8' });
  return JSON.parse(output);
}

async function run() {
  if (!fs.existsSync(XLSX_PATH)) {
    throw new Error(`XLSX file not found: ${XLSX_PATH}`);
  }

  logger.info(`Reading XLSX: ${XLSX_PATH}`);
  const rawRows = await loadRawRowsFromXlsx(XLSX_PATH);
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
