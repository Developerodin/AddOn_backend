#!/usr/bin/env node
/**
 * One-time migration: legacy `yarn` → `yarnCatalogId`; backfill missing ids from `yarnName`.
 *
 *   node src/scripts/migrate-yarn-to-yarnCatalogId.js
 *   node src/scripts/migrate-yarn-to-yarnCatalogId.js --dry-run
 *
 * Progress: logs to stdout every N docs (set MIGRATE_PROGRESS_EVERY=25 to change).
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import YarnCatalog from '../models/yarnManagement/yarnCatalog.model.js';
import { backfillYarnBoxCatalogIdsFromPurchaseOrders } from '../services/yarnManagement/yarnBoxCatalogIdBackfill.service.js';

const DRY_RUN = process.argv.includes('--dry-run');
const PROGRESS_EVERY = Math.max(1, Number(process.env.MIGRATE_PROGRESS_EVERY) || 50);

/** Heartbeat so long Atlas scans don’t look stuck */
function progressLog(phase, processed, touched, startMs) {
  const sec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`[migrate] ${phase} | scanned=${processed} | will_update=${touched} | ${sec}s`);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve catalog id when exactly one active row matches the name (exact or case-insensitive).
 */
async function resolveCatalogIdStrict(name) {
  if (!name || !String(name).trim()) return null;
  const trimmed = String(name).trim();
  const exactCount = await YarnCatalog.countDocuments({
    yarnName: trimmed,
    status: { $ne: 'suspended' },
  });
  if (exactCount === 1) {
    const doc = await YarnCatalog.findOne({ yarnName: trimmed, status: { $ne: 'suspended' } })
      .select('_id')
      .lean();
    return doc?._id || null;
  }
  const re = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
  const matches = await YarnCatalog.find({ yarnName: re, status: { $ne: 'suspended' } })
    .select('_id')
    .lean();
  if (matches.length === 1) return matches[0]._id;
  return null;
}

async function migratePurchaseOrderItems() {
  const phase = 'yarnpurchaseorders.poItems';
  console.log(`\n[migrate] ▶ ${phase} — scanning (dry-run=${DRY_RUN}, log_every=${PROGRESS_EVERY})`);
  const coll = mongoose.connection.collection('yarnpurchaseorders');
  const start = Date.now();
  let touched = 0;
  let processed = 0;
  const cursor = coll.find({ poItems: { $exists: true, $ne: [] } });
  for await (const doc of cursor) {
    processed += 1;
    if (processed === 1 || processed % PROGRESS_EVERY === 0) {
      progressLog(phase, processed, touched, start);
    }

    let dirty = false;
    const poItems = [];
    for (const p of doc.poItems || []) {
      const next = { ...p };
      if (next.yarn && !next.yarnCatalogId) {
        next.yarnCatalogId = next.yarn;
        delete next.yarn;
        dirty = true;
      }
      if (!next.yarnCatalogId && next.yarnName) {
        const id = await resolveCatalogIdStrict(next.yarnName);
        if (id) {
          next.yarnCatalogId = id;
          dirty = true;
        }
      }
      poItems.push(next);
    }
    if (dirty) {
      touched += 1;
      if (!DRY_RUN) await coll.updateOne({ _id: doc._id }, { $set: { poItems } });
    }
  }
  progressLog(`${phase} (final)`, processed, touched, start);
  return { step: phase, touched, processed };
}

async function migrateTopLevelYarn(collName) {
  const phase = `${collName} yarn→yarnCatalogId`;
  console.log(`\n[migrate] ▶ ${phase}`);
  const coll = mongoose.connection.collection(collName);
  const start = Date.now();
  let touched = 0;
  let processed = 0;
  const cursor = coll.find({ yarn: { $exists: true, $ne: null } });
  for await (const doc of cursor) {
    processed += 1;
    if (processed === 1 || processed % PROGRESS_EVERY === 0) {
      progressLog(phase, processed, touched, start);
    }
    if (doc.yarnCatalogId) continue;
    touched += 1;
    if (!DRY_RUN) {
      await coll.updateOne(
        { _id: doc._id },
        { $set: { yarnCatalogId: doc.yarn }, $unset: { yarn: '' } }
      );
    }
  }
  progressLog(`${phase} (final)`, processed, touched, start);
  return { step: phase, touched, processed };
}

