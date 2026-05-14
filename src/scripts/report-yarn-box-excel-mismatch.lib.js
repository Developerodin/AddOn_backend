/**
 * Parsing + Mongo-backed audit helpers for {@link ../report-yarn-box-excel-mismatch.js}.
 * @module report-yarn-box-excel-mismatch.lib
 */

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { YarnBox, YarnCone, YarnPurchaseOrder } from '../models/index.js';
import { LT_SECTION_CODES } from '../models/storageManagement/storageSlot.model.js';
import {
  extractPoLotFromStructuredBoxId,
  findYarnBoxesByPoVendorLot,
  summarizeYarnAcrossBoxes,
  excelBarcodeInCluster,
} from './report-yarn-box-excel-mismatch.poLotCluster.js';
import { loadConeRemediationForSheetVsCluster } from './report-yarn-box-excel-mismatch-cone-rollups.lib.js';

/** @type {RegExp} */
const LT_STORAGE_PATTERN = new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i');

/**
 * Matches `ACTIVE_BOX_FILTER` in `yarnBox.service.js`.
 * @param {Record<string, unknown>} box
 * @returns {boolean}
 */
function isVisibleOnGetYarnBoxesApi(box) {
  const conesIssuedTrue = box?.coneData?.conesIssued === true;
  const hasPositiveWeight = Number(box?.boxWeight ?? 0) > 0;
  return !conesIssuedTrue || hasPositiveWeight;
}

/**
 * @param {unknown} v
 * @returns {number}
 */
