/**
 * Write DATAAUDIT orphan zero-out reports.
 * @module zero-out-dataaudit-orphans.reports
 */

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

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
 * Ensures output directory exists.
 * @param {string} outDir
 */
export function ensureOutDir(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
}

/**
 * Writes a single-sheet xlsx file.
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
 * Flattens a cone result row for CSV export.
 * @param {Record<string, unknown>} r
 * @returns {Record<string, unknown>}
 */
export function flattenConeRow(r) {
  const before = /** @type {Record<string, unknown>} */ (r.before || {});
  const after = /** @type {Record<string, unknown>} */ (r.after || {});
  return {
    rowIndex: r.rowIndex ?? '',
    barcode: r.barcode ?? '',
    status: r.status ?? r.bucket ?? '',
    bucket: r.bucket ?? '',
    reason: r.reason ?? '',
    coneId: r.coneId ?? '',
    boxId: r.boxId ?? '',
    poNumber: r.poNumber ?? '',
    yarnName: r.yarnName ?? '',
    yarnCatalogId: r.yarnCatalogId ?? '',
    orderId: r.orderId ?? '',
    articleId: r.articleId ?? '',
    orderNumber: r.orderNumber ?? '',
    articleNumber: r.articleNumber ?? '',
    beforeIssueStatus: before.issueStatus ?? '',
    beforeConeWeight: before.coneWeight ?? '',
    beforeTearWeight: before.tearWeight ?? '',
    beforeConeStorageId: before.coneStorageId ?? '',
    afterIssueStatus: after.issueStatus ?? '',
    afterConeWeight: after.coneWeight ?? '',
    afterTearWeight: after.tearWeight ?? '',
    afterConeStorageId: after.coneStorageId ?? '',
    message: r.message ?? '',
  };
}

/**
 * Flattens a box result row for CSV export.
 * @param {Record<string, unknown>} r
 * @returns {Record<string, unknown>}
 */
export function flattenBoxRow(r) {
  const before = /** @type {Record<string, unknown>} */ (r.before || {});
  const after = /** @type {Record<string, unknown>} */ (r.after || {});
  return {
    rowIndex: r.rowIndex ?? '',
    barcode: r.barcode ?? '',
    boxId: r.boxId ?? '',
    status: r.status ?? r.bucket ?? '',
    bucket: r.bucket ?? '',
    reason: r.reason ?? '',
    docId: r.docId ?? '',
    poNumber: r.poNumber ?? '',
    yarnName: r.yarnName ?? '',
    yarnCatalogId: r.yarnCatalogId ?? '',
    beforeBoxWeight: before.boxWeight ?? '',
    beforeGrossWeight: before.grossWeight ?? '',
    beforeNumberOfCones: before.numberOfCones ?? '',
    beforeStorageLocation: before.storageLocation ?? '',
    beforeStoredStatus: before.storedStatus ?? '',
    afterBoxWeight: after.boxWeight ?? '',
    afterGrossWeight: after.grossWeight ?? '',
    afterNumberOfCones: after.numberOfCones ?? '',
    afterStorageLocation: after.storageLocation ?? '',
    afterStoredStatus: after.storedStatus ?? '',
    stConeCount: Array.isArray(r.stCones) ? r.stCones.length : '',
    issuedStConeCount: Array.isArray(r.issuedStCones) ? r.issuedStCones.length : '',
    message: r.message ?? '',
  };
}

/**
 * Expands lt_with_st_cones rows with one row per ST cone for the xlsx manual queue.
 * @param {Record<string, unknown>[]} boxResults
 * @returns {object[]}
 */
export function expandLtWithStConesRows(boxResults) {
  /** @type {object[]} */
  const expanded = [];
  for (const r of boxResults) {
    if (r.bucket !== 'lt_with_st_cones') continue;
    const stCones = /** @type {Array<{ barcode: string, issueStatus: string, coneWeight: number, coneStorageId: string }>} */ (
      r.stCones || []
    );
    if (!stCones.length) {
      expanded.push({
        boxBarcode: r.barcode,
        boxId: r.boxId,
        storageLocation: r.storageLocation,
        boxWeight: r.boxWeight,
        stConeBarcode: '',
        stConeWeight: '',
        stConeStorageId: '',
        note: 'LT box has ST cones but none listed',
      });
      continue;
    }
    for (const c of stCones) {
      expanded.push({
        boxBarcode: r.barcode,
        boxId: r.boxId,
        storageLocation: r.storageLocation,
        boxWeight: r.boxWeight,
        stConeBarcode: c.barcode,
        stConeWeight: c.coneWeight,
        stConeStorageId: c.coneStorageId,
        note: 'Manual cleanup: zero ST cones first, then re-run box zero-out',
      });
    }
  }
  return expanded;
}

