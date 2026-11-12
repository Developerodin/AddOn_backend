/**
 * Local end-to-end sync probe.
 *
 * Cloud stand-in:  http://127.0.0.1:8000  database addon
 * Factory stand-in: http://127.0.0.1:8001  database addon2
 *
 * Synthetic vendorProductionFlow events only. Does not edit orders, floors, or quantities.
 *
 * Concurrent-edit cases post both sides to :8000: the factory side with the factory-mac key
 * (factory/.env.local-test) and the cloud side with a cloud-mac key on database addon
 * (factory/.env.local-probe). Create that key with:
 *   NODE_ENV=development node scripts/seedLocalSyncPeers.js --probe-only
 * The rebase check reads the stored SyncConflict row from the local addon database (read only).
 *
 *   node scripts/syncEndToEndTest.js
 *   node scripts/syncEndToEndTest.js --count 2000
 *   node scripts/syncEndToEndTest.js --days 10
 *
 * --days is a stand-in volume (100 events per day), not a measured factory peak.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { computeEventHash } from '../src/services/sync/syncHash.js';
import config from '../src/config/config.js';
import { connectMongooseForScript } from './lib/mongoScriptConnect.js';
import SyncConflict from '../src/models/sync/syncConflict.model.js';
import { CONFLICT_STATUS } from '../src/models/sync/syncConstants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLOUD = 'http://127.0.0.1:8000/v1/sync';
const BATCH = 100;
const DAY_EVENTS = 100;
const MAX_COUNT = 10000;

const results = [];

/**
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
const readEnvFile = (filePath) => {
  const out = {};
  const text = fs.readFileSync(filePath, 'utf8');
  text.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  });
  return out;
};

/**
 * @param {string[]} argv
 * @returns {{ count: number, label: string }}
 */
const parseCount = (argv) => {
  const countFlag = argv.indexOf('--count');
  const daysFlag = argv.indexOf('--days');
  if (countFlag !== -1) {
    const count = Number(argv[countFlag + 1]);
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
      throw new Error(`--count must be an integer from 1 to ${MAX_COUNT}`);
    }
    return { count, label: `${count} events` };
  }
  if (daysFlag !== -1) {
    const days = Number(argv[daysFlag + 1]);
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('--days must be an integer from 1 to 30');
    return { count: days * DAY_EVENTS, label: `${days} days x ${DAY_EVENTS} events (stand-in, not measured peak)` };
  }
  return { count: 300, label: '300 events' };
};

/**
 * @param {string} name
 * @param {boolean} pass
 * @param {string} detail
 */
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
};

/**
 * @param {{ keyId: string, secret: string, siteId: string }} cred
 * @param {string} url
 * @param {string} method
 * @param {object} [body]
 */
