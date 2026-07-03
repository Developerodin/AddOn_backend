/**
 * Shared queries for LT YarnBoxes that still have active cones on ST racks.
 * @module ltBoxesWithStCones.lib
 */

import { YarnBox, YarnCone } from '../../models/index.js';
import { activeYarnBoxMatch, activeYarnConeMatch } from '../../services/yarnManagement/yarnStockActiveFilters.js';
import {
  WEIGHT_EPS_KG,
  getLtStorageLocationRegex,
  isShortTermStorageLocation,
  num,
} from './yarnLtStAuditHelpers.js';

/**
 * Returns true when a lean cone is an active ST-rack cone.
 * @param {Record<string, unknown>} cone
 * @returns {boolean}
 */
export function isActiveStRackCone(cone) {
  const storageId = cone.coneStorageId != null ? String(cone.coneStorageId).trim() : '';
  if (!storageId || !isShortTermStorageLocation(storageId)) return false;
  if (['used', 'returned_to_vendor'].includes(String(cone.issueStatus ?? ''))) return false;
  return num(cone.coneWeight) > WEIGHT_EPS_KG;
}

/**
 * @typedef {Object} LtBoxWithStConesCandidate
 * @property {Record<string, unknown>} box
 * @property {Record<string, unknown>[]} stCones
 * @property {Record<string, unknown>[]} allConesInSlots
 * @property {Record<string, unknown>[]} returnedVendorCones
 */

/**
 * Finds LT boxes on rack with weight that have active cones on ST racks.
 * @param {{ poFilter?: string|null, boxBarcodes?: string[]|null }} [opts]
 * @returns {Promise<LtBoxWithStConesCandidate[]>}
 */
export async function findLtBoxesWithStCones(opts = {}) {
  const poFilter = opts.poFilter ? String(opts.poFilter).trim() : '';
  const barcodeSet =
    opts.boxBarcodes?.length ?
      new Set(opts.boxBarcodes.map((b) => String(b).trim()).filter(Boolean))
    : null;

  /** @type {Record<string, unknown>} */
  const boxQuery = {
    storedStatus: true,
    storageLocation: getLtStorageLocationRegex(),
    boxWeight: { $gt: WEIGHT_EPS_KG },
    ...activeYarnBoxMatch,
  };
  if (poFilter) boxQuery.poNumber = poFilter;
  if (barcodeSet?.size) boxQuery.barcode = { $in: [...barcodeSet] };

  const ltBoxes = await YarnBox.find(boxQuery)
    .select(
      '_id barcode boxId poNumber yarnName yarnCatalogId boxWeight grossWeight numberOfCones storageLocation storedStatus initialBoxWeight coneData'
    )
    .lean();

  const boxIds = ltBoxes.map((b) => String(b.boxId ?? '')).filter(Boolean);
  if (!boxIds.length) return [];

  /** @type {Record<string, unknown>[]} */
  const coneDocs = await YarnCone.find({
    boxId: { $in: boxIds },
    coneStorageId: { $exists: true, $nin: [null, ''] },
    coneWeight: { $gt: WEIGHT_EPS_KG },
    issueStatus: { $nin: ['used', 'returned_to_vendor'] },
    ...activeYarnConeMatch,
  })
    .select(
      'barcode boxId issueStatus coneWeight tearWeight coneStorageId orderId articleId poNumber yarnName returnedToVendorAt'
    )
    .lean();

  /** @type {Map<string, Record<string, unknown>[]>} */
  const stConesByBoxId = new Map();
  /** @type {Map<string, Record<string, unknown>[]>} */
  const allSlottedByBoxId = new Map();

  for (const cone of coneDocs) {
    const key = String(cone.boxId ?? '');
    if (!key) continue;
    if (!allSlottedByBoxId.has(key)) allSlottedByBoxId.set(key, []);
    allSlottedByBoxId.get(key).push(cone);
    if (isActiveStRackCone(cone)) {
      if (!stConesByBoxId.has(key)) stConesByBoxId.set(key, []);
      stConesByBoxId.get(key).push(cone);
    }
  }

  const returnedVendorCones = await YarnCone.find({
    boxId: { $in: boxIds },
    returnedToVendorAt: { $exists: true, $ne: null },
  })
    .select('boxId coneWeight returnedToVendorAt')
    .lean();

  /** @type {Map<string, Record<string, unknown>[]>} */
  const returnedByBoxId = new Map();
  for (const cone of returnedVendorCones) {
    const key = String(cone.boxId ?? '');
    if (!key) continue;
    if (!returnedByBoxId.has(key)) returnedByBoxId.set(key, []);
    returnedByBoxId.get(key).push(cone);
  }

  /** @type {LtBoxWithStConesCandidate[]} */
  const candidates = [];
  for (const box of ltBoxes) {
    if (barcodeSet?.size && !barcodeSet.has(String(box.barcode ?? ''))) continue;
    const boxId = String(box.boxId ?? '');
    const stCones = stConesByBoxId.get(boxId) ?? [];
    if (!stCones.length) continue;
    candidates.push({
      box,
      stCones,
      allConesInSlots: allSlottedByBoxId.get(boxId) ?? [],
      returnedVendorCones: returnedByBoxId.get(boxId) ?? [],
    });
  }

  return candidates;
}

/**
 * Builds a flat report row for a candidate box.
 * @param {LtBoxWithStConesCandidate} candidate
 * @returns {Record<string, unknown>}
 */
export function buildLtBoxWithStConesRow(candidate) {
  const { box, stCones } = candidate;
  const stWeight = stCones.reduce((sum, c) => sum + num(c.coneWeight), 0);
  const notIssued = stCones.filter((c) => c.issueStatus !== 'issued').length;
  const issued = stCones.filter((c) => c.issueStatus === 'issued').length;

  return {
    boxBarcode: box.barcode ?? '',
    boxId: box.boxId ?? '',
    poNumber: box.poNumber ?? '',
    yarnName: box.yarnName ?? '',
    yarnCatalogId: box.yarnCatalogId ? String(box.yarnCatalogId) : '',
    storageLocation: box.storageLocation ?? '',
    storedStatus: box.storedStatus === true,
    boxWeight: num(box.boxWeight),
    grossWeight: num(box.grossWeight),
    numberOfCones: num(box.numberOfCones),
    stConeCount: stCones.length,
    stConeNotIssuedCount: notIssued,
    stConeIssuedCount: issued,
    stConeTotalWeight: stWeight,
    stConeBarcodes: stCones.map((c) => c.barcode).join('; '),
    stConeLocations: [...new Set(stCones.map((c) => String(c.coneStorageId ?? '')))].join('; '),
  };
}