function num(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {string} poFragment
 * @returns {string}
 */
function normalizePoToken(poFragment) {
  const m = String(poFragment || '').trim().match(/^(?:PO[-\s]?)(\d{4})[-\s]?(\d+)/i);
  if (!m) return String(poFragment || '').trim();
  return `PO-${m[1]}-${m[2]}`;
}

/**
 * @param {string} boxId
 * @returns {string|null}
 */
function extractPoNumberFromBoxId(boxId) {
  const s = String(boxId || '').trim();
  const m = s.match(/^BOX-(PO-\d{4}-\d+)/i);
  return m ? normalizePoToken(m[1]) : null;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeHeaderKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * @param {unknown[][]} matrix
 * @returns {{ sheetRows: Record<string,string>[] }}
 */
export function parsePrimaryBarcodeTable(matrix) {
  /** @type {Record<string,string>[]} */
  const sheetRows = [];
  let headerRowIdx = matrix.findIndex(
    (r) =>
      normalizeHeaderKey(Array.isArray(r) ? r[0] : '') === 'barcode' ||
      (Array.isArray(r) && String(r[0]).toLowerCase().includes('barcode'))
  );

  const headerGuess = normalizeHeaderKey(Array.isArray(matrix[1]) ? matrix[1][0] : '');
  if (headerRowIdx < 0 && headerGuess === 'barcode') headerRowIdx = 1;

  if (headerRowIdx < 0) {
    return { sheetRows };
  }

  const headerRow = Array.isArray(matrix[headerRowIdx]) ? matrix[headerRowIdx] : [];
  /** @type {string[]} */
  const labels = [];
  for (let c = 0; c < headerRow.length; c += 1) {
    labels[c] = normalizeHeaderKey(headerRow[c]);
    if (!labels[c]) labels[c] = `_col_${c}`;
  }

  for (let r = headerRowIdx + 1; r < matrix.length; r += 1) {
    const row = Array.isArray(matrix[r]) ? matrix[r] : [];
    let any = false;
    const obj = {};
    for (let c = 0; c < Math.max(labels.length, row.length); c += 1) {
      const key = labels[c] || `_col_${c}`;
      obj[key] = String(row[c] ?? '').trim();
      if (obj[key]) any = true;
    }
    const barcodeGuess = obj.barcode || obj._col_0 || '';
    if (!barcodeGuess && Object.keys(obj).length && !obj.brand?.length) continue;
    if (!any) continue;
    if (!barcodeGuess && !obj['box id'] && !obj.boxid && !obj['box id ']) continue;
    const boxKey = obj['box id'] || obj.boxid || obj['box id '] || '';
    if (!barcodeGuess.trim() && !boxKey.trim()) break;

    const oidLike = /^[a-f\d]{24}$/i.test(barcodeGuess.trim());
    const boxLooksRegistered = /^BOX-/i.test(boxKey.trim());
    if (!oidLike && !boxLooksRegistered) continue;

    sheetRows.push(obj);
  }

  return { sheetRows };
}

/**
 * @param {string} name
 * @param {string} def
 * @returns {string}
 */
export function readArg(name, def = '') {
  const p = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(p));
  if (!raw) return def;
  return raw.slice(p.length).trim();
}

/**
 * @param {string} barcodeFromSheet
 * @param {string} boxIdFromSheet
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function resolveYarnBoxFromSheet(barcodeFromSheet, boxIdFromSheet) {
  const bc = String(barcodeFromSheet || '').trim();
  const bid = String(boxIdFromSheet || '').trim();

  let box = null;
  if (mongoose.Types.ObjectId.isValid(bc) && String(new mongoose.Types.ObjectId(bc)) === bc) {
    box = await YarnBox.findById(bc).lean();
  }
  if (!box && bc) {
    box = await YarnBox.findOne({ barcode: bc }).lean();
  }
  if (!box && bid) {
    const alt = bid.replace(/--+/g, '-');
    box = await YarnBox.findOne({ boxId: { $in: [bid, alt] } }).lean();
  }
  return box;
}

/**
 * @param {Record<string, unknown>} c
 * @returns {boolean}
 */
function isActiveShortTermCone(c) {
  const storage = c.coneStorageId != null && String(c.coneStorageId).trim() !== '';
  const isAvailable = c.issueStatus !== 'issued' && c.issueStatus !== 'used' && c.issueStatus !== 'returned_to_vendor';
  const w = num(c.coneWeight);
  return storage && isAvailable && w > 0;
}

/**
 * @param {Record<string, unknown>|null} po
 * @param {string|null} poNumber
 * @param {string|null} boxLot
 * @returns {{ matched: boolean, matchingLots: Record<string, unknown>[], mismatchReason: string }}
 */
function analyzePoLots(po, poNumber, boxLot) {
  if (!poNumber) {
    return { matched: false, matchingLots: [], mismatchReason: 'CANNOT_PARSE_PO_FROM_BOX_ID' };
  }
  if (!po) {
    return { matched: false, matchingLots: [], mismatchReason: 'PO_DOCUMENT_NOT_FOUND' };
  }

  const lotNorm = String(boxLot || '').trim().toLowerCase();
  /** @type {Record<string, unknown>[]} */
  const matchingLots = [];
  const recv = Array.isArray(po.receivedLotDetails) ? po.receivedLotDetails : [];

  if (!recv.length && lotNorm) {
    return { matched: false, matchingLots: [], mismatchReason: 'NO_RECEIVED_LOTS_ON_PO' };
  }

  if (!recv.length) {
    return { matched: true, matchingLots: [], mismatchReason: 'EMPTY_LOTS_BUT_ACCEPTABLE' };
  }

  if (!lotNorm) {
    return { matched: false, matchingLots: [], mismatchReason: 'BOX_MISSING_LOT_NUMBER' };
  }

  for (const entry of recv) {
    const ln = String(entry?.lotNumber ?? '').trim().toLowerCase();
    if (ln && ln === lotNorm) matchingLots.push(entry);
  }

  if (matchingLots.length === 0) {
    return { matched: false, matchingLots: [], mismatchReason: 'LOT_NOT_IN_PO_RECEIVED_LOTS' };
  }

  const active = matchingLots.some((x) => x?.status !== 'lot_returned_to_vendor');
  if (!active) {
    return {
      matched: false,
      matchingLots,
      mismatchReason: 'LOT_ON_PO_MARKED_RETURNED_TO_VENDOR',
    };
  }

  return { matched: true, matchingLots, mismatchReason: '' };
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {unknown[][]} rows
 * @param {string} outPath
 * @returns {void}
 */
export function writeCsv(rows, outPath) {
  const body = rows.map((line) => line.map(csvCell).join(',')).join('\n');
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, body, 'utf8');
}

/**
 * @param {Record<string, string>} row
 * @param {number} ordinal
 * @returns {Promise<Record<string, unknown>>}
 */
export async function auditOneSpreadsheetRow(row, ordinal) {
  const barcodeFromSheet = row.barcode || row._col_0 || '';
  const boxIdFromSheet = row['box id'] || row.boxid || row['box id '] || '';
  const supplierFromSheet = row.supplier || row['supplier '] || '';
  const colourFromSheet = row.colour || row.color || '';

  /** @type {string[]} */
  const issues = [];
  /** @type {string[]} */
  const notes = [];

  const boxFromDb = await resolveYarnBoxFromSheet(barcodeFromSheet, boxIdFromSheet);

  const bidNorm = boxIdFromSheet.replace(/--+/g, '-').trim();
  const sheetLotParsed = extractPoLotFromStructuredBoxId(bidNorm);
  const clusterPoResolved =
    (boxFromDb && String(boxFromDb.poNumber || '').trim()) || sheetLotParsed.poNumber || '';
  const dbParsedLot = boxFromDb
    ? extractPoLotFromStructuredBoxId(String(boxFromDb.boxId || ''))
    : { poNumber: null, vendorLotToken: null };
  const vendorLotResolved =
    (boxFromDb && String(boxFromDb.lotNumber || '').trim()) ||
    sheetLotParsed.vendorLotToken ||
    dbParsedLot.vendorLotToken ||
    '';

  const poLotCluster = await findYarnBoxesByPoVendorLot(clusterPoResolved || null, vendorLotResolved || null);
  const poLotYarnAgg = summarizeYarnAcrossBoxes(poLotCluster);
  const sheetBarcodeInPoLotCluster = excelBarcodeInCluster(barcodeFromSheet, poLotCluster);
  const coneRem = await loadConeRemediationForSheetVsCluster(bidNorm, poLotCluster);

  /** @type {Record<string, unknown>} */
  const clusterSnap = {
    parsedPoNumber: clusterPoResolved,
    parsedVendorLotToken: vendorLotResolved,
    poLotClusterBoxCount: poLotCluster.length,
    poLotDistinctYarnKinds: poLotYarnAgg.distinctYarnKinds,
    poLotHomogeneousYarn: poLotYarnAgg.homogeneousYarn,
    poLotYarnBreakdownCsv: poLotYarnAgg.yarnBreakdownCsv,
    poLotClusterPreviewCsv: poLotYarnAgg.clusterPreviewCsv,
    poLotClusterStoragePreviewCsv: poLotYarnAgg.clusterStoragePreviewCsv,
    sheetBarcodeInPoLotCluster,
    ...coneRem.sheetBoxAgg,
    ...coneRem.clusterAgg,
    coneRollupQueryBoxIdsCsv: coneRem.allBoxIdsTouchedCsv,
    coneRemediationSignalsCsv: coneRem.remediationSignalsCsv,
  };

  const coneSig = coneRem.remediationSignalsCsv;
  if (coneSig.includes('BLOCKER_OLD')) {
    notes.push('Cones reference the spreadsheet BOX id → short-term / floor stock blocked; reconcile before hiding from lists.');
  } else if (coneSig.includes('NO_CONES_REFERENCE_SHEET_BOX_ID')) {
    notes.push('No YarnCone docs use the stale spreadsheet `Box id`; physical stock ties to newer cluster box ids.');
  }

  if (!boxFromDb) {
    issues.push('YARN_BOX_NOT_FOUND');
    notes.push(
      'No YarnBox matched barcode/ObjectId nor sheet boxId (after `--` collapse). Parsed PO/vendor-lot slice below compares against live YarnBox clusters for recreated rows / relocated stickers.'
    );
    if (clusterPoResolved && vendorLotResolved && poLotCluster.length && !sheetBarcodeInPoLotCluster) {
      issues.push('CLUSTER_HAS_OTHER_BOX_IDS_LIKELY_REPLACEMENT_OR_STALE_SCAN');
      notes.push(`${poLotCluster.length} YarnBox(es) exist for PO ${clusterPoResolved} + supplier lot "${vendorLotResolved}"; none matches this barcode.`);
    }
    if (clusterPoResolved && vendorLotResolved && poLotCluster.length === 0) {
      notes.push(`No YarnBox matched parsed PO "${clusterPoResolved}" + supplier lot "${vendorLotResolved}".`);
    }
    if (clusterPoResolved && !vendorLotResolved && poLotCluster.length >= 80) {
      notes.push('Vendor lot missing from BOX id shape; capped PO-wide scan (~80 newest boxes); narrow lot in sheet if possible.');
    }
    if (
      vendorLotResolved &&
      poLotCluster.length >= 2 &&
      !poLotYarnAgg.homogeneousYarn
    ) {
      issues.push('MIXED_YARN_IN_PO_LOT_CLUSTER');
      notes.push(`Yarn breakdown: ${poLotYarnAgg.yarnBreakdownCsv}`);
    }

    return {
      ordinal,
      spreadsheetBarcode: barcodeFromSheet,
      spreadsheetBoxId: boxIdFromSheet,
      spreadsheetSupplier: supplierFromSheet,
      spreadsheetColour: colourFromSheet,
      ...clusterSnap,
      issuesCsv: [...new Set(issues)].join(';'),
      notes: [...new Set(notes)].join(' | ') || '',
    };
  }

  const dbBoxId = String(boxFromDb.boxId || '');
  const sheetBidNorm = boxIdFromSheet.replace(/--+/g, '-').trim();
  const dbBidNorm = dbBoxId.replace(/--+/g, '-').trim();
  if (sheetBidNorm && dbBidNorm && sheetBidNorm !== dbBidNorm) {
    issues.push('SHEET_BOX_ID_DB_MISMATCH');
    notes.push(`Sheet box id ≠ DB (sheet=${sheetBidNorm}, db=${dbBidNorm})`);
  }

  if (boxFromDb.returnedToVendorAt) {
    issues.push('BOX_RETURNED_TO_VENDOR');
  }

  const visible = isVisibleOnGetYarnBoxesApi(boxFromDb);
  if (!visible) {
    issues.push('HIDDEN_FROM_GET_YARN_BOXES_API');
    notes.push('conesIssued=true and boxWeight≈0 → filtered from GET /yarn-boxes list');
  }

  const storageLocation = boxFromDb.storageLocation != null ? String(boxFromDb.storageLocation) : '';
  const isLtLoc = Boolean(storageLocation && LT_STORAGE_PATTERN.test(storageLocation));

  const poNumber = extractPoNumberFromBoxId(dbBoxId);

  const poDoc =
    poNumber != null ? await YarnPurchaseOrder.findOne({ poNumber }).select('supplierName poItems receivedLotDetails currentStatus').lean() : null;

  const lotAnalyze = analyzePoLots(poDoc, poNumber, boxFromDb.lotNumber != null ? String(boxFromDb.lotNumber) : '');

  if (!lotAnalyze.matched && lotAnalyze.mismatchReason) {
    issues.push(lotAnalyze.mismatchReason);
    if (
      ['NO_RECEIVED_LOTS_ON_PO', 'LOT_NOT_IN_PO_RECEIVED_LOTS'].includes(lotAnalyze.mismatchReason) &&
      isLtLoc &&
      num(boxFromDb.boxWeight) > 0
    ) {
      notes.push('Physical/long-term routing looks active but ERP lot linkage may be incomplete — reconcile GRN.');
    }
  }

  const supplierDb = poDoc?.supplierName != null ? String(poDoc.supplierName) : '';
  const supLo = supplierDb.toLowerCase();
  const sheetSupLo = supplierFromSheet.trim().toLowerCase();
  if (
    sheetSupLo &&
    supLo &&
    !supLo.includes(sheetSupLo.replace(/\s+$/, '').split(/\s+/)[0]) &&
    !sheetSupLo.includes(supLo.split(/\s+/)[0])
  ) {
    issues.push('SUPPLIER_NAME_SHEET_VS_PO_MISMATCH');
    notes.push(`sheet="${supplierFromSheet}" po="${supplierDb}"`);
  }

  /** @type {{ _id?: unknown }[]} */
  const siblings = await YarnBox.find({
    poNumber: boxFromDb.poNumber,
    lotNumber: boxFromDb.lotNumber,
    returnedToVendorAt: null,
    _id: { $ne: boxFromDb._id },
  })
    .select('boxId barcode yarnName shadeCode storedStatus storageLocation boxWeight')
    .lean();

  /** @type {string[]} */
  const siblingBarcodeList = siblings.map((s) => `${String(s.barcode || s._id)}→${String(s.boxId)}`);

  const cones = await YarnCone.find({ boxId: dbBoxId }).lean();
  const stCones = cones.filter((c) => isActiveShortTermCone(c));

  if (siblings.length > 0 && boxFromDb.barcode) {
    notes.push(`${siblings.length} other box(es) share same PO+lot:`);
    notes.push(...siblingBarcodeList.slice(0, 5));
    if (siblingBarcodeList.length > 5) notes.push(`... +${siblingBarcodeList.length - 5}`);
    issues.push('OTHER_BOXES_SHARE_PO_AND_LOT');
  }

  if (
    vendorLotResolved &&
    poLotCluster.length >= 2 &&
    !poLotYarnAgg.homogeneousYarn
  ) {
    issues.push('MIXED_YARN_IN_PO_LOT_CLUSTER');
    notes.push(`Across ${poLotCluster.length} YarnBox(es) for PO ${clusterPoResolved} + supplier lot "${vendorLotResolved}" → multiple yarn rows: ${poLotYarnAgg.yarnBreakdownCsv}`);
  }

  return {
    ordinal,
    spreadsheetBarcode: barcodeFromSheet,
    spreadsheetBoxId: boxIdFromSheet,
    spreadsheetSupplier: supplierFromSheet,
    spreadsheetColour: colourFromSheet,
    dbBoxBarcode: boxFromDb.barcode != null ? String(boxFromDb.barcode) : '',
    dbMongoId: String(boxFromDb._id),
    dbBoxId,
    dbPoNumber: boxFromDb.poNumber,
    inferredPoNumber: poNumber,
    poExists: Boolean(poDoc),
    poCurrentStatus: poDoc?.currentStatus ?? '',
    supplierOnPo: supplierDb,
    dbYarnName: boxFromDb.yarnName ?? '',
    dbLotNumber: boxFromDb.lotNumber ?? '',
    dbShadeCode: boxFromDb.shadeCode ?? '',
    qcStatusOnBox: boxFromDb.qcData?.status ?? '',
    storedStatus: boxFromDb.storedStatus === true,
    storageLocation,
    sheetLoftHint: row['location loft'] || row.loft || '',
    isLtSlotPattern: isLtLoc,
    boxWeightKg: num(boxFromDb.boxWeight),
    conesIssuedFlag: boxFromDb.coneData?.conesIssued === true,
    visibleOnGetYarnBoxesApi: visible,
    lotMatchedOnPo: lotAnalyze.matched,
    poLotMismatchCode: lotAnalyze.mismatchReason,
    conesTotal: cones.length,
    conesActiveShortTerm: stCones.length,
    ...clusterSnap,
    issuesCsv: [...new Set(issues)].join(';'),
    siblingBoxCount: siblings.length,
    siblingBarcodesPreview: siblingBarcodeList.slice(0, 8).join(' | ') || '',
    notes: [...new Set(notes)].join(' | ') || '',
  };
}
