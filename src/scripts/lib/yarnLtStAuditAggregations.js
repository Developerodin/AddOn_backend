import { YarnCone } from '../../models/index.js';
import { WEIGHT_EPS_KG, num } from './yarnLtStAuditHelpers.js';

/**
 * Per-boxId cone metrics for audit joins.
 * @returns {Promise<Map<string, { activeStCount: number, activeStGrossKg: number, activeStNetKg: number, issuedConeCount: number, totalConeCount: number, anySlotGrossKg: number }>>}
 */
export async function loadConeMetricsByBoxId() {
  const pipeline = [
    {
      $match: {
        boxId: { $exists: true, $nin: [null, ''] },
      },
    },
    {
      $addFields: {
        _cs: { $ifNull: ['$coneStorageId', ''] },
        _cw: { $ifNull: ['$coneWeight', 0] },
        _tw: { $ifNull: ['$tearWeight', 0] },
      },
    },
    {
      $addFields: {
        _hasSlot: { $gt: [{ $strLenCP: { $trim: { input: '$_cs' } } }, 0] },
        _issued: { $eq: ['$issueStatus', 'issued'] },
        _activeSt: {
          $and: [
            { $gt: [{ $strLenCP: { $trim: { input: '$_cs' } } }, 0] },
            { $ne: ['$issueStatus', 'issued'] },
            { $gt: ['$_cw', 0] },
          ],
        },
      },
    },
    {
      $group: {
        _id: '$boxId',
        totalConeCount: { $sum: 1 },
        issuedConeCount: { $sum: { $cond: ['$_issued', 1, 0] } },
        activeStCount: { $sum: { $cond: ['$_activeSt', 1, 0] } },
        activeStGrossKg: { $sum: { $cond: ['$_activeSt', '$_cw', 0] } },
        activeStNetKg: {
          $sum: {
            $cond: [
              '$_activeSt',
              { $max: [0, { $subtract: ['$_cw', '$_tw'] }] },
              0,
            ],
          },
        },
        anySlotGrossKg: { $sum: { $cond: ['$_hasSlot', '$_cw', 0] } },
      },
    },
  ];

  const rows = await YarnCone.aggregate(pipeline).allowDiskUse(true);
  const map = new Map();
  rows.forEach((r) => {
    const { _id: boxIdKey } = r;
    map.set(String(boxIdKey), {
      activeStCount: r.activeStCount || 0,
      activeStGrossKg: num(r.activeStGrossKg),
      activeStNetKg: num(r.activeStNetKg),
      issuedConeCount: r.issuedConeCount || 0,
      totalConeCount: r.totalConeCount || 0,
      anySlotGrossKg: num(r.anySlotGrossKg),
    });
  });
  return map;
}

/**
 * Distinct short-term rack barcodes (`coneStorageId`) per box for active ST cones only.
 * @returns {Promise<Map<string, string[]>>}
 */
export async function loadActiveStRackBarcodesByBoxId() {
  const rows = await YarnCone.aggregate([
    {
      $match: {
        boxId: { $exists: true, $nin: [null, ''] },
        coneStorageId: { $exists: true, $nin: [null, ''] },
        issueStatus: { $ne: 'issued' },
        coneWeight: { $gt: WEIGHT_EPS_KG },
      },
    },
    { $group: { _id: '$boxId', racks: { $addToSet: '$coneStorageId' } } },
  ]);
  const map = new Map();
  rows.forEach((row) => {
    const { _id: bid } = row;
    const racks = (row.racks || [])
      .map((r) => String(r || '').trim())
      .filter(Boolean)
      .sort();
    map.set(String(bid), racks);
  });
  return map;
}

/**
 * @param {import('mongoose').FilterQuery<unknown>} filter
 * @returns {Promise<{ count: number, grossKg: number }>}
 */
export async function coneTotals(filter) {
  const [agg] = await YarnCone.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        grossKg: { $sum: { $ifNull: ['$coneWeight', 0] } },
      },
    },
  ]);
  return { count: agg?.count || 0, grossKg: num(agg?.grossKg) };
}

/**
 * @param {RegExp} ltRegexOnString
 * @returns {Promise<{ count: number, sampleBoxIds: string[] }>}
 */
export async function conesWithLtPatternStorage(ltRegexOnString) {
  const rows = await YarnCone.aggregate([
    {
      $match: {
        coneStorageId: { $exists: true, $nin: [null, ''] },
      },
    },
    {
      $addFields: {
        _cs: { $trim: { input: { $ifNull: ['$coneStorageId', ''] } } },
      },
    },
    { $match: { _cs: { $regex: ltRegexOnString } } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        boxIds: { $addToSet: '$boxId' },
      },
    },
  ]);
  const row = rows[0];
  if (!row) return { count: 0, sampleBoxIds: [] };
  const boxIds = (row.boxIds || []).filter(Boolean).slice(0, 15).map(String);
  return { count: row.count || 0, sampleBoxIds: boxIds };
}
