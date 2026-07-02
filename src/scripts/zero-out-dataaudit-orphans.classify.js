/**
 * Classify cones/boxes from DATAAUDIT orphan lists before zero-out apply.
 * @module zero-out-dataaudit-orphans.classify
 */

import mongoose from 'mongoose';
import { YarnCone, YarnBox } from '../models/index.js';
import { ProductionOrder, Article } from '../models/production/index.js';
import { activeYarnConeMatch, activeYarnBoxMatch } from '../services/yarnManagement/yarnStockActiveFilters.js';
import { WEIGHT_EPS_KG } from './lib/yarnLtStAuditHelpers.js';
import { LT_STORAGE_REGEX } from './sync-inventory-dataaudit.apply.js';

/** @typedef {'already_final' | 'block_issued' | 'block_production_ref' | 'block_returned_to_vendor' | 'block_not_found' | 'can_zero'} ConeBucket */

/** @typedef {'already_zeroed' | 'lt_with_st_cones' | 'block_issued_cones_on_box' | 'block_not_found' | 'can_zero'} BoxBucket */

const WEIGHT_EPS = WEIGHT_EPS_KG;

/**
 * @typedef {Object} ConeClassifyResult
 * @property {ConeBucket} bucket
 * @property {string} barcode
 * @property {number} rowIndex
 * @property {string} [reason]
 * @property {string} [coneId]
 * @property {string} [boxId]
 * @property {string} [poNumber]
 * @property {string} [yarnName]
 * @property {string} [yarnCatalogId]
 * @property {string} [issueStatus]
 * @property {string} [coneStorageId]
 * @property {number} [coneWeight]
 * @property {number} [tearWeight]
 * @property {string} [orderId]
 * @property {string} [articleId]
 * @property {string} [orderNumber]
 * @property {string} [articleNumber]
 * @property {Record<string, unknown>} [before]
 */

/**
 * @typedef {Object} StConeSummary
 * @property {string} barcode
 * @property {string} issueStatus
 * @property {number} coneWeight
 * @property {string} coneStorageId
 */

/**
 * @typedef {Object} BoxClassifyResult
 * @property {BoxBucket} bucket
 * @property {string} barcode
 * @property {string} boxId
 * @property {number} rowIndex
 * @property {string} [reason]
 * @property {string} [docId]
 * @property {string} [poNumber]
 * @property {string} [yarnName]
 * @property {string} [yarnCatalogId]
 * @property {number} [boxWeight]
 * @property {number} [grossWeight]
 * @property {number} [numberOfCones]
 * @property {string} [storageLocation]
 * @property {boolean} [storedStatus]
 * @property {StConeSummary[]} [stCones]
 * @property {StConeSummary[]} [issuedStCones]
 * @property {Record<string, unknown>} [before]
 */

/**
 * Loads an active YarnCone by barcode (case-insensitive fallback).
 * @param {string} raw
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findConeByBarcode(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const direct = await YarnCone.findOne({ barcode: trimmed, ...activeYarnConeMatch });
  if (direct) return direct;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return YarnCone.findOne({ barcode: new RegExp(`^${escaped}$`, 'i'), ...activeYarnConeMatch });
}

/**
 * Loads an active YarnBox by barcode or boxId.
 * @param {{ barcode: string, boxId: string }} row
 * @returns {Promise<import('mongoose').Document|null>}
 */
export async function findBoxByIdentifiers(row) {
  if (row.barcode) {
    const byBarcode = await YarnBox.findOne({ barcode: row.barcode, ...activeYarnBoxMatch });
    if (byBarcode) return byBarcode;
    const esc = row.barcode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ci = await YarnBox.findOne({ barcode: new RegExp(`^${esc}$`, 'i'), ...activeYarnBoxMatch });
    if (ci) return ci;
  }
  if (row.boxId) {
    return YarnBox.findOne({ boxId: row.boxId, ...activeYarnBoxMatch });
  }
  return null;
}

/**
 * Returns true when the box is on an LT rack with positive weight.
 * @param {import('mongoose').Document} box
 * @returns {boolean}
 */
export function isBoxOnLtWithWeight(box) {
  const loc = String(box.storageLocation ?? '').trim();
  const weight = Number(box.boxWeight ?? 0);
  return Boolean(box.storedStatus) && LT_STORAGE_REGEX.test(loc) && weight > WEIGHT_EPS;
}

/**
 * Returns true when box is already fully zeroed and detached.
 * @param {import('mongoose').Document} box
 * @returns {boolean}
 */
export function isBoxAlreadyZeroed(box) {
  return (
    Number(box.boxWeight ?? 0) <= WEIGHT_EPS &&
    Number(box.numberOfCones ?? 0) <= WEIGHT_EPS &&
    box.storedStatus !== true &&
    (!box.storageLocation || String(box.storageLocation).trim() === '')
  );
}