const callSync = async (cred, url, method, body) => {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Key-Id': cred.keyId,
      'X-Sync-Credential': cred.secret,
      'X-Sync-Site': cred.siteId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    json = { parseError: err.message, raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
};

/**
 * @param {object} fields
 */
const makeEvent = (fields) => {
  const event = {
    eventId: fields.eventId || crypto.randomUUID(),
    siteId: fields.siteId,
    originSequence: fields.originSequence,
    entityType: 'vendorProductionFlow',
    aggregateId: fields.aggregateId,
    aggregateVersion: fields.aggregateVersion,
    eventType: fields.eventType || 'e2eSyncProbe',
    schemaVersion: fields.schemaVersion || 1,
    origin: 'user',
    occurredAt: new Date().toISOString(),
    payload: fields.payload,
  };
  event.payloadHash = computeEventHash(event);
  return event;
};

/**
 * @param {{ base: object, factory: object, cloud: object, sameField: boolean }} input
 */
const printAdminView = ({ base, factory, cloud, sameField }) => {
  console.log('  base    ', JSON.stringify(base));
  console.log('  factory ', JSON.stringify(factory));
  console.log('  cloud   ', JSON.stringify(cloud));
  if (sameField) {
    console.log('  action  REVIEW REQUIRED. Same field changed on both sides. Do not pick by time. Nothing is applied.');
    return;
  }
  console.log('  action  Different fields. Rebase result stored for review. Not a conflict. Nothing is applied.');
};

/**
 * @param {{ keyId: string, secret: string, siteId: string }} factoryCred
 * @param {{ keyId: string, secret: string, siteId: string }} cloudCred
 * @param {string} runId
 */
const probeOneEvent = async (factoryCred, cloudCred, runId) => {
  const aggregateId = `e2e-${runId}-normal`;
  const event = makeEvent({
    siteId: 'factory-mac',
    originSequence: 1,
    aggregateId,
    aggregateVersion: 1,
    payload: { flowId: aggregateId, fromFloorKey: 'finalChecking', toFloorKey: 'dispatch', quantity: 10, probe: true },
  });

  const stored = await callSync(factoryCred, `${CLOUD}/events`, 'POST', { events: [event] });
  const first = stored.json && stored.json.results && stored.json.results[0];
  record(
    'normal sync factory → cloud',
    stored.status === 201 && first && first.outcome === 'STORED' && first.domainInvoked === false,
    `HTTP ${stored.status} outcome ${first && first.outcome} domainInvoked ${first && first.domainInvoked}`
  );

  const again = await callSync(factoryCred, `${CLOUD}/events`, 'POST', { events: [event] });
  const dup = again.json && again.json.results && again.json.results[0];
  record(
    'duplicate event',
    again.status === 200 && dup && dup.duplicate === true && dup.domainInvoked === false,
    `HTTP ${again.status} duplicate ${dup && dup.duplicate}`
  );

  const clash = { ...event, payload: { ...event.payload, quantity: 11 } };
  delete clash.payloadHash;
  clash.payloadHash = computeEventHash(clash);
  const mismatch = await callSync(factoryCred, `${CLOUD}/events`, 'POST', { events: [clash] });
  record(
    'same eventId different payload',
    mismatch.status === 409 && mismatch.json && mismatch.json.errorCode === 'IDEMPOTENCY_PAYLOAD_MISMATCH',
    `HTTP ${mismatch.status} ${mismatch.json && mismatch.json.errorCode}`
  );
};

/** Read-only connection to the local cloud stand-in database. Refuses anything but loopback `addon`. */
const connectCloudDb = async () => {
  const u = new URL(config.mongoose.url);
  const db = u.pathname.replace(/^\//, '');
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname) || db !== 'addon') {
    throw new Error('Refusing to read: MONGODB_URL must be a loopback host with database "addon".');
  }
  await connectMongooseForScript({ mongoose: config.mongoose });
};

/**
 * Two sides edit one flow at the same aggregateVersion. Both land on :8000.
 * @param {{ keyId: string, secret: string, siteId: string }} factoryCred
 * @param {{ keyId: string, secret: string, siteId: string }} cloudCred
 * @param {string} runId
 */
