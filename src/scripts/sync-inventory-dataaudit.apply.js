/**
 * Apply DATAAUDIT inventory sync: validate racks, build updates, persist via updateOne.
 * @module sync-inventory-dataaudit.apply
 */

import mongoose from 'mongoose';
import { YarnCone, YarnBox, StorageSlot } from '../models/index.js';
import { activeYarnConeMatch, activeYarnBoxMatch } from '../services/yarnManagement/yarnStockActiveFilters.js';
import { LT_SECTION_CODES } from '../models/storageManagement/storageSlot.model.js';
import {
  WEIGHT_EPS_KG,
  isLongTermStorageLocation,
  isShortTermStorageLocation,
  num,
} from './lib/yarnLtStAuditHelpers.js';

/** @type {RegExp} */
export const LT_STORAGE_REGEX = new RegExp(
  `^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`,
  'i'
);

/** @type {string[]} */
export const CONE_BAD_ISSUE_STATUSES = ['issued', 'used', 'returned_to_vendor'];

const LOOKUP_CHUNK = 500;

/**
 * @typedef {Object} SlotIndexEntry
 * @property {string} barcode
 * @property {string} zoneCode
 * @property {boolean} isActive
 */

/**
 * @typedef {Object} RackValidation
 * @property {'ok' | 'empty' | 'rack_not_in_system' | 'rack_zone_mismatch'} status
 * @property {string} [message]
 * @property {string} [resolvedRack]
 */

/**
 * @typedef {Object} SyncRowResult
 * @property {'cone' | 'box'} entityType
 * @property {number} rowIndex
 * @property {string} barcode
 * @property {string} status
 * @property {string} [message]
 * @property {string} [docId]
 * @property {string} [boxId]
 * @property {string} [poNumber]
 * @property {string} [yarnName]
 * @property {string} [yarnCatalogId]
 * @property {Record<string, unknown>} [before]
 * @property {Record<string, unknown>} [after]
 * @property {Record<string, unknown>} [updatePayload]
 * @property {string} [rackIssue]
 */

/**
 * Loads all storage slots into a barcode → entry map.
 * @returns {Promise<Map<string, SlotIndexEntry>>}
 */
export async function loadStorageSlotIndex() {
  const slots = await StorageSlot.find({}).select('barcode zoneCode isActive').lean();
  /** @type {Map<string, SlotIndexEntry>} */
  const map = new Map();
  for (const s of slots) {
    const bc = String(s.barcode || '').trim();
    if (bc) {
      map.set(bc, {
        barcode: bc,
        zoneCode: String(s.zoneCode || ''),
        isActive: s.isActive !== false,
      });
    }
  }
  return map;
}

/**
 * Validates a rack code for cone (ST) or box (LT).
 * @param {string} rackCode
 * @param {'cone' | 'box'} entityType
 * @param {Map<string, SlotIndexEntry>} slotIndex
 * @returns {RackValidation}
 */
export function validateRackCode(rackCode, entityType, slotIndex) {
  const rack = String(rackCode || '').trim();
  if (!rack) {
    return { status: 'empty' };
  }

  const slot = slotIndex.get(rack);
  if (!slot) {
    return {
      status: 'rack_not_in_system',
      message: `Rack "${rack}" not found in StorageSlot`,
    };
  }

  if (!slot.isActive) {
    return {
      status: 'rack_not_in_system',
      message: `Rack "${rack}" exists but is inactive`,
    };
  }

  const isSt = isShortTermStorageLocation(rack);
  const isLt = isLongTermStorageLocation(rack);

  if (entityType === 'cone' && !isSt) {
    return {
      status: 'rack_zone_mismatch',
      message: `Cone rack "${rack}" is not short-term (expected B7-01-* or ST-*)`,
      resolvedRack: rack,
    };
  }

  if (entityType === 'box' && !isLt) {
    return {
      status: 'rack_zone_mismatch',
      message: `Box rack "${rack}" is not long-term (expected B7-02..05 or LT-*)`,
      resolvedRack: rack,
    };
  }

  return { status: 'ok', resolvedRack: rack };
}

/**
 * Batch-loads YarnCones by barcode list into a case-insensitive map.
 * @param {string[]} barcodes
 * @returns {Promise<Map<string, import('mongoose').LeanDocument>>}
 */
export async function loadConesByBarcodes(barcodes) {
  /** @type {Map<string, import('mongoose').LeanDocument>} */
  const map = new Map();
  const unique = [...new Set(barcodes.filter(Boolean))];

  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK);
    const docs = await YarnCone.find({ barcode: { $in: chunk }, ...activeYarnConeMatch }).lean();
    for (const doc of docs) {
      const bc = String(doc.barcode || '').trim();
      if (bc) map.set(bc.toLowerCase(), doc);
    }
  }

  /** Case-insensitive fallback for barcodes not found exact-match */
  const missing = unique.filter((b) => !map.has(b.toLowerCase()));
  for (const raw of missing) {
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const doc = await YarnCone.findOne({
      barcode: new RegExp(`^${esc}$`, 'i'),
      ...activeYarnConeMatch,
    }).lean();
    if (doc?.barcode) map.set(String(doc.barcode).trim().toLowerCase(), doc);
  }

  return map;
}

/**
 * Batch-loads YarnBoxes by barcode list.
 * @param {string[]} barcodes
 * @returns {Promise<Map<string, import('mongoose').LeanDocument>>}
 */
export async function loadBoxesByBarcodes(barcodes) {
  /** @type {Map<string, import('mongoose').LeanDocument>} */
  const map = new Map();
  const unique = [...new Set(barcodes.filter(Boolean))];

  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK);
    const docs = await YarnBox.find({ barcode: { $in: chunk }, ...activeYarnBoxMatch }).lean();
    for (const doc of docs) {
      const bc = String(doc.barcode || '').trim();
      if (bc) map.set(bc.toLowerCase(), doc);
    }
  }

  const missing = unique.filter((b) => !map.has(b.toLowerCase()));
  for (const raw of missing) {
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const doc = await YarnBox.findOne({
      barcode: new RegExp(`^${esc}$`, 'i'),
      ...activeYarnBoxMatch,
    }).lean();
    if (doc?.barcode) map.set(String(doc.barcode).trim().toLowerCase(), doc);
  }

  return map;
}

/**
 * Builds cone update payload from Excel row + DB doc.
 * @param {import('./sync-inventory-dataaudit.parse.js').ParsedConeRow} row
 * @param {Record<string, unknown>} cone
 * @param {RackValidation} rackVal
 * @returns {{ ok: boolean, status: string, message?: string, payload?: Record<string, unknown>, before?: object, after?: object }}
 */
export function buildConeUpdate(row, cone, rackVal) {
  const gross = row.grossWeight != null ? num(row.grossWeight) : null;
  const excelNet = row.netWeight != null ? num(row.netWeight) : null;

  if (gross == null || gross <= WEIGHT_EPS_KG) {
    return { ok: false, status: 'skip_invalid_weight', message: 'Gross weight missing or ≤ 0' };
  }

  if (excelNet != null && excelNet > gross + WEIGHT_EPS_KG) {
    return {
      ok: false,
      status: 'skip_invalid_weight',
      message: `Excel net (${excelNet}) > gross (${gross})`,
    };
  }

  const netWeight = excelNet != null ? excelNet : gross;

  /** @type {Record<string, unknown>} */
  const payload = { coneWeight: gross };

  if (rackVal.status === 'ok' && rackVal.resolvedRack) {
    payload.coneStorageId = rackVal.resolvedRack;
  }

  const before = {
    coneWeight: num(cone.coneWeight),
    grossWeight: num(cone.coneWeight),
    netWeight: num(cone.coneWeight),
    coneStorageId: cone.coneStorageId != null ? String(cone.coneStorageId) : '',
    issueStatus: String(cone.issueStatus || ''),
  };

  const after = {
    coneWeight: gross,
    grossWeight: gross,
    netWeight,
    coneStorageId:
      rackVal.status === 'ok' && rackVal.resolvedRack
        ? rackVal.resolvedRack
        : before.coneStorageId,
    issueStatus: before.issueStatus,
  };

  return { ok: true, status: 'ready', payload, before, after };
}

