/**
 * Helpers for scripts/syncOwnershipApply.js (local Mac proof only). No secrets are read or printed.
 */
import mongoose from 'mongoose';
import config from '../../src/config/config.js';
import { connectMongooseForScript } from './mongoScriptConnect.js';

export const HOST = 'mongodb://127.0.0.1:27017';
export const FACTORY_DB = 'addon2';
export const CLOUD_DB = 'addon';
export const FACTORY_SITE_ID = 'factory-mac';
export const CLOUD_SITE_ID = 'cloud-mac';
export const POLL_MS = 150 * 1000;
export const POLL_EVERY_MS = 3000;

export const log = (...a) => console.log(...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Point the default mongoose connection (used by every service and model) at one database and act as that site.
 * @param {string} dbName addon2 (factory) or addon (cloud)
 * @param {string} siteId publisher site id for captures made by this process
 * @returns {Promise<void>}
 */
export const actAs = async (dbName, siteId) => {
  // Close only the default connection. mongoose.disconnect() also closes the raw read handles.
  if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
  Object.assign(config.sync, {
    enabled: true,
    applyPilot: true,
    shadowVendorTransfer: true,
    siteId,
    factorySiteId: FACTORY_SITE_ID,
  });
  await connectMongooseForScript({ mongoose: { url: `${HOST}/${dbName}`, options: config.mongoose.options } });
};

/**
 * Raw read-only handle on the other database (no models, no hooks).
 * @param {string} dbName
 * @returns {Promise<{ db: import('mongodb').Db, close: () => Promise<void> }>}
 */
export const openRaw = async (dbName) => {
  const conn = await mongoose.createConnection(`${HOST}/${dbName}`, config.mongoose.options);
  return { db: conn.db, close: () => conn.close() };
};

/**
 * Poll `probe` until it reports done, a fatal state, or the time runs out.
 * @param {() => Promise<{ done: boolean, fatal?: string|null, state?: any }>} probe
 * @param {number} [ms]
 * @returns {Promise<{ ok: boolean, fatal: string|null, state: any, secs: number }>}
 */
export const pollUntil = async (probe, ms = POLL_MS) => {
  const started = Date.now();
  let last = { done: false, fatal: null, state: null };
  while (Date.now() - started < ms) {
    // eslint-disable-next-line no-await-in-loop
    last = await probe();
    if (last.done || last.fatal) break;
    // eslint-disable-next-line no-await-in-loop
    await sleep(POLL_EVERY_MS);
  }
  return { ok: Boolean(last.done), fatal: last.fatal || null, state: last.state, secs: Math.round((Date.now() - started) / 1000) };
};

/**
 * Inbox rows on a receiver for a set of event ids (status + reason only).
 * @param {import('mongodb').Db} db
 * @param {string[]} eventIds
 * @returns {Promise<Array<{ eventId: string, eventType: string, status: string, lastError: string|null }>>}
 */
export const inboxFor = (db, eventIds) =>
  db
    .collection('syncinboxes')
    .find({ eventId: { $in: eventIds } }, { projection: { eventId: 1, eventType: 1, status: 1, lastError: 1 } })
    .toArray();

/** Statuses that end an apply attempt without success; nothing will change them by waiting. */
export const STUCK = ['APPLY_FAILED', 'CONFLICTED', 'QUARANTINED'];

/**
 * First inbox row that will not apply on its own, as a printable reason.
 * @param {Array<Record<string, any>>} rows
 * @returns {string|null}
 */
export const stuckReason = (rows) => {
  const bad = rows.find((r) => STUCK.includes(r.status));
  return bad ? `${bad.eventType} ${bad.status}: ${bad.lastError || '-'}` : null;
};

/**
 * Outbox rows (status only) on the publisher for a set of event ids.
 * @param {import('mongodb').Db} db
 * @param {string[]} eventIds
 * @returns {Promise<Array<Record<string, any>>>}
 */
export const outboxStatus = (db, eventIds) =>
  db
    .collection('syncoutboxes')
    .find({ eventId: { $in: eventIds } }, { projection: { eventType: 1, status: 1, lastError: 1, originSequence: 1 } })
    .sort({ originSequence: 1 })
    .toArray();

const FLOOR_FIELDS = ['received', 'completed', 'transferred'];

/**
 * received / completed / transferred for each floor key.
 * @param {Record<string, any>|null} article lean article
 * @param {string[]} keys floor keys
 * @returns {Record<string, Record<string, number>>|null}
 */
export const floorView = (article, keys) => {
  if (!article) return null;
  const fq = article.floorQuantities || {};
  const out = {};
  keys.forEach((k) => {
    const d = fq[k] || {};
    out[k] = {};
    FLOOR_FIELDS.forEach((f) => {
      out[k][f] = Number(d[f]) || 0;
    });
  });
  return out;
};

/**
 * QC detail (not compared; printed so the reader sees what inspection booked on each side).
 * @param {Record<string, any>|null} article
 * @param {string} key
 * @returns {Record<string, number>|null}
 */
export const qcDetail = (article, key) => {
  const d = article && article.floorQuantities ? article.floorQuantities[key] : null;
  if (!d) return null;
  return {
    m1Quantity: Number(d.m1Quantity) || 0,
    m1Transferred: Number(d.m1Transferred) || 0,
    remaining: Number(d.remaining) || 0,
  };
};

/**
 * @param {unknown} err
 * @returns {string}
 */
export const errText = (err) => String((err && err.message) || err).slice(0, 400);