const probeConflict = async (factoryCred, cloudCred, runId) => {
  const aggregateId = `e2e-${runId}-conflict`;
  const base = { quantity: 100, note: 'base' };
  const factoryPayload = { flowId: aggregateId, fromFloorKey: 'finalChecking', toFloorKey: 'dispatch', quantity: 120, note: 'base', base };
  const cloudPayload = { flowId: aggregateId, fromFloorKey: 'finalChecking', toFloorKey: 'dispatch', quantity: 150, note: 'base', base };

  const factoryEvent = makeEvent({
    siteId: 'factory-mac',
    originSequence: 2,
    aggregateId,
    aggregateVersion: 2,
    payload: factoryPayload,
  });
  const cloudEvent = makeEvent({
    siteId: 'cloud-mac',
    originSequence: 2,
    aggregateId,
    aggregateVersion: 2,
    payload: cloudPayload,
  });

  const fromFactory = await callSync(factoryCred, `${CLOUD}/events`, 'POST', { events: [factoryEvent] });
  const fromCloud = await callSync(cloudCred, `${CLOUD}/events`, 'POST', { events: [cloudEvent] });
  const storedBoth = fromFactory.status === 201 && fromCloud.status === 201;
  const sameFieldOutcome = fromCloud.json && fromCloud.json.results && fromCloud.json.results[0];
  record(
    'both sides accepted a same-field edit',
    storedBoth,
    `factory-mac HTTP ${fromFactory.status}, cloud-mac HTTP ${fromCloud.status} (both on :8000), concurrency ${
      (sameFieldOutcome && sameFieldOutcome.concurrency && sameFieldOutcome.concurrency.outcome) || 'none'
    }`
  );

  console.log('ADMIN VIEW — same field. Screen: /sync/conflicts');
  printAdminView({ base, factory: factoryPayload, cloud: cloudPayload, sameField: true });

  const status = await callSync(factoryCred, `${CLOUD}/status`, 'GET');
  const open = status.json && status.json.openConflicts;
  record(
    'admin conflict queue shows the same-field edit',
    status.status === 200 && open > 0,
    `openConflicts ${open}`
  );

  const resolve = await callSync(factoryCred, `${CLOUD}/conflicts/664f0c2a9b1e4c0012ab34cd/resolve`, 'POST', {
    decision: 'KEEP_LOCAL',
    note: 'e2e',
  });
  record('resolve route with no conflict', resolve.status === 404, `HTTP ${resolve.status}`);

  const otherAggregate = `e2e-${runId}-rebase`;
  const factoryOther = makeEvent({
    siteId: 'factory-mac',
    originSequence: 3,
    aggregateId: otherAggregate,
    aggregateVersion: 2,
    payload: {
      flowId: otherAggregate,
      fromFloorKey: 'finalChecking',
      toFloorKey: 'dispatch',
      quantity: 100,
      containerBarcode: 'BOX-1',
      base: { quantity: 100 },
    },
  });
  const cloudOther = makeEvent({
    siteId: 'cloud-mac',
    originSequence: 3,
    aggregateId: otherAggregate,
    aggregateVersion: 2,
    payload: {
      flowId: otherAggregate,
      fromFloorKey: 'finalChecking',
      toFloorKey: 'dispatch',
      quantity: 100,
      note: 'cloud note',
      base: { quantity: 100 },
    },
  });
  const openBefore = open;
  const otherFromFactory = await callSync(factoryCred, `${CLOUD}/events`, 'POST', { events: [factoryOther] });
  const otherFromCloud = await callSync(cloudCred, `${CLOUD}/events`, 'POST', { events: [cloudOther] });
  console.log('ADMIN VIEW — different fields.');
  printAdminView({
    base: { quantity: 100 },
    factory: factoryOther.payload,
    cloud: cloudOther.payload,
    sameField: false,
  });

  const statusAfter = await callSync(factoryCred, `${CLOUD}/status`, 'GET');
  const openAfter = statusAfter.json && statusAfter.json.openConflicts;
  const rebase = await SyncConflict.findOne({
    entityType: 'vendorProductionFlow',
    aggregateId: otherAggregate,
    status: CONFLICT_STATUS.REBASED,
  }).lean();
  const conflicted = await SyncConflict.exists({ aggregateId: otherAggregate, status: CONFLICT_STATUS.CONFLICTED });
  const merged = (rebase && rebase.rebased) || {};
  const bothValues = merged.containerBarcode === 'BOX-1' && merged.note === 'cloud note';
  const sidesKept =
    !!rebase && rebase.factory && rebase.factory.containerBarcode === 'BOX-1' && rebase.cloud && rebase.cloud.note === 'cloud note';
  record(
    'different-field rebase',
    otherFromFactory.status === 201 &&
      otherFromCloud.status === 201 &&
      bothValues &&
      sidesKept &&
      !conflicted &&
      rebase.status !== CONFLICT_STATUS.CONFLICTED &&
      openAfter === openBefore,
    `HTTP ${otherFromFactory.status}/${otherFromCloud.status}, status ${rebase ? rebase.status : 'missing'}, containerBarcode ${
      merged.containerBarcode
    }, note ${merged.note}, CONFLICTED row ${conflicted ? 'yes' : 'no'}, openConflicts ${openBefore} → ${openAfter}`
  );
};

/**
 * @param {{ keyId: string, secret: string, siteId: string }} factoryCred
 * @param {number} count
 * @param {string} runId
 */
