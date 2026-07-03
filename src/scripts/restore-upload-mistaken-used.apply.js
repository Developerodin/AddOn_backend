/**
 * Restore cones/boxes mistakenly marked used from upload-check Excel.
 * @module restore-upload-mistaken-used.apply
 */

import { YarnCone, YarnBox } from '../models/index.js';
import { activeYarnBoxMatch, activeYarnConeMatch } from '../services/yarnManagement/yarnStockActiveFilters.js';
import { WEIGHT_EPS_KG, num } from './lib/yarnLtStAuditHelpers.js';
import {
  loadStorageSlotIndex,
  validateRackCode,
  loadConesByBarcodes,
  loadBoxesByBarcodes,
} from './sync-inventory-dataaudit.apply.js';

/**
 * @typedef {Object} RestoreRowResult
 * @property {'cone' | 'box'} entityType
 * @property {number} rowIndex
 * @property {string} barcode
 * @property {string} status
 * @property {string} [message]
 * @property {string} [docId]
 * @property {string} [boxId]
 * @property {Record<string, unknown>} [before]
 * @property {Record<string, unknown>} [after]
 */

/**
 * Derives net and tear from Excel gross/net cells.
 * @param {number} gross
 * @param {number|null} excelNet
 * @returns {{ netWeight: number, tearWeight: number }}
 */
export function deriveNetAndTear(gross, excelNet) {
  const netWeight = excelNet != null ? num(excelNet) : gross;
  const tearWeight = Math.max(0, num(gross) - netWeight);
  return { netWeight, tearWeight };
}

/**
 * Builds cone restore update from Excel row.
 * @param {import('./sync-inventory-dataaudit.parse.js').ParsedConeRow} row
 * @param {Record<string, unknown>} cone
 * @param {import('./sync-inventory-dataaudit.apply.js').RackValidation} rackVal
 * @returns {{ ok: boolean, status: string, message?: string, payload?: Record<string, unknown>, unset?: Record<string, string>, before?: object, after?: object }}
 */
export function buildConeRestore(row, cone, rackVal) {
  const gross = row.grossWeight != null ? num(row.grossWeight) : null;
  if (gross == null || gross <= WEIGHT_EPS_KG) {
    return { ok: false, status: 'skip_invalid_weight', message: 'Gross weight missing or ≤ 0' };
  }

  const { netWeight, tearWeight } = deriveNetAndTear(gross, row.netWeight);
  if (row.netWeight != null && netWeight > gross + WEIGHT_EPS_KG) {
    return {
      ok: false,
      status: 'skip_invalid_weight',
      message: `Excel net (${netWeight}) > gross (${gross})`,
    };
  }

  /** @type {Record<string, unknown>} */
  const payload = {
    issueStatus: 'not_issued',
    coneWeight: gross,
    tearWeight,
  };

  if (rackVal.status === 'ok' && rackVal.resolvedRack) {
    payload.coneStorageId = rackVal.resolvedRack;
  } else if (row.rackCode) {
    return {
      ok: false,
      status: rackVal.status === 'empty' ? 'skip_empty_rack' : 'rack_not_valid',
      message: rackVal.message || `Invalid rack "${row.rackCode}"`,
    };
  }

  const before = {
    issueStatus: String(cone.issueStatus || ''),
    coneWeight: num(cone.coneWeight),
    tearWeight: num(cone.tearWeight),
    netWeight: num(cone.coneWeight) - num(cone.tearWeight),
    coneStorageId: cone.coneStorageId != null ? String(cone.coneStorageId) : '',
    issueWeight: num(cone.issueWeight),
  };

  const after = {
    issueStatus: 'not_issued',
    coneWeight: gross,
    tearWeight,
    netWeight,
    coneStorageId: payload.coneStorageId ?? before.coneStorageId,
    issueWeight: 0,
  };

  /** @type {Record<string, string>} */
  const unset = { issueWeight: '', issueDate: '' };

  return { ok: true, status: 'ready', payload, unset, before, after };
}

/**
 * Builds box update: remove from LT after yarn transferred to ST (cones uploaded).
 * @param {import('./restore-upload-mistaken-used.parse.js').ParsedUploadBoxRow} row
 * @param {Record<string, unknown>} box
 * @param {number} stConeCount - cones from this box currently in ST storage
 * @returns {{ ok: boolean, status: string, message?: string, payload?: Record<string, unknown>, unset?: Record<string, string>, before?: object, after?: object }}
 */