/**
 * Builds box update payload from Excel row + DB doc.
 * @param {import('./sync-inventory-dataaudit.parse.js').ParsedBoxRow} row
 * @param {Record<string, unknown>} box
 * @param {RackValidation} rackVal
 * @returns {{ ok: boolean, status: string, message?: string, payload?: Record<string, unknown>, before?: object, after?: object }}
 */
export function buildBoxUpdate(row, box, rackVal) {
  const gross = row.grossWeight != null ? num(row.grossWeight) : null;
  const net = row.netWeight != null ? num(row.netWeight) : null;

  if (gross == null || gross <= WEIGHT_EPS_KG) {
    return { ok: false, status: 'skip_invalid_weight', message: 'Gross weight missing or ≤ 0' };
  }

  if (net == null || net < 0) {
    return { ok: false, status: 'skip_invalid_weight', message: 'Net weight missing or invalid' };
  }

  if (net > gross + WEIGHT_EPS_KG) {
    return {
      ok: false,
      status: 'skip_invalid_weight',
      message: `Net (${net}) > gross (${gross})`,
    };
  }

  /**
   * boxWeight is NET; grossWeight is scale gross (receiving UI / rack display).
   */
  /** @type {Record<string, unknown>} */
  const payload = {
    boxWeight: net,
    grossWeight: gross,
    numberOfCones: row.numberOfCones != null ? num(row.numberOfCones) : num(box.numberOfCones),
  };

  if (rackVal.status === 'ok' && rackVal.resolvedRack) {
    payload.storageLocation = rackVal.resolvedRack;
    payload.storedStatus = true;
  }

  const before = {
    boxWeight: num(box.boxWeight),
    grossWeight: num(box.grossWeight),
    netWeight: num(box.boxWeight),
    numberOfCones: num(box.numberOfCones),
    storageLocation: box.storageLocation != null ? String(box.storageLocation) : '',
    storedStatus: Boolean(box.storedStatus),
  };

  const after = {
    boxWeight: net,
    grossWeight: gross,
    netWeight: net,
    numberOfCones: payload.numberOfCones,
    storageLocation:
      rackVal.status === 'ok' && rackVal.resolvedRack
        ? rackVal.resolvedRack
        : before.storageLocation,
    storedStatus:
      rackVal.status === 'ok' && rackVal.resolvedRack ? true : before.storedStatus,
  };

  return { ok: true, status: 'ready', payload, before, after };
}

/**
 * Returns rack issue code when location could not be applied (weights may still update).
 * @param {RackValidation} rackVal
 * @returns {string|undefined}
 */
export function getRackIssue(rackVal) {
  if (rackVal.status === 'rack_not_in_system' || rackVal.status === 'rack_zone_mismatch') {
    return rackVal.status;
  }
  return undefined;
}

/**
 * Processes cone Excel rows against DB.
 * @param {import('./sync-inventory-dataaudit.parse.js').ParsedConeRow[]} rows
 * @param {Map<string, import('mongoose').LeanDocument>} coneMap
 * @param {Map<string, SlotIndexEntry>} slotIndex
 * @param {boolean} apply
 * @returns {Promise<{ results: SyncRowResult[], catalogIds: Set<string> }>}
 */
