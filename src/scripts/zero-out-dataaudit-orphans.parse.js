/**
 * Parse barcode lists from DATAAUDIT not-in-excel xlsx exports.
 * @module zero-out-dataaudit-orphans.parse
 */

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

/** @typedef {{ barcode: string, boxId: string, rowIndex: number }} ParsedOrphanRow */

const CONE_BARCODE_KEYS = ['barcode', 'cone barcode', 'cone barcode id', 'yarn cone barcode'];
const BOX_BARCODE_KEYS = ['barcode', 'box barcode', 'yarn box barcode'];
const BOX_ID_KEYS = ['box id', 'boxid', 'box_id', 'yarn box id'];

/**
 * Loads a worksheet from an xlsx file.
 * @param {string} filePath
 * @param {string|null} [sheetName]
 * @returns {{ sheet: import('xlsx').WorkSheet, sheetLabel: string }}
 */
export function loadWorksheet(filePath, sheetName = null) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }
  const wb = XLSX.readFile(filePath);
  const sheetLabel = sheetName || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetLabel];
  if (!sheet) {
    throw new Error(`Sheet not found: "${sheetLabel}". Available: ${wb.SheetNames.join(', ')}`);
  }
  return { sheet, sheetLabel };
}

/**
 * Detects the 1-based Excel header row containing barcode / box id columns.
 * @param {import('xlsx').WorkSheet} sheet
 * @param {'cone' | 'box'} entityType
 * @param {number} [maxScan=20]
 * @returns {number|null}
 */
export function detectHeaderExcelRow(sheet, entityType, maxScan = 20) {
  for (let hr = 1; hr <= maxScan; hr += 1) {
    const json = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, range: hr - 1 });
    if (!json.length) continue;
    const keys = Object.keys(json[0]).map((k) => String(k).trim().toLowerCase());
    const set = new Set(keys);
    const hasBarcode = (entityType === 'cone' ? CONE_BARCODE_KEYS : BOX_BARCODE_KEYS).some((k) =>
      set.has(k)
    );
    const hasBoxId = entityType === 'box' && BOX_ID_KEYS.some((k) => set.has(k));
    if (hasBarcode || hasBoxId) return hr;
  }
  return 1;
}

/**
 * Normalizes a raw sheet row to lowercase keys.
 * @param {Record<string, unknown>} row
 * @returns {Record<string, string>}
 */
function normalizeRow(row) {
  /** @type {Record<string, string>} */
  const norm = {};
  for (const [k, v] of Object.entries(row)) {
    norm[String(k).trim().toLowerCase()] = v == null ? '' : String(v).trim();
  }
  return norm;
}

/**
 * Reads barcode rows from a not-in-excel xlsx export.
 * @param {string} filePath
 * @param {'cone' | 'box'} entityType
 * @param {string|null} [sheetName]
 * @returns {ParsedOrphanRow[]}
 */
export function parseOrphanXlsx(filePath, entityType, sheetName = null) {
  const { sheet } = loadWorksheet(filePath, sheetName);
  const headerRow = detectHeaderExcelRow(sheet, entityType);
  const opts = { defval: null, raw: false, range: headerRow - 1 };
  const json = XLSX.utils.sheet_to_json(sheet, opts);
  const firstDataRow = headerRow + 1;

  return json.map((row, idx) => {
    const norm = normalizeRow(row);
    const barcodeKeys = entityType === 'cone' ? CONE_BARCODE_KEYS : BOX_BARCODE_KEYS;
    let barcode = '';
    for (const k of barcodeKeys) {
      if (norm[k]) {
        barcode = norm[k];
        break;
      }
    }
    let boxId = '';
    if (entityType === 'box') {
      for (const k of BOX_ID_KEYS) {
        if (norm[k]) {
          boxId = norm[k];
          break;
        }
      }
    }
    return { rowIndex: firstDataRow + idx, barcode, boxId };
  });
}

/**
 * Deduplicates rows by barcode (first occurrence wins).
 * @param {ParsedOrphanRow[]} rows
 * @returns {{ unique: ParsedOrphanRow[], duplicateCount: number }}
 */
export function dedupeOrphanRows(rows) {
  const seen = new Set();
  /** @type {ParsedOrphanRow[]} */
  const unique = [];
  let duplicateCount = 0;
  for (const row of rows) {
    const key = row.barcode || row.boxId;
    if (!key) {
      unique.push(row);
      continue;
    }
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }
  return { unique, duplicateCount };
}

/**
 * Finds the most recently modified dataaudit-sync report directory under reports/.
 * @param {string} [reportsRoot='reports']
 * @returns {string|null}
 */
export function findLatestSyncReportDir(reportsRoot = 'reports') {
  const absRoot = path.resolve(process.cwd(), reportsRoot);
  if (!fs.existsSync(absRoot)) return null;

  /** @type {{ dir: string, mtime: number }[]} */
  const candidates = [];
  for (const name of fs.readdirSync(absRoot)) {
    if (!name.startsWith('dataaudit-sync')) continue;
    const dir = path.join(absRoot, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const coneFile = path.join(dir, 'cones-not-in-excel.xlsx');
    const boxFile = path.join(dir, 'boxes-not-in-excel.xlsx');
    if (!fs.existsSync(coneFile) && !fs.existsSync(boxFile)) continue;
    candidates.push({ dir, mtime: fs.statSync(dir).mtimeMs });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].dir;
}

/**
 * Resolves cone/box xlsx paths from CLI args or latest sync dir.
 * @param {{ fromSyncDir: string|null, conesFile: string|null, boxesFile: string|null }} opts
 * @returns {{ conesFile: string|null, boxesFile: string|null, syncDirUsed: string|null }}
 */
export function resolveInputFiles(opts) {
  const syncDir =
    opts.fromSyncDir != null
      ? path.resolve(process.cwd(), opts.fromSyncDir)
      : findLatestSyncReportDir();

  if (opts.conesFile) {
    return {
      conesFile: path.resolve(process.cwd(), opts.conesFile),
      boxesFile: opts.boxesFile ? path.resolve(process.cwd(), opts.boxesFile) : null,
      syncDirUsed: syncDir,
    };
  }

  if (!syncDir) {
    return { conesFile: null, boxesFile: null, syncDirUsed: null };
  }

  const conesPath = path.join(syncDir, 'cones-not-in-excel.xlsx');
  const boxesPath = path.join(syncDir, 'boxes-not-in-excel.xlsx');
  return {
    conesFile: fs.existsSync(conesPath) ? conesPath : null,
    boxesFile: fs.existsSync(boxesPath) ? boxesPath : null,
    syncDirUsed: syncDir,
  };
}