/**
 * Writes all orphan zero-out report files.
 * @param {string} outDir
 * @param {Record<string, unknown>[]} coneResults
 * @param {Record<string, unknown>[]} boxResults
 * @param {Record<string, unknown>} summary
 * @returns {Record<string, string>}
 */
export function writeAllReports(outDir, coneResults, boxResults, summary) {
  ensureOutDir(outDir);

  const conesZeroed = coneResults
    .filter((r) => r.bucket === 'can_zero')
    .map(flattenConeRow);
  const conesBlockedIssued = coneResults
    .filter((r) => r.bucket === 'block_issued')
    .map(flattenConeRow);
  const conesBlockedOther = coneResults
    .filter((r) =>
      ['block_production_ref', 'block_returned_to_vendor', 'block_not_found', 'already_final'].includes(
        String(r.bucket)
      )
    )
    .map(flattenConeRow);

  const boxesZeroed = boxResults
    .filter(
      (r) =>
        r.bucket === 'can_zero' ||
        (r.bucket === 'lt_with_st_cones' && ['updated', 'would_update'].includes(String(r.status))) ||
        (r.bucket === 'block_issued_cones_on_box' &&
          ['updated', 'would_update'].includes(String(r.status)))
    )
    .map(flattenBoxRow);
  const boxesBlockedOther = boxResults
    .filter((r) => {
      if (['block_not_found', 'already_zeroed'].includes(String(r.bucket))) return true;
      if (r.bucket === 'block_issued_cones_on_box' && !['updated', 'would_update'].includes(String(r.status))) {
        return true;
      }
      if (r.bucket === 'lt_with_st_cones' && !['updated', 'would_update'].includes(String(r.status))) {
        return true;
      }
      return false;
    })
    .map(flattenBoxRow);
  const ltWithStCones = expandLtWithStConesRows(
    boxResults.filter((r) => !['updated', 'would_update'].includes(String(r.status)))
  );

  const conesErrors = coneResults.filter((r) => r.status === 'error').map(flattenConeRow);
  const boxesErrors = boxResults.filter((r) => r.status === 'error').map(flattenBoxRow);

  const paths = {
    conesZeroed: path.join(outDir, 'cones-zeroed.csv'),
    conesBlockedIssued: path.join(outDir, 'cones-blocked-issued.csv'),
    conesBlockedOther: path.join(outDir, 'cones-blocked-other.csv'),
    conesErrors: path.join(outDir, 'cones-apply-errors.csv'),
    boxesZeroed: path.join(outDir, 'boxes-zeroed.csv'),
    boxesLtWithStCones: path.join(outDir, 'boxes-lt-with-st-cones.xlsx'),
    boxesBlockedOther: path.join(outDir, 'boxes-blocked-other.csv'),
    boxesErrors: path.join(outDir, 'boxes-apply-errors.csv'),
    summary: path.join(outDir, 'summary.json'),
  };

  fs.writeFileSync(paths.conesZeroed, toCsv(conesZeroed.length ? conesZeroed : [{ note: 'No rows' }]), 'utf8');
  fs.writeFileSync(
    paths.conesBlockedIssued,
    toCsv(conesBlockedIssued.length ? conesBlockedIssued : [{ note: 'No rows' }]),
    'utf8'
  );
  fs.writeFileSync(
    paths.conesBlockedOther,
    toCsv(conesBlockedOther.length ? conesBlockedOther : [{ note: 'No rows' }]),
    'utf8'
  );
  fs.writeFileSync(
    paths.conesErrors,
    toCsv(conesErrors.length ? conesErrors : [{ note: 'No rows' }]),
    'utf8'
  );
  fs.writeFileSync(paths.boxesZeroed, toCsv(boxesZeroed.length ? boxesZeroed : [{ note: 'No rows' }]), 'utf8');
  writeXlsx(paths.boxesLtWithStCones, 'LtWithStCones', ltWithStCones);
  fs.writeFileSync(
    paths.boxesBlockedOther,
    toCsv(boxesBlockedOther.length ? boxesBlockedOther : [{ note: 'No rows' }]),
    'utf8'
  );
  fs.writeFileSync(
    paths.boxesErrors,
    toCsv(boxesErrors.length ? boxesErrors : [{ note: 'No rows' }]),
    'utf8'
  );
  fs.writeFileSync(paths.summary, JSON.stringify(summary, null, 2), 'utf8');

  return paths;
}
