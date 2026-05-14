/**
 * XLSX helpers for `report-cone-issue-from-xlsx.js`: find header rows with notes above data,
 * detect columns like `CONE ID05`, extract cone keys (barcodes or ObjectIds).
 */

import XLSX from 'xlsx';
import logger from '../config/logger.js';

/**
 * Normalises sheet header text for fuzzy matching.
 * @param {string} k
 * @returns {string}
 */
export function normalizeHeaderKey(k) {
  return String(k ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Header cell score for "cone id" / barcode columns (`CONE ID05`, etc.). Long note rows score 0.
 * @param {unknown} cell
 * @returns {number}
 */
export function scoreConeColumnHeader(cell) {
  const s = String(cell ?? '').trim();
  if (!s || s.length > 72) return 0;
  const n = normalizeHeaderKey(s);
  if (/^coneid\d+$/.test(n)) return 100;
  const preferred = ['conesid', 'coneid', 'cones_id', 'cone_id', 'yarnconeid', 'mongodbid'];
  if (preferred.includes(n)) return 99;
  if (n === 'barcode' || n === 'conebarcode') return 95;
  if (n.includes('cone') && n.includes('id') && s.length <= 56) return 88;
  if (n === '_id' || n === 'id') return 40;
  return 0;
}

/**
 * Best column index on a header row for cone id / barcode.
 * @param {unknown[]} headerRow
 * @returns {number}
 */
export function pickConeColumnIndexFromHeaderRow(headerRow) {
  const row = headerRow || [];
  let best = -1;
  let bestScore = 0;
  for (let c = 0; c < row.length; c++) {
    const sc = scoreConeColumnHeader(row[c]);
    if (sc > bestScore) {
      bestScore = sc;
      best = c;
    }
  }
  return bestScore >= 70 ? best : -1;
}

/**
 * Finds header row index (0-based) and cone/barcode column index by scanning the grid.
 * @param {unknown[][]} aoa
 * @returns {{ headerRow0: number, colIndex: number, headerLabel: string }}
 */
export function autoDetectHeaderRowAndColumn(aoa) {
  let best = { score: -1, r: -1, c: -1 };
  const maxR = Math.min(aoa.length, 120);
  for (let r = 0; r < maxR; r++) {
    const row = aoa[r] || [];
    for (let c = 0; c < row.length; c++) {
      const sc = scoreConeColumnHeader(row[c]);
      if (sc > best.score) {
        best = { score: sc, r, c };
      }
    }
  }
  if (best.score < 70 || best.r < 0 || best.c < 0) {
    throw new Error(
      'Could not find a cone/barcode header cell (e.g. CONE ID05). Try --header-row=<1-based Excel row> --column="CONE ID05"'
    );
  }
  const label = String((aoa[best.r] || [])[best.c] ?? '').trim();
  return { headerRow0: best.r, colIndex: best.c, headerLabel: label };
}

/**
 * Resolves header row and column when Excel row number is known (1-based).
 * @param {unknown[][]} aoa
 * @param {number} headerRow1Based Excel-style row number for the header row.
 * @param {string | null} columnName Exact header text match (trimmed) when provided.
 * @returns {{ headerRow0: number, colIndex: number, headerLabel: string }}
 */
export function resolveHeaderRowAndColumnExplicit(aoa, headerRow1Based, columnName) {
  const headerRow0 = Math.max(0, Math.floor(Number(headerRow1Based)) - 1);
  const headerRow = aoa[headerRow0];
  if (!headerRow || headerRow.length === 0) {
    throw new Error(`Header row ${headerRow1Based} is empty or past sheet end.`);
  }
  let colIndex = -1;
  if (columnName && String(columnName).trim()) {
    const want = String(columnName).trim().toLowerCase();
    for (let c = 0; c < headerRow.length; c++) {
      if (String(headerRow[c] ?? '').trim().toLowerCase() === want) {
        colIndex = c;
        break;
      }
    }
    if (colIndex < 0) {
      throw new Error(`Column "${columnName}" not found on header row ${headerRow1Based}.`);
    }
  } else {
    colIndex = pickConeColumnIndexFromHeaderRow(headerRow);
    if (colIndex < 0) {
      throw new Error(
        `Could not infer cone column on row ${headerRow1Based}. Pass --column="CONE ID05" (exact header text).`
      );
    }
  }
  const headerLabel = String(headerRow[colIndex] ?? '').trim();
  return { headerRow0, colIndex, headerLabel };
}

/**
 * Reads sheet as array-of-arrays and extracts non-empty cell values under the cone/barcode column.
 * @param {string} filePath
 * @param {string | null} sheetName
 * @param {string | null} columnName Exact header when header row is known or implied.
 * @param {number | null} headerRow1Based Optional 1-based Excel row index for headers.
 * @returns {{ sheetUsed: string, headerRow1Based: number, columnLabel: string, keysInOrder: string[] }}
 */
export function parseConeKeysFromXlsx(filePath, sheetName, columnName, headerRow1Based) {
  const wb = XLSX.readFile(filePath);
  let name = wb.SheetNames[0];
  if (sheetName) {
    if (wb.SheetNames.includes(sheetName)) {
      name = sheetName;
    } else {
      logger.warn(
        `Sheet "${sheetName}" not found; available: ${wb.SheetNames.join(', ')}. Using "${name}".`
      );
    }
  }
  if (!name) {
    throw new Error('Workbook has no sheets.');
  }
  const sheet = wb.Sheets[name];
  if (!sheet) {
    throw new Error(`Sheet not found: ${name}`);
  }
  /** @type {unknown[][]} */
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!aoa.length) {
    return { sheetUsed: name, headerRow1Based: 0, columnLabel: '', keysInOrder: [] };
  }

  let headerRow0;
  let colIndex;
  let headerLabel;
  if (headerRow1Based != null && Number.isFinite(headerRow1Based) && headerRow1Based >= 1) {
    const resolved = resolveHeaderRowAndColumnExplicit(aoa, headerRow1Based, columnName);
    headerRow0 = resolved.headerRow0;
    colIndex = resolved.colIndex;
    headerLabel = resolved.headerLabel;
  } else if (columnName && String(columnName).trim()) {
    const want = String(columnName).trim().toLowerCase();
    let found = null;
    for (let r = 0; r < Math.min(aoa.length, 120); r++) {
      const row = aoa[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (String(row[c] ?? '').trim().toLowerCase() === want) {
          found = { headerRow0: r, colIndex: c, headerLabel: String(row[c]).trim() };
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      throw new Error(`Could not find column header "${columnName}" in first 120 rows.`);
    }
    headerRow0 = found.headerRow0;
    colIndex = found.colIndex;
    headerLabel = found.headerLabel;
  } else {
    const auto = autoDetectHeaderRowAndColumn(aoa);
    headerRow0 = auto.headerRow0;
    colIndex = auto.colIndex;
    headerLabel = auto.headerLabel;
  }

  /** @type {string[]} */
  const keysInOrder = [];
  const headerLower = String(headerLabel).trim().toLowerCase();
  for (let r = headerRow0 + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const v = String(row[colIndex] ?? '').trim();
    if (!v) continue;
    const lower = v.toLowerCase();
    if (lower === headerLower) continue;
    if (
      lower === 'cones id' ||
      lower === 'cone id' ||
      lower === '_id' ||
      lower === 'id' ||
      lower === 'barcode'
    ) {
      continue;
    }
    keysInOrder.push(v);
  }

  logger.info(
    `XLSX sheet "${name}", header row ${headerRow0 + 1} (1-based), column "${headerLabel}" (index ${colIndex})`
  );
  return {
    sheetUsed: name,
    headerRow1Based: headerRow0 + 1,
    columnLabel: headerLabel,
    keysInOrder,
  };
}
