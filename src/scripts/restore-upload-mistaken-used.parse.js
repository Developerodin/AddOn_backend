/**
 * Parse "For check upload data" Excel — cones/boxes mistakenly marked used.
 * @module restore-upload-mistaken-used.parse
 */

import fs from 'fs';
import XLSX from 'xlsx';
import {
  normalizeHeaderKey,
  parseWeightCell,
  parseConeCountCell,
  markDuplicateBarcodes,
} from './sync-inventory-dataaudit.parse.js';

/** @typedef {import('./sync-inventory-dataaudit.parse.js').ParsedConeRow} ParsedConeRow */

/**
 * @typedef {Object} ParsedUploadBoxRow
 * @property {number} rowIndex
 * @property {string} boxId
 * @property {string} barcode
 * @property {string} rackCode
 * @property {number|null} netWeight
 * @property {number|null} grossWeight
 * @property {number|null} tearWeight
 * @property {number|null} numberOfCones
 * @property {string} [remarks]
 * @property {boolean} [isDup]
 */

const DEFAULT_CONE_SHEET = 'Cones given upload showing used';
const DEFAULT_BOX_SHEET = 'Bags showing additional';

/**
 * Reads gross weight from cone row (handles leading space in header).
 * @param {Record<string, string>} norm
 * @returns {number|null}
 */
function parseConeGrossCell(norm) {
  return parseWeightCell(
    norm[' gross weight'] || norm['gross weight'] || norm.grossweight
  );
}

/**
 * Parses cone rows from the upload-check workbook.
 * @param {string} filePath
 * @param {string} [sheetName]
 * @returns {ParsedConeRow[]}
 */
export function parseUploadConeSheet(filePath, sheetName = DEFAULT_CONE_SHEET) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }
  const wb = XLSX.readFile(filePath);
  const label = sheetName || wb.SheetNames.find((n) => /cone/i.test(n)) || wb.SheetNames[0];
  const sheet = wb.Sheets[label];
  if (!sheet) {
    throw new Error(`Sheet not found: "${label}". Available: ${wb.SheetNames.join(', ')}`);
  }

  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
  /** @type {ParsedConeRow[]} */
  const rows = rawRows.map((row, idx) => {
    /** @type {Record<string, string>} */
    const norm = {};
    for (const [k, v] of Object.entries(row)) {
      norm[normalizeHeaderKey(k)] = v == null ? '' : String(v).trim();
    }
    return {
      rowIndex: idx + 2,
      barcode:
        norm['cone barcode'] || norm.barcode || norm['yarn cone barcode'] || '',
      rackCode: norm['rack code'] || norm.rackcode || norm['storage location'] || '',
      netWeight: parseWeightCell(norm['net weight'] || norm.netweight),
      grossWeight: parseConeGrossCell(norm),
    };
  });

  return markDuplicateBarcodes(rows);
}

/**
 * Finds the header row index containing Box ID / Barcode columns.
 * @param {unknown[][]} matrix
 * @returns {number}
 */
function findBoxHeaderRowIndex(matrix) {
  for (let i = 0; i < Math.min(matrix.length, 5); i += 1) {
    const line = matrix[i] || [];
    const cells = line.map((c) => normalizeHeaderKey(c));
    if (cells.includes('box id') && cells.includes('barcode')) return i;
  }
  return 0;
}

/**
 * Maps header cells array to field keys for the box sheet.
 * @param {unknown[]} headerCells
 * @returns {string[]}
 */
function mapBoxHeaderCells(headerCells) {
  return headerCells.map((val) => {
    const h = normalizeHeaderKey(val);
    if (h === 'box id') return 'boxId';
    if (h === 'barcode') return 'barcode';
    if (h.includes('gross weight')) return 'grossWeight';
    if (h.includes('net weight')) return 'netWeight';
    if (h.includes('tear weight')) return 'tearWeight';
    if (h.includes('number of cones')) return 'numberOfCones';
    if (h === 'rack code') return 'rackCode';
    if (h.includes('remarks')) return 'remarks';
    return '';
  });
}

/**
 * Parses box rows from the upload-check workbook (header row + data).
 * @param {string} filePath
 * @param {string} [sheetName]
 * @returns {ParsedUploadBoxRow[]}
 */
export function parseUploadBoxSheet(filePath, sheetName = DEFAULT_BOX_SHEET) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }
  const wb = XLSX.readFile(filePath);
  const label = sheetName || wb.SheetNames.find((n) => /bag|box/i.test(n)) || wb.SheetNames[1];
  const sheet = wb.Sheets[label];
  if (!sheet) {
    throw new Error(`Sheet not found: "${label}". Available: ${wb.SheetNames.join(', ')}`);
  }

  const matrix = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, header: 1 });
  if (matrix.length < 2) return [];

  const headerIdx = findBoxHeaderRowIndex(/** @type {unknown[][]} */ (matrix));
  const headerCells = /** @type {unknown[]} */ (matrix[headerIdx]);
  const fields = mapBoxHeaderCells(headerCells);

  /** @type {ParsedUploadBoxRow[]} */
  const rows = [];
  for (let i = headerIdx + 1; i < matrix.length; i += 1) {
    const line = /** @type {unknown[]} */ (matrix[i]);
    /** @type {Record<string, string>} */
    const raw = {};
    fields.forEach((field, colIdx) => {
      if (!field) return;
      raw[field] = line[colIdx] == null ? '' : String(line[colIdx]).trim();
    });

    const boxId = raw.boxId || '';
    const barcode = raw.barcode || '';
    if (!boxId && !barcode) continue;

    rows.push({
      rowIndex: i + 1,
      boxId,
      barcode,
      rackCode: raw.rackCode || '',
      grossWeight: parseWeightCell(raw.grossWeight),
      netWeight: parseWeightCell(raw.netWeight),
      tearWeight: parseWeightCell(raw.tearWeight),
      numberOfCones: parseConeCountCell(raw.numberOfCones),
      remarks: raw.remarks || '',
    });
  }

  const seen = new Set();
  return rows.map((row) => {
    const key = row.barcode || row.boxId;
    if (!key) return row;
    if (seen.has(key)) return { ...row, isDup: true };
    seen.add(key);
    return row;
  });
}

/**
 * Parses both sheets from the upload-check workbook.
 * @param {string} filePath
 * @returns {{ coneRows: ParsedConeRow[], boxRows: ParsedUploadBoxRow[] }}
 */
export function parseUploadWorkbook(filePath) {
  return {
    coneRows: parseUploadConeSheet(filePath),
    boxRows: parseUploadBoxSheet(filePath),
  };
}
