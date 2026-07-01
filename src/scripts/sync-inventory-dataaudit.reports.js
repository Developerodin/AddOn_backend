/**
 * Write DATAAUDIT inventory sync reports (CSV + XLSX).
 * @module sync-inventory-dataaudit.reports
 */

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

/** Statuses that belong in the mismatch workbook. */
const MISMATCH_STATUSES = new Set([
  'not_found',
  'rack_not_in_system',
  'rack_zone_mismatch',
  'skip_bad_status',
  'skip_invalid_weight',
  'skip_returned_to_vendor',
  'error',
]);

/**
 * @param {unknown} v
 * @returns {string}
 */
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Converts array of plain objects to CSV string.
 * @param {object[]} rows
 * @returns {string}
 */
export function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(',')),
  ].join('\n');
}

/**
 * Flattens a sync row result for CSV export.
 * @param {import('./sync-inventory-dataaudit.apply.js').SyncRowResult} r
 * @returns {Record<string, unknown>}
 */
export function flattenSyncResult(r) {
  const before = /** @type {Record<string, unknown>} */ (r.before || {});
  const after = /** @type {Record<string, unknown>} */ (r.after || {});
  return {
    entityType: r.entityType,
    rowIndex: r.rowIndex,
    barcode: r.barcode,
    status: r.status,
    rackIssue: r.rackIssue ?? '',
    message: r.message ?? '',
    docId: r.docId ?? '',
    boxId: r.boxId ?? '',
    poNumber: r.poNumber ?? '',
    yarnName: r.yarnName ?? '',
    beforeGrossWeight: before.grossWeight ?? before.coneWeight ?? before.boxWeight ?? '',
    beforeNetWeight: before.netWeight ?? '',
    beforeLocation: before.coneStorageId ?? before.storageLocation ?? '',
    afterGrossWeight: after.grossWeight ?? after.coneWeight ?? after.boxWeight ?? '',
    afterNetWeight: after.netWeight ?? '',
    afterLocation: after.coneStorageId ?? after.storageLocation ?? '',
    beforeIssueStatus: before.issueStatus ?? '',
    beforeNumberOfCones: before.numberOfCones ?? '',
    afterNumberOfCones: after.numberOfCones ?? '',
  };
}

/**
 * Returns true when a sync result should appear in audit-mismatches.xlsx.
 * @param {import('./sync-inventory-dataaudit.apply.js').SyncRowResult} r
 * @returns {boolean}
 */
export function isMismatchRow(r) {
  if (r.rackIssue) return true;
  return MISMATCH_STATUSES.has(r.status);
}

/**
 * Writes a single-sheet .xlsx file.
 * @param {string} filePath
 * @param {string} sheetName
 * @param {object[]} rows
 */
export function writeXlsx(filePath, sheetName, rows) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: 'No rows' }]);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filePath);
}

/**
 * Ensures output directory exists.
 * @param {string} outDir
 */
export function ensureOutDir(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
}

/**
 * Writes all DATAAUDIT sync report files.
 * @param {string} outDir
 * @param {import('./sync-inventory-dataaudit.apply.js').SyncRowResult[]} allResults
 * @param {object[]} conesNotInExcel
 * @param {object[]} boxesNotInExcel
 * @returns {{ syncReportPath: string, mismatchPath: string, conesNotInExcelPath: string, boxesNotInExcelPath: string }}
 */
export function writeAllReports(outDir, allResults, conesNotInExcel, boxesNotInExcel) {
  ensureOutDir(outDir);

  const flatRows = allResults.map(flattenSyncResult);
  const syncReportPath = path.join(outDir, 'sync-update-report.csv');
  fs.writeFileSync(syncReportPath, toCsv(flatRows), 'utf8');

  const mismatchRows = allResults.filter(isMismatchRow).map(flattenSyncResult);
  const mismatchPath = path.join(outDir, 'audit-mismatches.xlsx');
  writeXlsx(mismatchPath, 'Mismatches', mismatchRows);

  const conesNotInExcelPath = path.join(outDir, 'cones-not-in-excel.xlsx');
  writeXlsx(conesNotInExcelPath, 'ConesNotInExcel', conesNotInExcel);

  const boxesNotInExcelPath = path.join(outDir, 'boxes-not-in-excel.xlsx');
  writeXlsx(boxesNotInExcelPath, 'BoxesNotInExcel', boxesNotInExcel);

  return { syncReportPath, mismatchPath, conesNotInExcelPath, boxesNotInExcelPath };
}
