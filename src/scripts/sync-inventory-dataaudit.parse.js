/**
 * Parse DATAAUDIT cone/box Excel files for inventory sync.
 * @module sync-inventory-dataaudit.parse
 */

import fs from 'fs';
import XLSX from 'xlsx';

/** @typedef {'cone' | 'box'} DataAuditEntityType */

/**
 * @typedef {Object} ParsedConeRow
 * @property {number} rowIndex - 1-based Excel data row
 * @property {string} barcode
 * @property {string} rackCode
 * @property {number|null} netWeight - from Excel when present
 * @property {number|null} grossWeight
 * @property {boolean} [isDup]
 */

/**
 * @typedef {Object} ParsedBoxRow
 * @property {number} rowIndex
 * @property {string} barcode
 * @property {string} rackCode
 * @property {number|null} netWeight
 * @property {number|null} grossWeight
 * @property {number|null} numberOfCones
 * @property {boolean} [isDup]
 */

/**
 * Normalizes Excel header keys (trim, lowercase, collapse spaces).
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeHeaderKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Parses a numeric cell; empty string → null.
 * @param {unknown} raw
 * @returns {number|null}
 */
export function parseWeightCell(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses integer cone count cell.
 * @param {unknown} raw
 * @returns {number|null}
 */
export function parseConeCountCell(raw) {
  const n = parseWeightCell(raw);
  if (n == null) return null;
  return Number.isInteger(n) ? n : Math.round(n);
}

/**
 * Loads a worksheet from an .xlsx file.
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
 * Reads raw JSON rows from a sheet starting at header row 1.
 * @param {import('xlsx').WorkSheet} sheet
 * @param {number} [headerExcelRow=1]
 * @returns {Record<string, unknown>[]}
 */
export function sheetToNormalizedRows(sheet, headerExcelRow = 1) {
  const json = XLSX.utils.sheet_to_json(sheet, {
    defval: null,
    raw: false,
    range: headerExcelRow - 1,
  });
  return json.map((row) => {
    /** @type {Record<string, string>} */
    const norm = {};
    for (const [k, v] of Object.entries(row)) {
      norm[normalizeHeaderKey(k)] = v == null ? '' : String(v).trim();
    }
    return norm;
  });
}

/**
 * Marks duplicate barcodes within a parsed row list (first occurrence kept).
 * @template {{ barcode: string, isDup?: boolean }} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function markDuplicateBarcodes(rows) {
  const seen = new Set();
  return rows.map((row) => {
    const b = String(row.barcode || '').trim();
    if (!b) return row;
    if (seen.has(b)) {
      return { ...row, isDup: true };
    }
    seen.add(b);
    return row;
  });
}

/**
 * Parses cone rows from DATAAUDIT Cone-Temp xlsx.
 * @param {string} filePath
 * @param {string|null} [sheetName]
 * @param {number} [headerExcelRow=1]
 * @returns {ParsedConeRow[]}
 */
export function parseConeExcel(filePath, sheetName = null, headerExcelRow = 1) {
  const { sheet } = loadWorksheet(filePath, sheetName);
  const rawRows = sheetToNormalizedRows(sheet, headerExcelRow);
  const firstDataRow = headerExcelRow + 1;

  /** @type {ParsedConeRow[]} */
  const rows = rawRows.map((norm, idx) => ({
    rowIndex: firstDataRow + idx,
    barcode:
      norm['cone barcode'] ||
      norm.barcode ||
      norm['yarn cone barcode'] ||
      '',
    rackCode: norm['rack code'] || norm.rackcode || norm['storage location'] || '',
    netWeight: parseWeightCell(norm['net weight'] || norm.netweight),
    grossWeight: parseWeightCell(norm['gross weight'] || norm.grossweight),
  }));

  return markDuplicateBarcodes(rows);
}

/**
 * Parses box rows from DATAAUDIT Box-Temp xlsx.
 * @param {string} filePath
 * @param {string|null} [sheetName]
 * @param {number} [headerExcelRow=1]
 * @returns {ParsedBoxRow[]}
 */
export function parseBoxExcel(filePath, sheetName = null, headerExcelRow = 1) {
  const { sheet } = loadWorksheet(filePath, sheetName);
  const rawRows = sheetToNormalizedRows(sheet, headerExcelRow);
  const firstDataRow = headerExcelRow + 1;

  /** @type {ParsedBoxRow[]} */
  const rows = rawRows.map((norm, idx) => ({
    rowIndex: firstDataRow + idx,
    barcode:
      norm['box barcode'] ||
      norm.barcode ||
      norm['yarn box barcode'] ||
      '',
    rackCode: norm['rack code'] || norm.rackcode || norm['storage location'] || '',
    netWeight: parseWeightCell(norm['net weight'] || norm.netweight),
    grossWeight: parseWeightCell(norm['gross weight'] || norm.grossweight),
    numberOfCones: parseConeCountCell(
      norm['number of cones'] || norm['number of cone'] || norm.numberofcones
    ),
  }));

  return markDuplicateBarcodes(rows);
}

/**
 * Collects unique non-empty barcodes from parsed rows.
 * @param {Array<{ barcode: string, isDup?: boolean }>} rows
 * @returns {Set<string>}
 */
export function collectUniqueBarcodes(rows) {
  const set = new Set();
  for (const row of rows) {
    const b = String(row.barcode || '').trim();
    if (b && !row.isDup) set.add(b);
  }
  return set;
}