export function buildBoxClearFromLt(row, box, stConeCount) {
  const expectedCones =
    row.numberOfCones != null ? num(row.numberOfCones) : num(box.numberOfCones);
  const coneCount = stConeCount > 0 ? stConeCount : expectedCones;

  if (coneCount <= 0 && !box.storedStatus) {
    return {
      ok: false,
      status: 'already_cleared',
      message: 'Box already removed from LT',
    };
  }

  /** @type {Record<string, unknown>} */
  const payload = {
    boxWeight: 0,
    grossWeight: 0,
    storedStatus: false,
    'coneData.conesIssued': true,
    'coneData.numberOfCones': coneCount,
    'coneData.coneIssueDate': new Date(),
  };

  /** @type {Record<string, string>} */
  const unset = { storageLocation: '' };

  const before = {
    boxWeight: num(box.boxWeight),
    grossWeight: num(box.grossWeight),
    netWeight: num(box.boxWeight),
    numberOfCones: num(box.numberOfCones),
    storageLocation: box.storageLocation != null ? String(box.storageLocation) : '',
    storedStatus: Boolean(box.storedStatus),
    conesIssued: Boolean(box.coneData?.conesIssued),
    stConeCount,
  };

  const after = {
    boxWeight: 0,
    grossWeight: 0,
    netWeight: 0,
    numberOfCones: coneCount,
    storageLocation: '',
    storedStatus: false,
    conesIssued: true,
    stConeCount,
  };

  return { ok: true, status: 'ready', payload, unset, before, after };
}

/**
 * Processes cone restore rows.
 * @param {import('./sync-inventory-dataaudit.parse.js').ParsedConeRow[]} rows
 * @param {Map<string, import('mongoose').LeanDocument>} coneMap
 * @param {Map<string, import('./sync-inventory-dataaudit.apply.js').SlotIndexEntry>} slotIndex
 * @param {boolean} apply
 * @returns {Promise<{ results: RestoreRowResult[], catalogIds: Set<string> }>}
 */
export async function processConeRestores(rows, coneMap, slotIndex, apply) {
  /** @type {RestoreRowResult[]} */
  const results = [];
  /** @type {Set<string>} */
  const catalogIds = new Set();

  for (const row of rows) {
    if (!row.barcode) {
      results.push({ entityType: 'cone', rowIndex: row.rowIndex, barcode: '', status: 'skip_empty_row' });
      continue;
    }
    if (row.isDup) {
      results.push({
        entityType: 'cone',
        rowIndex: row.rowIndex,
        barcode: row.barcode,
        status: 'skip_duplicate_barcode',
      });
      continue;
    }

    const cone = coneMap.get(row.barcode.toLowerCase());
    if (!cone) {
      results.push({
        entityType: 'cone',
        rowIndex: row.rowIndex,
        barcode: row.barcode,
        status: 'not_found',
        message: 'No YarnCone found for barcode',
      });
      continue;
    }

    const rackVal = validateRackCode(row.rackCode, 'cone', slotIndex);
    const built = buildConeRestore(row, cone, rackVal);
    if (!built.ok) {
      results.push({
        entityType: 'cone',
        rowIndex: row.rowIndex,
        barcode: cone.barcode || row.barcode,
        status: built.status,
        message: built.message,
        docId: String(cone._id),
      });
      continue;
    }

    if (cone.yarnCatalogId) catalogIds.add(String(cone.yarnCatalogId));
    const successStatus = apply ? 'updated' : 'would_update';

    if (apply) {
      try {
        await YarnCone.updateOne(
          { _id: cone._id },
          { $set: built.payload, $unset: built.unset }
        );
      } catch (err) {
        results.push({
          entityType: 'cone',
          rowIndex: row.rowIndex,
          barcode: cone.barcode || row.barcode,
          status: 'error',
          message: err?.message || String(err),
          docId: String(cone._id),
        });
        continue;
      }
    }

    results.push({
      entityType: 'cone',
      rowIndex: row.rowIndex,
      barcode: cone.barcode || row.barcode,
      status: successStatus,
      docId: String(cone._id),
      boxId: cone.boxId ? String(cone.boxId) : '',
      before: built.before,
      after: built.after,
    });
  }

  return { results, catalogIds };
}

/**
 * Processes box rows: clear from LT after ST upload transfer.
 * @param {import('./restore-upload-mistaken-used.parse.js').ParsedUploadBoxRow[]} rows
 * @param {Map<string, import('mongoose').LeanDocument>} boxMap
 * @param {boolean} apply
 * @returns {Promise<{ results: RestoreRowResult[], catalogIds: Set<string> }>}
 */