/**
 * Loads active ST cones linked to a boxId.
 * @param {string} boxId
 * @returns {Promise<StConeSummary[]>}
 */
export async function loadStConesForBox(boxId) {
  if (!boxId) return [];
  const docs = await YarnCone.find({
    boxId,
    coneStorageId: { $exists: true, $nin: [null, ''] },
    coneWeight: { $gt: WEIGHT_EPS },
    issueStatus: { $nin: ['used', 'returned_to_vendor'] },
    ...activeYarnConeMatch,
  })
    .select('barcode issueStatus coneWeight coneStorageId')
    .lean();

  return docs.map((c) => ({
    barcode: c.barcode ?? '',
    issueStatus: c.issueStatus ?? '',
    coneWeight: Number(c.coneWeight ?? 0),
    coneStorageId: c.coneStorageId ?? '',
  }));
}

/**
 * Builds a before snapshot for a cone document.
 * @param {import('mongoose').Document} cone
 * @returns {Record<string, unknown>}
 */
export function coneBeforeSnapshot(cone) {
  return {
    issueStatus: cone.issueStatus ?? '',
    coneWeight: Number(cone.coneWeight ?? 0),
    tearWeight: Number(cone.tearWeight ?? 0),
    coneStorageId: cone.coneStorageId != null ? String(cone.coneStorageId) : '',
    issueWeight: Number(cone.issueWeight ?? 0),
    orderId: cone.orderId ? String(cone.orderId) : '',
    articleId: cone.articleId ? String(cone.articleId) : '',
  };
}

/**
 * Builds a before snapshot for a box document.
 * @param {import('mongoose').Document} box
 * @returns {Record<string, unknown>}
 */
export function boxBeforeSnapshot(box) {
  return {
    boxWeight: Number(box.boxWeight ?? 0),
    grossWeight: Number(box.grossWeight ?? 0),
    numberOfCones: Number(box.numberOfCones ?? 0),
    storedStatus: Boolean(box.storedStatus),
    storageLocation: String(box.storageLocation ?? ''),
  };
}

/**
 * Classifies a single cone for zero-out eligibility.
 * @param {import('./zero-out-dataaudit-orphans.parse.js').ParsedOrphanRow} row
 * @param {Map<string, string>} orderNumberById
 * @param {Map<string, string>} articleNumberById
 * @returns {Promise<ConeClassifyResult>}
 */
export async function classifyConeRow(row, orderNumberById, articleNumberById) {
  const base = { barcode: row.barcode, rowIndex: row.rowIndex };

  if (!row.barcode) {
    return { ...base, bucket: 'block_not_found', reason: 'empty_barcode' };
  }

  const cone = await findConeByBarcode(row.barcode);
  if (!cone) {
    return { ...base, bucket: 'block_not_found', reason: 'cone_not_in_db' };
  }

  const before = coneBeforeSnapshot(cone);
  const shared = {
    ...base,
    barcode: cone.barcode || row.barcode,
    coneId: String(cone._id),
    boxId: cone.boxId ?? '',
    poNumber: cone.poNumber ?? '',
    yarnName: cone.yarnName ?? '',
    yarnCatalogId: cone.yarnCatalogId ? String(cone.yarnCatalogId) : '',
    issueStatus: cone.issueStatus ?? '',
    coneStorageId: cone.coneStorageId != null ? String(cone.coneStorageId) : '',
    coneWeight: Number(cone.coneWeight ?? 0),
    tearWeight: Number(cone.tearWeight ?? 0),
    orderId: cone.orderId ? String(cone.orderId) : '',
    articleId: cone.articleId ? String(cone.articleId) : '',
    orderNumber: cone.orderId ? orderNumberById.get(String(cone.orderId)) ?? '' : '',
    articleNumber: cone.articleId ? articleNumberById.get(String(cone.articleId)) ?? '' : '',
    before,
  };

  if (cone.returnedToVendorAt != null) {
    return { ...shared, bucket: 'block_returned_to_vendor', reason: 'returned_to_vendor' };
  }

  if (cone.issueStatus === 'issued') {
    return { ...shared, bucket: 'block_issued', reason: 'issue_status_issued' };
  }

  if (cone.orderId || cone.articleId) {
    return { ...shared, bucket: 'block_production_ref', reason: 'stale_order_or_article_ref' };
  }

  const hasStorage = cone.coneStorageId != null && String(cone.coneStorageId).trim() !== '';
  const w0 =
    Number(cone.coneWeight ?? 0) <= WEIGHT_EPS && Number(cone.tearWeight ?? 0) <= WEIGHT_EPS;
  if (cone.issueStatus === 'used' && !hasStorage && w0) {
    return { ...shared, bucket: 'already_final', reason: 'already_used_cleared' };
  }

  return { ...shared, bucket: 'can_zero', reason: 'eligible' };
}

/**
 * Classifies a single box for zero-out eligibility.
 * @param {import('./zero-out-dataaudit-orphans.parse.js').ParsedOrphanRow} row
 * @returns {Promise<BoxClassifyResult>}
 */
