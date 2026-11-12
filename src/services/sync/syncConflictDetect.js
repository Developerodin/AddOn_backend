import { isDeepStrictEqual } from 'util';
import SyncInbox from '../../models/sync/syncInbox.model.js';
import SyncConflict from '../../models/sync/syncConflict.model.js';
import { CONFLICT_STATUS, INBOX_STATUS } from '../../models/sync/syncConstants.js';
import { MASTER_ENTITY_TYPES } from './syncOwnershipTypes.js';

/**
 * Concurrent-edit detection on ingest. Stores review rows only. Never applies a payload, never calls a domain service.
 *
 * Two inbox rows are concurrent edits when they share entityType + aggregateId + aggregateVersion, come from
 * different sites, and have different payload hashes. Sequential events from one site are ordered, not concurrent,
 * so a long single-site backlog for one flow never opens a conflict.
 */

/** Masters (both directions) go through the same detector: a same-field edit is CONFLICTED and never applied. */
export const DETECT_ENTITY_TYPES = Object.freeze(['vendorProductionFlow', ...MASTER_ENTITY_TYPES]);
export const FACTORY_SITE_ID = 'factory-mac';
export const CLOUD_SITE_ID = 'cloud-mac';
/** Payload key carrying the common ancestor. Not compared, not merged. */
const BASE_KEY = 'base';
const MAX_CANDIDATES = 20;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {Record<string, any>} a
 * @param {Record<string, any>} b
 * @returns {{ changedKeys: string[], nonOverlappingKeys: string[] }}
 */
export const comparePayloadKeys = (a, b) => {
  const left = isPlainObject(a) ? a : {};
  const right = isPlainObject(b) ? b : {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((k) => k !== BASE_KEY).sort();
  const changedKeys = [];
  const nonOverlappingKeys = [];
  keys.forEach((k) => {
    const inLeft = Object.prototype.hasOwnProperty.call(left, k);
    const inRight = Object.prototype.hasOwnProperty.call(right, k);
    if (inLeft && inRight) {
      if (!isDeepStrictEqual(left[k], right[k])) changedKeys.push(k);
    } else {
      nonOverlappingKeys.push(k);
    }
  });
  return { changedKeys, nonOverlappingKeys };
};

const withoutBase = (payload) => {
  if (!isPlainObject(payload)) return {};
  const { [BASE_KEY]: _ignored, ...rest } = payload;
  return rest;
};

/** Factory = the row from factory-mac, cloud = the row from cloud-mac. Other site ids fall back to arrival order. */
const assignSides = (incoming, other) => {
  const rows = [incoming, other];
  const factory = rows.find((r) => r.sourceSiteId === FACTORY_SITE_ID);
  const cloud = rows.find((r) => r.sourceSiteId === CLOUD_SITE_ID);
  if (factory && cloud) return { factory, cloud };
  if (factory) return { factory, cloud: rows.find((r) => r !== factory) };
  if (cloud) return { factory: rows.find((r) => r !== cloud), cloud };
  return { factory: other, cloud: incoming };
};

const pickBase = (incoming, other) => {
  const fromIncoming = isPlainObject(incoming.payload) ? incoming.payload[BASE_KEY] : undefined;
  if (isPlainObject(fromIncoming)) return fromIncoming;
  const fromOther = isPlainObject(other.payload) ? other.payload[BASE_KEY] : undefined;
  return isPlainObject(fromOther) ? fromOther : {};
};

/**
 * Upsert one row keyed by openKey. A concurrent insert of the same key (E11000) means the row already exists.
 * @returns {Promise<object|null>}
 */
const upsertOpen = async (openKey, doc) => {
  try {
    return await SyncConflict.findOneAndUpdate(
      { openKey },
      { $setOnInsert: { ...doc, openKey } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  } catch (err) {
    if (err && err.code === 11000) return SyncConflict.findOne({ openKey }).lean();
    throw err;
  }
};

/**
 * Run after an inbox row is stored. Idempotent: re-running for the same rows never adds a second row.
 * @param {Record<string, any>} incoming stored inbox row (sourceSiteId, eventId, entityType, aggregateId, aggregateVersion, payload, payloadHash)
 * @returns {Promise<{ outcome: 'CONFLICTED'|'REBASED'|'NONE', conflictId?: string, changedKeys?: string[], nonOverlappingKeys?: string[] }>}
 */
export const detectConcurrentEdit = async (incoming) => {
  if (!DETECT_ENTITY_TYPES.includes(incoming.entityType)) return { outcome: 'NONE' };

  const candidates = await SyncInbox.find({
    entityType: incoming.entityType,
    aggregateId: incoming.aggregateId,
    aggregateVersion: incoming.aggregateVersion,
    sourceSiteId: { $ne: incoming.sourceSiteId },
    payloadHash: { $ne: incoming.payloadHash },
    status: { $ne: INBOX_STATUS.QUARANTINED },
  })
    .sort({ receivedAt: 1 })
    .limit(MAX_CANDIDATES)
    .lean();
  if (!candidates.length) return { outcome: 'NONE' };

  const compared = candidates.map((other) => ({ other, ...comparePayloadKeys(other.payload, incoming.payload) }));
  const sameField = compared.find((c) => c.changedKeys.length > 0);
  const differentOnly = compared.find((c) => c.changedKeys.length === 0 && c.nonOverlappingKeys.length > 0);
  const hit = sameField || differentOnly;
  if (!hit) return { outcome: 'NONE' };

  const { factory, cloud } = assignSides(incoming, hit.other);
  const status = sameField ? CONFLICT_STATUS.CONFLICTED : CONFLICT_STATUS.REBASED;
  const doc = {
    entityType: incoming.entityType,
    aggregateId: incoming.aggregateId,
    aggregateVersion: incoming.aggregateVersion,
    sourceSiteId: incoming.sourceSiteId,
    eventId: incoming.eventId,
    reason: sameField ? 'SAME_FIELD_EDIT' : 'DIFFERENT_FIELD_EDIT',
    status,
    base: pickBase(incoming, hit.other),
    factory: factory.payload,
    cloud: cloud.payload,
    factorySiteId: factory.sourceSiteId,
    cloudSiteId: cloud.sourceSiteId,
    factoryEventId: factory.eventId,
    cloudEventId: cloud.eventId,
    changedKeys: hit.changedKeys,
    nonOverlappingKeys: hit.nonOverlappingKeys,
    rebased: sameField ? null : { ...withoutBase(factory.payload), ...withoutBase(cloud.payload) },
  };

  const row = await upsertOpen(`${status}:${incoming.entityType}:${incoming.aggregateId}`, doc);

  if (sameField) {
    // Hold both events out of any later apply path until an admin decides. Shadow mode applies nothing anyway.
    await SyncInbox.updateMany(
      { _id: { $in: [incoming._id, hit.other._id].filter(Boolean) }, status: INBOX_STATUS.PENDING },
      { $set: { status: INBOX_STATUS.CONFLICTED } }
    );
  }

  return {
    outcome: status,
    conflictId: row ? String(row._id) : undefined,
    changedKeys: hit.changedKeys,
    nonOverlappingKeys: hit.nonOverlappingKeys,
  };
};
