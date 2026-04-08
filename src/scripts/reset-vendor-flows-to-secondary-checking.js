#!/usr/bin/env node
/**
 * Reset VendorProductionFlow docs back to Secondary Checking only.
 *
 * Target: flows where `currentFloorKey === "secondaryChecking"` but quantities already moved to
 * `branding` / `finalChecking` / `dispatch` (or have any non-zero downstream counters).
 *
 * What it does (per flow):
 * - Sets `currentFloorKey = "secondaryChecking"`, `finalQualityConfirmed=false`, `completedAt=null`
 * - Resets downstream floors (`branding`, `finalChecking`, `dispatch`) counters + arrays to zero/empty
 * - Resets secondary checking work counters (completed/transferred/splits/transfers) to 0
 * - Keeps `secondaryChecking.received` at `plannedQuantity` (fallback: keep existing received if plannedQuantity is 0)
 *
 * Optional:
 * - `--clear-containers`: removes any staged container items referencing these flows
 *
 * Usage:
 *   node src/scripts/reset-vendor-flows-to-secondary-checking.js --dry-run
 *   node src/scripts/reset-vendor-flows-to-secondary-checking.js --apply
 *   node src/scripts/reset-vendor-flows-to-secondary-checking.js --apply --clear-containers
 *   node src/scripts/reset-vendor-flows-to-secondary-checking.js --apply --limit=200
 *   node src/scripts/reset-vendor-flows-to-secondary-checking.js --apply --mongo-uri="mongodb://..."
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { VendorProductionFlow } from '../models/index.js';
import ContainersMaster from '../models/production/containersMaster.model.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const LOCAL_FALLBACK = 'mongodb://127.0.0.1:27017/addon';

function parseArgs(argv) {
  const out = {
    dryRun: argv.includes('--dry-run'),
    apply: argv.includes('--apply'),
    clearContainers: argv.includes('--clear-containers'),
    limit: null,
    mongoUri: null,
  };
  const lim = argv.find((a) => a.startsWith('--limit='));
  if (lim) {
    const n = Number(lim.slice('--limit='.length));
    if (Number.isFinite(n) && n > 0) out.limit = Math.floor(n);
  }
  const mu = argv.find((a) => a.startsWith('--mongo-uri='));
  if (mu) out.mongoUri = mu.slice('--mongo-uri='.length).trim() || null;
  return out;
}

function normalizeEnvMongoUrl(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

async function connectMongo(preferredUrl) {
  const fromEnv = normalizeEnvMongoUrl(process.env.MONGODB_URL);
  const candidates = [preferredUrl, fromEnv, LOCAL_FALLBACK].filter((u) => typeof u === 'string' && u.length > 0);
  let lastErr;
  for (const url of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await mongoose.connect(url);
      console.log(`Connected (masked): ${url.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
      return url;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function num(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function hasDownstreamWork(flow) {
  const fq = flow.floorQuantities || {};
  const b = fq.branding || {};
  const fc = fq.finalChecking || {};
  const d = fq.dispatch || {};
  const sc = fq.secondaryChecking || {};
  const scAny =
    num(sc.completed) > 0 ||
    num(sc.transferred) > 0 ||
    num(sc.m1Quantity) > 0 ||
    num(sc.m2Quantity) > 0 ||
    num(sc.m4Quantity) > 0 ||
    num(sc.m1Transferred) > 0 ||
    num(sc.m2Transferred) > 0 ||
    (Array.isArray(sc.receivedData) && sc.receivedData.length > 0);
  const bAny =
    num(b.received) > 0 ||
    num(b.completed) > 0 ||
    num(b.transferred) > 0 ||
    (Array.isArray(b.transferredData) && b.transferredData.length > 0) ||
    (Array.isArray(b.receivedData) && b.receivedData.length > 0);
  const fcAny =
    num(fc.received) > 0 ||
    num(fc.completed) > 0 ||
    num(fc.transferred) > 0 ||
    num(fc.m1Quantity) > 0 ||
    num(fc.m2Quantity) > 0 ||
    num(fc.m4Quantity) > 0 ||
    (Array.isArray(fc.transferredData) && fc.transferredData.length > 0) ||
    (Array.isArray(fc.receivedData) && fc.receivedData.length > 0);
  const dAny =
    num(d.received) > 0 ||
    num(d.completed) > 0 ||
    num(d.transferred) > 0 ||
    (Array.isArray(d.receivedData) && d.receivedData.length > 0);
  // Reset is needed if ANY non-initial state exists (including secondary checking itself)
  return scAny || bAny || fcAny || dAny;
}

function buildResetDoc(flow) {
  const planned = num(flow.plannedQuantity);
  const fq = flow.floorQuantities || {};
  const sc = fq.secondaryChecking || {};
  const received = planned > 0 ? planned : num(sc.received);

  const next = {
    currentFloorKey: 'secondaryChecking',
    finalQualityConfirmed: false,
    completedAt: null,
    floorQuantities: {
      ...fq,
      secondaryChecking: {
        ...sc,
        received,
        completed: 0,
        transferred: 0,
        remaining: received,
        m1Quantity: 0,
        m2Quantity: 0,
        m4Quantity: 0,
        m1Transferred: 0,
        m1Remaining: 0,
        m2Transferred: 0,
        m2Remaining: 0,
        repairStatus: 'Not Required',
        repairRemarks: '',
        // Keep receivedData history for traceability (lot/box markers).
        receivedData: Array.isArray(sc.receivedData) ? sc.receivedData : [],
      },
      branding: {
        received: 0,
        completed: 0,
        remaining: 0,
        transferred: 0,
        repairReceived: 0,
        transferredData: [],
        receivedData: [],
      },
      finalChecking: {
        received: 0,
        completed: 0,
        remaining: 0,
        transferred: 0,
        m1Quantity: 0,
        m2Quantity: 0,
        m4Quantity: 0,
        m1Transferred: 0,
        m1Remaining: 0,
        m2Transferred: 0,
        m2Remaining: 0,
        repairStatus: 'Not Required',
        repairRemarks: '',
        transferredData: [],
        receivedData: [],
      },
      dispatch: {
        received: 0,
        completed: 0,
        remaining: 0,
        transferred: 0,
        repairReceived: 0,
        receivedData: [],
      },
    },
  };
  return next;
}

async function clearContainersForFlows(flowIds, dryRun) {
  if (!flowIds.length) return { scanned: 0, modified: 0 };
  const ids = flowIds.map((id) => new mongoose.Types.ObjectId(id));
  const docs = await ContainersMaster.find({ 'activeItems.vendorProductionFlow': { $in: ids } });
  let modified = 0;
  for (const c of docs) {
    const before = Array.isArray(c.activeItems) ? c.activeItems.length : 0;
    const nextItems = (c.activeItems || []).filter((it) => {
      const v = it?.vendorProductionFlow;
      const vid = typeof v === 'object' && v?._id ? v._id.toString() : v?.toString?.() || String(v || '');
      return !flowIds.includes(vid);
    });
    if (nextItems.length === before) continue;
    modified += 1;
    if (!dryRun) {
      c.activeItems = nextItems;
      if (nextItems.length === 0) c.activeFloor = '';
      // eslint-disable-next-line no-await-in-loop
      await c.save();
    }
  }
  return { scanned: docs.length, modified };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args.dryRun || !args.apply;
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);

  const mongoUrl = args.mongoUri || process.env.MONGODB_URL || LOCAL_FALLBACK;
  await connectMongo(mongoUrl);

  const q = { currentFloorKey: 'secondaryChecking' };
  const cursor = VendorProductionFlow.find(q).cursor();

  let examined = 0;
  let matched = 0;
  let modified = 0;
  const changedFlowIds = [];

  for await (const flow of cursor) {
    examined += 1;
    if (args.limit && matched >= args.limit) break;
    if (!hasDownstreamWork(flow)) continue;

    matched += 1;
    const next = buildResetDoc(flow);
    changedFlowIds.push(flow._id.toString());

    if (!dryRun) {
      // eslint-disable-next-line no-await-in-loop
      await VendorProductionFlow.updateOne({ _id: flow._id }, { $set: next });
    }
    modified += 1;
  }

  let containers = { scanned: 0, modified: 0 };
  if (args.clearContainers) {
    containers = await clearContainersForFlows(changedFlowIds, dryRun);
  }

  console.log(
    JSON.stringify(
      {
        examined,
        matched,
        modified,
        dryRun,
        clearContainers: args.clearContainers,
        containers,
        sampleFlowIds: changedFlowIds.slice(0, 5),
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error('Reset script failed:', e?.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });

