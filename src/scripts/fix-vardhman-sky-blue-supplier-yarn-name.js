#!/usr/bin/env node

/**
 * Fix Vardhman supplier yarnDetails.yarnName for 20s Sky Blue Bamboo.
 *
 * Stored:  20s-Sky Blue-Bamboo/Bamboo
 * Catalog: 20s-Sky Blue-Sky Blue-Bamboo/Bamboo
 *
 * Tear-weight lookup is exact yarnName. UI shows catalog name; save keeps the
 * stored short string. This script copies catalog.yarnName onto that one
 * yarnDetails row (yarnCatalogId match). Does not change tearweight.
 *
 * Dry-run by default.
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/fix-vardhman-sky-blue-supplier-yarn-name.js
 *   NODE_ENV=development node src/scripts/fix-vardhman-sky-blue-supplier-yarn-name.js --apply
 *   NODE_ENV=development node src/scripts/fix-vardhman-sky-blue-supplier-yarn-name.js --mongo-url='mongodb+srv://...' --apply
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { Supplier, YarnCatalog } from '../models/index.js';

const DEFAULT_SUPPLIER_ID = '695e0aa16783dccc7042099c';
const DEFAULT_CATALOG_ID = '6a91688cab55ed40e21c7b45';
const APPLY = process.argv.includes('--apply');

/**
 * @param {string} prefix
 * @returns {string|null}
 */
function getArg(prefix) {
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length).trim() || null;
}

/**
 * @param {string} rawUrl
 * @returns {string}
 */
function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  if (u.endsWith('>')) u = u.slice(0, -1);
  return u;
}

/**
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cli = sanitizeMongoUrl(getArg('--mongo-url=') || '');
  if (cli) return { url: cli, source: '--mongo-url' };
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  return {
    url: sanitizeMongoUrl(String(process.env.MONGODB_URL || process.env.ATLAS_MONGODB_URL || '')),
    source: 'process.env',
  };
}

/**
 * @param {unknown} id
 * @returns {string}
 */
function idStr(id) {
  return id != null ? String(id) : '';
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const supplierId = String(getArg('--supplier-id=') || DEFAULT_SUPPLIER_ID).trim();
  const catalogId = String(getArg('--catalog-id=') || DEFAULT_CATALOG_ID).trim();
  const { url, source } = resolveMongoConnectionString();
  if (!url) throw new Error('MongoDB URL missing. Set MONGODB_URL or pass --mongo-url=');

  logger.info(
    `[fix-vardhman-sky-blue] Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} (${source}) supplier=${supplierId} catalog=${catalogId}`
  );
  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    const catalog = await YarnCatalog.findById(catalogId).select('_id yarnName').lean();
    if (!catalog?.yarnName) {
      throw new Error(`YarnCatalog ${catalogId} not found or missing yarnName`);
    }

    const supplier = await Supplier.findById(supplierId).lean();
    if (!supplier) throw new Error(`Supplier ${supplierId} not found`);

    const matches = (supplier.yarnDetails || []).filter(
      (d) => idStr(d.yarnCatalogId) === catalogId
    );
    if (!matches.length) {
      throw new Error(`No yarnDetails row with yarnCatalogId ${catalogId} on ${supplier.brandName}`);
    }

    const before = matches.map((d) => ({
      yarnName: d.yarnName,
      yarnCatalogId: idStr(d.yarnCatalogId),
      tearweight: d.tearweight,
      shadeNumber: d.shadeNumber,
    }));
    const needsWrite = matches.some((d) => String(d.yarnName || '').trim() !== catalog.yarnName);
    const after = matches.map((d) => ({
      yarnName: catalog.yarnName,
      yarnCatalogId: idStr(d.yarnCatalogId),
      tearweight: d.tearweight,
      shadeNumber: d.shadeNumber,
    }));

    if (!needsWrite) {
      logger.info('[fix-vardhman-sky-blue] Already in sync; nothing to write.');
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            mode: APPLY ? 'apply' : 'dry-run',
            skipped: true,
            reason: 'yarnDetails.yarnName already equals catalog.yarnName',
            supplier: { _id: supplierId, brandName: supplier.brandName },
            catalog: { _id: catalogId, yarnName: catalog.yarnName },
            rows: before,
          },
          null,
          2
        )
      );
      return;
    }

    let modified = 0;
    if (APPLY) {
      const result = await Supplier.updateOne(
        { _id: supplier._id, 'yarnDetails.yarnCatalogId': catalog._id },
        { $set: { 'yarnDetails.$.yarnName': catalog.yarnName } }
      );
      modified = result.modifiedCount || 0;
      if (matches.length > 1) {
        logger.warn(
          `[fix-vardhman-sky-blue] ${matches.length} matching rows; positional $ updated the first only.`
        );
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          mode: APPLY ? 'apply' : 'dry-run',
          mongoSource: source,
          wouldWrite: true,
          written: APPLY,
          modifiedCount: APPLY ? modified : 0,
          supplier: { _id: supplierId, brandName: supplier.brandName, updatedAt: supplier.updatedAt },
          catalog: { _id: catalogId, yarnName: catalog.yarnName },
          before,
          after,
        },
        null,
        2
      )
    );
    if (!APPLY) logger.warn('DRY RUN — no DB writes. Re-run with --apply to commit.');
  } finally {
    await mongoose.disconnect();
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
