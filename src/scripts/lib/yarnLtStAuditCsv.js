import fs from 'fs';

/** @type {readonly string[]} */
export const LT_ST_AUDIT_CSV_HEADERS = [
  'boxId',
  'barcode',
  'poNumber',
  'yarnName',
  'longTermRackBarcode',
  'storedStatus',
  'boxWeightKg_onLT',
  'initialBoxWeightKg',
  'numberOfCones_onBox',
  'delta_shortTermActiveCones_minus_boxNumberOfCones',
  'shortTerm_activeConeCount',
  'shortTerm_activeCones_grossKg',
  'shortTerm_activeCones_netKg',
  'issuedConeCount_inactiveUsed',
  'totalConeCount_activePlusIssued',
  'shortTerm_rackBarcodes',
  'conesAnySlot_grossKg',
  'expectedRemainingBoxGrossKg',
  'delta_boxWeight_minus_expectedKg',
  'flag_doubleCountRisk',
  'flag_weightInconsistent',
  'flag_fullyTransferredButLtFieldsDirty',
];

/**
 * RFC 4180-style CSV field escaping for Excel.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeCsvField(value) {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * @param {unknown[]} cells
 * @returns {string}
 */
export function formatCsvLine(cells) {
  return `${cells.map(escapeCsvField).join(',')}\n`;
}

/**
 * @param {string} filePath
 * @returns {fs.WriteStream}
 */
export function createCsvWriteStream(filePath) {
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  stream.write('\ufeff');
  stream.write(formatCsvLine([...LT_ST_AUDIT_CSV_HEADERS]));
  return stream;
}