const probeBacklog = async (factoryCred, count, runId) => {
  const aggregateId = `e2e-${runId}-backlog`;
  const started = Date.now();
  let stored = 0;
  let failed = 0;
  const firstBatch = [];

  for (let offset = 0; offset < count; offset += BATCH) {
    const events = [];
    const size = Math.min(BATCH, count - offset);
    for (let i = 0; i < size; i += 1) {
      const n = offset + i + 1;
      const event = makeEvent({
        siteId: 'factory-mac',
        originSequence: 100000 + n,
        aggregateId,
        aggregateVersion: n,
        payload: { flowId: aggregateId, fromFloorKey: 'finalChecking', toFloorKey: 'dispatch', quantity: 1, n },
      });
      events.push(event);
      if (firstBatch.length < BATCH) firstBatch.push(event);
    }
    const res = await callSync(factoryCred, `${CLOUD}/events`, 'POST', { events });
    const rows = (res.json && res.json.results) || [];
    stored += rows.filter((r) => r.outcome === 'STORED').length;
    failed += size - rows.filter((r) => r.outcome === 'STORED').length;
    if (res.status >= 500) failed += size;
  }

  const elapsed = (Date.now() - started) / 1000;
  record(
    'backlog store',
    stored === count && failed === 0,
    `${stored}/${count} stored, ${failed} failed, ${elapsed.toFixed(1)}s, ${(stored / Math.max(elapsed, 0.001)).toFixed(0)} events/s`
  );

  const replay = await callSync(factoryCred, `${CLOUD}/events`, 'POST', { events: firstBatch });
  const rows = (replay.json && replay.json.results) || [];
  const dupes = rows.filter((r) => r.duplicate === true).length;
  record('backlog replay is duplicate', dupes === firstBatch.length, `${dupes}/${firstBatch.length} duplicates on replay`);
};

const main = async () => {
  const { count, label } = parseCount(process.argv.slice(2));
  const factoryEnv = readEnvFile(path.join(root, 'factory/.env.local-test'));
  const probeEnvPath = path.join(root, 'factory/.env.local-probe');
  if (!fs.existsSync(probeEnvPath)) {
    throw new Error(
      'factory/.env.local-probe is missing. Run: NODE_ENV=development node scripts/seedLocalSyncPeers.js --probe-only'
    );
  }
  const probeEnv = readEnvFile(probeEnvPath);
  const factoryCred = {
    keyId: factoryEnv.SYNC_PEER_KEY_ID,
    secret: factoryEnv.SYNC_PEER_CREDENTIAL,
    siteId: 'factory-mac',
  };
  // cloud-mac key on database addon, so the cloud side of a concurrent edit lands on :8000.
  const cloudCred = {
    keyId: probeEnv.SYNC_PROBE_CLOUD_KEY_ID,
    secret: probeEnv.SYNC_PROBE_CLOUD_CREDENTIAL,
    siteId: 'cloud-mac',
  };
  if (!factoryCred.keyId || !factoryCred.secret || !cloudCred.keyId || !cloudCred.secret) {
    throw new Error('Sync keys are missing from factory/.env.local-test or factory/.env.local-probe');
  }

  const runId = crypto.randomBytes(4).toString('hex');
  console.log(`run ${runId}`);
  console.log(`backlog ${label}`);
  console.log('Events use aggregateId prefix e2e-. Business documents are not updated.');

  const cloudUp = await fetch('http://127.0.0.1:8000/v1/sync/status', { method: 'GET' }).then(
    (r) => r.status,
    () => 0
  );
  const factoryUp = await fetch('http://127.0.0.1:8001/v1/sync/status', { method: 'GET' }).then(
    (r) => r.status,
    () => 0
  );
  record('cloud API up', cloudUp === 401, `GET /v1/sync/status without a key returned ${cloudUp}`);
  record('factory API up', factoryUp === 401, `GET /v1/sync/status without a key returned ${factoryUp}`);
  if (cloudUp !== 401 || factoryUp !== 401) {
    console.log('Start the API on 8000 and the Docker API on 8001, then run this again.');
    process.exit(1);
  }

  await connectCloudDb();
  try {
    await probeOneEvent(factoryCred, cloudCred, runId);
    await probeConflict(factoryCred, cloudCred, runId);
    await probeBacklog(factoryCred, count, runId);
  } finally {
    await mongoose.disconnect().catch(() => {});
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
};

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