async function backfillYarnCatalogIdByName(collName, nameField = 'yarnName') {
  const phase = `${collName} backfill by ${nameField}`;
  console.log(`\n[migrate] ▶ ${phase}`);
  const coll = mongoose.connection.collection(collName);
  const start = Date.now();
  let touched = 0;
  let processed = 0;
  const cursor = coll.find({
    $or: [{ yarnCatalogId: { $exists: false } }, { yarnCatalogId: null }],
    [nameField]: { $exists: true, $nin: [null, ''] },
  });
  for await (const doc of cursor) {
    processed += 1;
    if (processed === 1 || processed % PROGRESS_EVERY === 0) {
      progressLog(phase, processed, touched, start);
    }
    const id = await resolveCatalogIdStrict(doc[nameField]);
    if (!id) continue;
    touched += 1;
    if (!DRY_RUN) await coll.updateOne({ _id: doc._id }, { $set: { yarnCatalogId: id } });
  }
  progressLog(`${phase} (final)`, processed, touched, start);
  return { step: phase, touched, processed };
}

async function backfillProductBom() {
  const phase = 'products.bom';
  console.log(`\n[migrate] ▶ ${phase}`);
  const coll = mongoose.connection.collection('products');
  const start = Date.now();
  let touched = 0;
  let processed = 0;
  const cursor = coll.find({ bom: { $exists: true, $ne: [] } });
  for await (const doc of cursor) {
    processed += 1;
    if (processed === 1 || processed % PROGRESS_EVERY === 0) {
      progressLog(phase, processed, touched, start);
    }

    let dirty = false;
    const bom = [];
    for (const b of doc.bom || []) {
      const row = { ...b };
      if (!row.yarnCatalogId && row.yarnName) {
        const id = await resolveCatalogIdStrict(row.yarnName);
        if (id) {
          row.yarnCatalogId = id;
          dirty = true;
        }
      }
      bom.push(row);
    }
    if (dirty) {
      touched += 1;
      if (!DRY_RUN) await coll.updateOne({ _id: doc._id }, { $set: { bom } });
    }
  }
  progressLog(`${phase} (final)`, processed, touched, start);
  return { step: phase, touched, processed };
}

/**
 * Must run BEFORE migrateTopLevelYarn('yarninventories'): $unset yarn would leave many
 * docs "indexed as null" and violate a unique { yarn: 1 } index (E11000 dup key).
 */
async function dropLegacyYarnIndex() {
  console.log('\n[migrate] ▶ yarninventories — check legacy index yarn_1');
  const coll = mongoose.connection.collection('yarninventories');
  try {
    const idxList = await coll.indexes();
    for (const idx of idxList) {
      const keys = idx.key || {};
      if (keys.yarn === 1 && Object.keys(keys).length === 1) {
        if (!DRY_RUN) {
          await coll.dropIndex(idx.name);
          console.log(`[migrate] Dropped legacy index ${idx.name}`);
          logger.info(`Dropped legacy index ${idx.name} on yarninventories`);
        } else {
          console.log(`[migrate] (dry-run) would drop index ${idx.name}`);
        }
      }
    }
  } catch (e) {
    console.log(`[migrate] index step: ${e.message}`);
    logger.warn(`Index drop: ${e.message}`);
  }
}

async function main() {
  console.log('[migrate] Connecting…');
  await mongoose.connect(config.mongoose.url);
  console.log('[migrate] Connected.\n');
  logger.info(`migrate-yarn-to-yarnCatalogId ${DRY_RUN ? '(dry-run)' : ''}`);

  const steps = [];
  steps.push(await migratePurchaseOrderItems());
  await dropLegacyYarnIndex();
  for (const c of ['yarncones', 'yarntransactions', 'yarninventories', 'yarnrequisitions']) {
    steps.push(await migrateTopLevelYarn(c));
  }
  steps.push(await backfillYarnCatalogIdByName('yarnboxes'));
  console.log('\n[migrate] ▶ yarnboxes yarnCatalogId from PO (poNumber + yarnName + shadeCode)');
  const boxPoT0 = Date.now();
  const boxPo = await backfillYarnBoxCatalogIdsFromPurchaseOrders({ dryRun: DRY_RUN });
  progressLog(
    'yarnboxes from PO (final)',
    boxPo.boxesScanned,
    boxPo.boxesUpdated,
    boxPoT0
  );
  steps.push({
    step: 'yarnboxes.yarnCatalogId from purchase order',
    touched: boxPo.boxesUpdated,
    processed: boxPo.boxesScanned,
  });
  steps.push(await backfillYarnCatalogIdByName('yarncones'));
  steps.push(await backfillYarnCatalogIdByName('yarntransactions'));
  steps.push(await backfillProductBom());

  console.log('\n[migrate] —— summary ——');
  for (const s of steps) {
    const line = `${s.step}: will_update=${s.touched}${s.processed != null ? ` | scanned=${s.processed}` : ''}`;
    console.log(`[migrate] ${line}`);
    logger.info(line);
  }

  await mongoose.disconnect();
  console.log('\n[migrate] Done.\n');
  logger.info('Done.');
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err);
  logger.error(err);
  process.exit(1);
});