export async function processBoxRestores(rows, boxMap, apply) {
  /** @type {RestoreRowResult[]} */
  const results = [];
  /** @type {Set<string>} */
  const catalogIds = new Set();

  for (const row of rows) {
    const lookupKey = (row.barcode || row.boxId || '').toLowerCase();
    if (!lookupKey) {
      results.push({ entityType: 'box', rowIndex: row.rowIndex, barcode: '', status: 'skip_empty_row' });
      continue;
    }
    if (row.isDup) {
      results.push({
        entityType: 'box',
        rowIndex: row.rowIndex,
        barcode: row.barcode || row.boxId,
        status: 'skip_duplicate_barcode',
      });
      continue;
    }

    const box =
      (row.barcode && boxMap.get(row.barcode.toLowerCase())) ||
      (row.boxId && boxMap.get(row.boxId.toLowerCase()));
    if (!box) {
      results.push({
        entityType: 'box',
        rowIndex: row.rowIndex,
        barcode: row.barcode || row.boxId,
        status: 'not_found',
        message: 'No YarnBox found',
      });
      continue;
    }

    if (box.returnedToVendorAt != null) {
      results.push({
        entityType: 'box',
        rowIndex: row.rowIndex,
        barcode: box.barcode || row.barcode,
        status: 'skip_returned_to_vendor',
        docId: String(box._id),
        boxId: box.boxId ? String(box.boxId) : '',
      });
      continue;
    }

    const stConeCount = await YarnCone.countDocuments({
      boxId: box.boxId,
      coneStorageId: { $exists: true, $nin: [null, ''] },
      ...activeYarnConeMatch,
    });

    const built = buildBoxClearFromLt(row, box, stConeCount);
    if (!built.ok) {
      results.push({
        entityType: 'box',
        rowIndex: row.rowIndex,
        barcode: box.barcode || row.barcode,
        status: built.status,
        message: built.message,
        docId: String(box._id),
        boxId: box.boxId ? String(box.boxId) : '',
      });
      continue;
    }

    if (box.yarnCatalogId) catalogIds.add(String(box.yarnCatalogId));
    const successStatus = apply ? 'cleared_from_lt' : 'would_clear_from_lt';

    if (apply) {
      try {
        await YarnBox.updateOne({ _id: box._id }, { $set: built.payload, $unset: built.unset });
      } catch (err) {
        results.push({
          entityType: 'box',
          rowIndex: row.rowIndex,
          barcode: box.barcode || row.barcode,
          status: 'error',
          message: err?.message || String(err),
          docId: String(box._id),
          boxId: box.boxId ? String(box.boxId) : '',
        });
        continue;
      }
    }

    results.push({
      entityType: 'box',
      rowIndex: row.rowIndex,
      barcode: box.barcode || row.barcode,
      status: successStatus,
      docId: String(box._id),
      boxId: box.boxId ? String(box.boxId) : '',
      before: built.before,
      after: built.after,
    });
  }

  return { results, catalogIds };
}

/**
 * Loads boxes by barcode and boxId keys.
 * @param {import('./restore-upload-mistaken-used.parse.js').ParsedUploadBoxRow[]} rows
 * @returns {Promise<Map<string, import('mongoose').LeanDocument>>}
 */
export async function loadBoxesForUploadRows(rows) {
  const barcodes = rows.map((r) => r.barcode).filter(Boolean);
  const map = await loadBoxesByBarcodes(barcodes);

  for (const row of rows) {
    if (!row.boxId) continue;
    const existing = map.get(row.boxId.toLowerCase());
    if (existing) continue;
    const doc = await YarnBox.findOne({ boxId: row.boxId, ...activeYarnBoxMatch }).lean();
    if (doc?.boxId) {
      map.set(String(doc.boxId).trim().toLowerCase(), doc);
      if (doc.barcode) map.set(String(doc.barcode).trim().toLowerCase(), doc);
      continue;
    }
    const fallback = await YarnBox.findOne({ boxId: row.boxId }).lean();
    if (fallback?.boxId) {
      map.set(String(fallback.boxId).trim().toLowerCase(), fallback);
      if (fallback.barcode) map.set(String(fallback.barcode).trim().toLowerCase(), fallback);
    }
  }

  return map;
}

/**
 * Summarizes restore results by status.
 * @param {RestoreRowResult[]} results
 * @returns {Record<string, number>}
 */
export function summarizeRestoreResults(results) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const r of results) {
    counts[r.status] = (counts[r.status] || 0) + 1;
  }
  return counts;
}

export { loadStorageSlotIndex, loadConesByBarcodes };