export async function classifyBoxRow(row) {
  const base = { barcode: row.barcode, boxId: row.boxId, rowIndex: row.rowIndex };

  if (!row.barcode && !row.boxId) {
    return { ...base, bucket: 'block_not_found', reason: 'empty_identifiers' };
  }

  const box = await findBoxByIdentifiers(row);
  if (!box) {
    return { ...base, bucket: 'block_not_found', reason: 'box_not_in_db' };
  }

  const before = boxBeforeSnapshot(box);
  const shared = {
    ...base,
    barcode: box.barcode ?? row.barcode,
    boxId: box.boxId ?? row.boxId,
    docId: String(box._id),
    poNumber: box.poNumber ?? '',
    yarnName: box.yarnName ?? '',
    yarnCatalogId: box.yarnCatalogId ? String(box.yarnCatalogId) : '',
    boxWeight: Number(box.boxWeight ?? 0),
    grossWeight: Number(box.grossWeight ?? 0),
    numberOfCones: Number(box.numberOfCones ?? 0),
    storageLocation: String(box.storageLocation ?? ''),
    storedStatus: Boolean(box.storedStatus),
    before,
  };

  if (isBoxAlreadyZeroed(box)) {
    return { ...shared, bucket: 'already_zeroed', reason: 'already_zeroed' };
  }

  const stCones = await loadStConesForBox(box.boxId ?? '');
  const issuedStCones = stCones.filter((c) => c.issueStatus === 'issued');
  const activeStCones = stCones.filter((c) => c.issueStatus !== 'issued');

  if (issuedStCones.length > 0) {
    return {
      ...shared,
      bucket: 'block_issued_cones_on_box',
      reason: 'issued_st_cones_remain',
      stCones: activeStCones,
      issuedStCones,
    };
  }

  if (isBoxOnLtWithWeight(box) && activeStCones.length > 0) {
    return {
      ...shared,
      bucket: 'lt_with_st_cones',
      reason: 'lt_box_still_has_st_cones',
      stCones: activeStCones,
      issuedStCones: [],
    };
  }

  return { ...shared, bucket: 'can_zero', reason: 'eligible', stCones: activeStCones, issuedStCones: [] };
}

/**
 * Batch-resolves production order numbers for cone classification.
 * @param {string[]} orderIds
 * @returns {Promise<Map<string, string>>}
 */
export async function loadOrderNumberMap(orderIds) {
  const valid = orderIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!valid.length) return new Map();
  const docs = await ProductionOrder.find({ _id: { $in: valid } })
    .select('orderNumber')
    .lean();
  return new Map(docs.map((d) => [String(d._id), d.orderNumber ?? '']));
}

/**
 * Batch-resolves article numbers for cone classification.
 * @param {string[]} articleIds
 * @returns {Promise<Map<string, string>>}
 */
export async function loadArticleNumberMap(articleIds) {
  const valid = articleIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!valid.length) return new Map();
  const docs = await Article.find({ _id: { $in: valid } })
    .select('articleNumber')
    .lean();
  return new Map(docs.map((d) => [String(d._id), d.articleNumber ?? '']));
}

/**
 * Classifies all cone rows and enriches blocked rows with order/article numbers.
 * @param {import('./zero-out-dataaudit-orphans.parse.js').ParsedOrphanRow[]} rows
 * @returns {Promise<ConeClassifyResult[]>}
 */
export async function classifyAllCones(rows) {
  /** @type {ConeClassifyResult[]} */
  const results = [];
  for (const row of rows) {
    results.push(await classifyConeRow(row, new Map(), new Map()));
  }

  const orderIds = results.map((r) => r.orderId).filter(Boolean);
  const articleIds = results.map((r) => r.articleId).filter(Boolean);
  const orderMap = await loadOrderNumberMap([...new Set(orderIds)]);
  const articleMap = await loadArticleNumberMap([...new Set(articleIds)]);

  return results.map((r) => ({
    ...r,
    orderNumber: r.orderId ? orderMap.get(r.orderId) ?? '' : '',
    articleNumber: r.articleId ? articleMap.get(r.articleId) ?? '' : '',
  }));
}

/**
 * Classifies all box rows.
 * @param {import('./zero-out-dataaudit-orphans.parse.js').ParsedOrphanRow[]} rows
 * @returns {Promise<BoxClassifyResult[]>}
 */
export async function classifyAllBoxes(rows) {
  /** @type {BoxClassifyResult[]} */
  const results = [];
  for (const row of rows) {
    results.push(await classifyBoxRow(row));
  }
  return results;
}

/**
 * Summarizes classification buckets.
 * @param {Array<{ bucket: string }>} results
 * @returns {Record<string, number>}
 */
export function summarizeBuckets(results) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const r of results) {
    counts[r.bucket] = (counts[r.bucket] ?? 0) + 1;
  }
  return counts;
}
