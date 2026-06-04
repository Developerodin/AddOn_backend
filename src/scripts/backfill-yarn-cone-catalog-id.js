#!/usr/bin/env node
/**
 * Backfills YarnCone.yarnCatalogId for cones missing the field.
 *
 * Resolution order (per cone): parent box → yarnName → PO line → latest yarn txn.
 * Optionally backfills YarnBox.yarnCatalogId from PO first (--skip-boxes to omit).
 *
 * Usage (from AddOn_backend):
 *   node src/scripts/backfill-yarn-cone-catalog-id.js
 *   node src/scripts/backfill-yarn-cone-catalog-id.js --apply
 *   node src/scripts/backfill-yarn-cone-catalog-id.js --apply --po=PO-2026-1166
 *   node src/scripts/backfill-yarn-cone-catalog-id.js --apply --limit=500
 *   node src/scripts/backfill-yarn-cone-catalog-id.js --apply --skip-boxes
 */

import url from 'url';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try {
    return _origUrlParse.call(this, urlStr, ...args);
  } catch {
    return _origUrlParse.call(this, String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2'), ...args);
  }
};

import mongoose from 'mongoose';
import config from '../config/config.js';
import { YarnCone } from '../models/index.js';
import { activeYarnConeMatch } from '../services/yarnManagement/yarnStockActiveFilters.js';
import { backfillYarnBoxCatalogIdsFromPurchaseOrders } from '../services/yarnManagement/yarnBoxCatalogIdBackfill.service.js';
import { resolveYarnCatalogIdForCone } from '../services/yarnManagement/yarnConeCatalogResolve.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

/** @type {Record<string, unknown>} */
const MONGO_CONNECT_OPTIONS = { useNewUrlParser: true, useUnifiedTopology: true };

/**
 * @param {string} flag
 * @returns {string|undefined}
 */
function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

const apply = process.argv.includes('--apply');
const skipBoxes = process.argv.includes('--skip-boxes');
const poFilter = argValue('--po');
const limitRaw = argValue('--limit');
const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10)) : null;

/**
 * @param {string} rawUrl
 * @returns {string}
 */
function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  return u;
}

async function main() {
  const mongoUrl = sanitizeMongoUrl(config?.mongoose?.url || process.env.MONGODB_URL || '');
  if (!mongoUrl) throw new Error('MONGODB_URL missing');

  await mongoose.connect(mongoUrl, MONGO_CONNECT_OPTIONS);

  if (!skipBoxes) {
    const boxResult = await backfillYarnBoxCatalogIdsFromPurchaseOrders({ dryRun: !apply });
    console.log('[boxes]', boxResult);
  }

  const filter = {
    ...activeYarnConeMatch,
    $or: [{ yarnCatalogId: { $exists: false } }, { yarnCatalogId: null }],
  };
  if (poFilter) filter.poNumber = poFilter;

  const cursor = YarnCone.find(filter).sort({ updatedAt: -1 }).cursor();

  let scanned = 0;
  let updated = 0;
  const bySource = {};
  const unmatched = [];

  for await (const cone of cursor) {
    if (limit != null && scanned >= limit) break;
    scanned += 1;

    const { catalogId, source } = await resolveYarnCatalogIdForCone(cone);
    if (!catalogId) {
      unmatched.push({
        _id: String(cone._id),
        barcode: cone.barcode,
        poNumber: cone.poNumber,
        boxId: cone.boxId,
        yarnName: cone.yarnName,
        issueStatus: cone.issueStatus,
      });
      continue;
    }

    bySource[source] = (bySource[source] || 0) + 1;
    updated += 1;

    if (apply) {
      await YarnCone.updateOne({ _id: cone._id }, { $set: { yarnCatalogId: catalogId } });
    }
  }

  const reportDir = path.join(BACKEND_ROOT, 'reports');
  const unmatchedPath = path.join(reportDir, 'cones-catalog-id-backfill-unmatched.json');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(unmatchedPath, JSON.stringify(unmatched, null, 2), 'utf8');

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        poFilter: poFilter || null,
        limit,
        scanned,
        wouldUpdate: updated,
        unmatched: unmatched.length,
        bySource,
        unmatchedReport: unmatchedPath,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