export async function processConeRows(rows, coneMap, slotIndex, apply) {
  /** @type {SyncRowResult[]} */
  const results = [];
  /** @type {Set<string>} */
  const catalogIds = new Set();

  for (const row of rows) {
    if (!row.barcode) {
      results.push({
        entityType: 'cone',
        rowIndex: row.rowIndex,
        barcode: '',
        status: 'skip_empty_row',
      });
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

    if (cone.returnedToVendorAt != null) {
      results.push({
        entityType: 'cone',
        rowIndex: row.rowIndex,
        barcode: cone.barcode || row.barcode,
        status: 'skip_returned_to_vendor',
        docId: String(cone._id),
      });
      continue;
    }

    if (CONE_BAD_ISSUE_STATUSES.includes(String(cone.issueStatus || ''))) {
      results.push({
        entityType: 'cone',
        rowIndex: row.rowIndex,
        barcode: cone.barcode || row.barcode,
        status: 'skip_bad_status',
        message: `issueStatus=${cone.issueStatus}`,
        docId: String(cone._id),
        before: {
          issueStatus: cone.issueStatus,
          coneWeight: num(cone.coneWeight),
          coneStorageId: cone.coneStorageId ?? '',
        },
      });
      continue;
    }

    const rackVal = validateRackCode(row.rackCode, 'cone', slotIndex);
    const built = buildConeUpdate(row, cone, rackVal);

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

    const rackIssue = getRackIssue(rackVal);
    const successStatus = apply ? 'updated' : 'would_update';

    if (cone.yarnCatalogId) catalogIds.add(String(cone.yarnCatalogId));

    if (apply) {
      try {
        await YarnCone.updateOne({ _id: cone._id }, { $set: built.payload });
        results.push({
          entityType: 'cone',
          rowIndex: row.rowIndex,
          barcode: cone.barcode || row.barcode,
          status: successStatus,
          rackIssue,
          message: rackIssue ? rackVal.message : undefined,
          docId: String(cone._id),
          boxId: cone.boxId ? String(cone.boxId) : '',
          poNumber: cone.poNumber ? String(cone.poNumber) : '',
          yarnName: cone.yarnName ? String(cone.yarnName) : '',
          yarnCatalogId: cone.yarnCatalogId ? String(cone.yarnCatalogId) : '',
          before: built.before,
          after: built.after,
          updatePayload: built.payload,
        });
      } catch (err) {
        results.push({
          entityType: 'cone',
          rowIndex: row.rowIndex,
          barcode: cone.barcode || row.barcode,
          status: 'error',
          message: err?.message || String(err),
          docId: String(cone._id),
        });
      }
    } else {
      results.push({
        entityType: 'cone',
        rowIndex: row.rowIndex,
        barcode: cone.barcode || row.barcode,
        status: successStatus,
        rackIssue,
        message: rackIssue ? rackVal.message : undefined,
        docId: String(cone._id),
        boxId: cone.boxId ? String(cone.boxId) : '',
        poNumber: cone.poNumber ? String(cone.poNumber) : '',
        yarnName: cone.yarnName ? String(cone.yarnName) : '',
        yarnCatalogId: cone.yarnCatalogId ? String(cone.yarnCatalogId) : '',
        before: built.before,
        after: built.after,
        updatePayload: built.payload,
      });
    }
  }

  return { results, catalogIds };
}

/**
 * Processes box Excel rows against DB.
 * @param {import('./sync-inventory-dataaudit.parse.js').ParsedBoxRow[]} rows
 * @param {Map<string, import('mongoose').LeanDocument>} boxMap
 * @param {Map<string, SlotIndexEntry>} slotIndex
 * @param {boolean} apply
 * @returns {Promise<{ results: SyncRowResult[], catalogIds: Set<string> }>}
 */
export async function processBoxRows(rows, boxMap, slotIndex, apply) {
  /** @type {SyncRowResult[]} */
  const results = [];
  /** @type {Set<string>} */
  const catalogIds = new Set();

  for (const row of rows) {
    if (!row.barcode) {
      results.push({
        entityType: 'box',
        rowIndex: row.rowIndex,
        barcode: '',
        status: 'skip_empty_row',
      });
      continue;
    }

    if (row.isDup) {
      results.push({
        entityType: 'box',
        rowIndex: row.rowIndex,
        barcode: row.barcode,
        status: 'skip_duplicate_barcode',
      });
      continue;
    }

    const box = boxMap.get(row.barcode.toLowerCase());
    if (!box) {
      results.push({
        entityType: 'box',
        rowIndex: row.rowIndex,
        barcode: row.barcode,
        status: 'not_found',
        message: 'No YarnBox found for barcode',
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

    const rackVal = validateRackCode(row.rackCode, 'box', slotIndex);
    const built = buildBoxUpdate(row, box, rackVal);

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

    const rackIssue = getRackIssue(rackVal);
    const successStatus = apply ? 'updated' : 'would_update';

    if (box.yarnCatalogId) catalogIds.add(String(box.yarnCatalogId));

    if (apply) {
      try {
        await YarnBox.updateOne({ _id: box._id }, { $set: built.payload });
        results.push({
          entityType: 'box',
          rowIndex: row.rowIndex,
          barcode: box.barcode || row.barcode,
          status: successStatus,
          rackIssue,
          message: rackIssue ? rackVal.message : undefined,
          docId: String(box._id),
          boxId: box.boxId ? String(box.boxId) : '',
          poNumber: box.poNumber ? String(box.poNumber) : '',
          yarnName: box.yarnName ? String(box.yarnName) : '',
          yarnCatalogId: box.yarnCatalogId ? String(box.yarnCatalogId) : '',
          before: built.before,
          after: built.after,
          updatePayload: built.payload,
        });
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
      }
    } else {
      results.push({
        entityType: 'box',
        rowIndex: row.rowIndex,
        barcode: box.barcode || row.barcode,
        status: successStatus,
        rackIssue,
        message: rackIssue ? rackVal.message : undefined,
        docId: String(box._id),
        boxId: box.boxId ? String(box.boxId) : '',
        poNumber: box.poNumber ? String(box.poNumber) : '',
        yarnName: box.yarnName ? String(box.yarnName) : '',
        yarnCatalogId: box.yarnCatalogId ? String(box.yarnCatalogId) : '',
        before: built.before,
        after: built.after,
        updatePayload: built.payload,
      });
    }
  }

  return { results, catalogIds };
}

/**
 * Finds active ST cones in DB not present in Excel barcode set.
 * @param {Set<string>} excelBarcodes
 * @returns {Promise<object[]>}
 */
export async function findConesNotInExcel(excelBarcodes) {
  const excludeList = [...excelBarcodes];
  const query = {
    ...activeYarnConeMatch,
    coneStorageId: { $exists: true, $nin: [null, ''] },
    issueStatus: { $nin: CONE_BAD_ISSUE_STATUSES },
    coneWeight: { $gt: WEIGHT_EPS_KG },
  };
  if (excludeList.length > 0) {
    query.barcode = { $nin: excludeList };
  }

  const docs = await YarnCone.find(query)
    .select(
      'barcode boxId poNumber yarnName yarnCatalogId coneWeight coneStorageId issueStatus'
    )
    .lean();

  return docs.map((c) => ({
    barcode: c.barcode ?? '',
    coneId: String(c._id),
    boxId: c.boxId ?? '',
    poNumber: c.poNumber ?? '',
    yarnName: c.yarnName ?? '',
    grossWeight: num(c.coneWeight),
    netWeight: num(c.coneWeight),
    coneStorageId: c.coneStorageId ?? '',
    issueStatus: c.issueStatus ?? '',
  }));
}

/**
 * Finds active LT boxes in DB not present in Excel barcode set.
 * @param {Set<string>} excelBarcodes
 * @returns {Promise<object[]>}
 */
export async function findBoxesNotInExcel(excelBarcodes) {
  const excludeList = [...excelBarcodes];
  const query = {
    ...activeYarnBoxMatch,
    storedStatus: true,
    storageLocation: LT_STORAGE_REGEX,
    boxWeight: { $gt: WEIGHT_EPS_KG },
  };
  if (excludeList.length > 0) {
    query.barcode = { $nin: excludeList };
  }

  const docs = await YarnBox.find(query)
    .select(
      'barcode boxId poNumber yarnName yarnCatalogId boxWeight grossWeight numberOfCones storageLocation storedStatus'
    )
    .lean();

  return docs.map((b) => ({
    barcode: b.barcode ?? '',
    boxId: b.boxId ?? '',
    poNumber: b.poNumber ?? '',
    yarnName: b.yarnName ?? '',
    grossWeight: num(b.grossWeight),
    netWeight: num(b.boxWeight),
    numberOfCones: num(b.numberOfCones),
    storageLocation: b.storageLocation ?? '',
    storedStatus: Boolean(b.storedStatus),
  }));
}

/**
 * Summarizes sync results by status.
 * @param {SyncRowResult[]} results
 * @returns {Record<string, number>}
 */
export function summarizeResults(results) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const r of results) {
    counts[r.status] = (counts[r.status] || 0) + 1;
  }
  return counts;
}
