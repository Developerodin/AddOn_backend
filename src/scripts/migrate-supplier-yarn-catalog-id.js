#!/usr/bin/env node

/**
 * Migration:
 * 1) Add yarnCatalogId to supplier yarnDetails when missing (match by yarnName, yarnType, yarnsubtype).
 * 2) When yarnCatalogId is present, sync yarnName / yarnType / yarnsubtype from current YarnCatalog
 *    so supplier data stays in sync if catalog was changed.
 *
 * Uses .lean() everywhere to avoid YarnCatalog post-find hooks (which can block/hang). Resolves
 * type/subtype in script with caching.
 */

import mongoose from 'mongoose';
import Supplier from '../models/yarnManagement/supplier.model.js';
import YarnCatalog from '../models/yarnManagement/yarnCatalog.model.js';
import YarnType from '../models/yarnManagement/yarnType.model.js';
import config from '../config/config.js';
import logger from '../config/logger.js';

const DRY_RUN = process.argv.includes('--dry-run');

// Caches to avoid repeated DB hits (and to avoid triggering YarnCatalog post-find hooks)
const typeCache = new Map(); // typeId -> { _id, name, status }
const subtypeCache = new Map(); // `${typeId}:${subtypeId}` -> { _id, subtype, countSize }

function getCatalogTypeId(catalog) {
  if (!catalog) return null;
  const yt = catalog.yarnType;
  if (!yt) return null;
  if (mongoose.Types.ObjectId.isValid(yt) && typeof yt !== 'object') return yt;
  return yt._id || null;
}

function getCatalogSubtypeId(catalog) {
  if (!catalog) return null;
  const ys = catalog.yarnSubtype;
  if (!ys) return null;
  if (mongoose.Types.ObjectId.isValid(ys) && typeof ys !== 'object') return ys;
  return ys._id || null;
}

async function resolveYarnType(typeId) {
  if (!typeId) return undefined;
  const id = typeId.toString();
  if (typeCache.has(id)) return typeCache.get(id);
  const yt = await YarnType.findById(typeId).lean().exec();
  const out = yt ? { _id: yt._id, name: yt.name, status: yt.status || 'active' } : undefined;
  typeCache.set(id, out);
  return out;
}

async function resolveYarnSubtype(typeId, subtypeId) {
  if (!typeId || !subtypeId) return undefined;
  const key = `${typeId.toString()}:${subtypeId.toString()}`;
  if (subtypeCache.has(key)) return subtypeCache.get(key);
  const yt = await YarnType.findById(typeId).lean().exec();
  const detail = yt?.details?.find((d) => d._id.toString() === subtypeId.toString());
  const out = detail
    ? { _id: detail._id, subtype: detail.subtype, countSize: detail.countSize || [] }
    : undefined;
  subtypeCache.set(key, out);
  return out;
}

/**
 * Find YarnCatalog that matches supplier yarnDetail by yarnName, yarnType, yarnsubtype
 */
async function findMatchingCatalog(detail) {
  const yarnName = detail.yarnName ? String(detail.yarnName).trim() : null;
  if (!yarnName) return null;

  const typeId = detail.yarnType?._id || (mongoose.Types.ObjectId.isValid(detail.yarnType) ? detail.yarnType : null);
  const subtypeId =
    detail.yarnsubtype?._id ||
    (mongoose.Types.ObjectId.isValid(detail.yarnsubtype) ? detail.yarnsubtype : null);

  const candidates = await YarnCatalog.find({
    yarnName,
    status: { $nin: ['deleted'] },
  })
    .lean()
    .exec();

  for (const cat of candidates) {
    const catTypeId = getCatalogTypeId(cat);
    const catSubtypeId = getCatalogSubtypeId(cat);
    const typeMatch = !typeId || (catTypeId && catTypeId.toString() === (typeId && typeId.toString()));
    const subtypeMatch = !subtypeId || (catSubtypeId && catSubtypeId.toString() === (subtypeId && subtypeId.toString()));
    if (typeMatch && subtypeMatch) return cat;
  }
  return null;
}

/**
 * Get catalog data in supplier shape using only lean queries (no post-find hooks).
 */
async function getCatalogDataForSupplier(catalogId) {
  const catalog = await YarnCatalog.findById(catalogId).lean().exec();
  if (!catalog) return null;

  const yarnName = catalog.yarnName ? String(catalog.yarnName).trim() : undefined;
  let yarnType =
    catalog.yarnType && typeof catalog.yarnType === 'object' && catalog.yarnType.name
      ? { _id: catalog.yarnType._id, name: catalog.yarnType.name, status: catalog.yarnType.status || 'active' }
      : undefined;
  if (!yarnType && catalog.yarnType) {
    const typeId = mongoose.Types.ObjectId.isValid(catalog.yarnType) ? catalog.yarnType : catalog.yarnType._id;
    yarnType = await resolveYarnType(typeId);
  }

  let yarnsubtype =
    catalog.yarnSubtype && typeof catalog.yarnSubtype === 'object' && catalog.yarnSubtype.subtype !== undefined
      ? {
          _id: catalog.yarnSubtype._id,
          subtype: catalog.yarnSubtype.subtype,
          countSize: catalog.yarnSubtype.countSize || [],
        }
      : undefined;
  if (!yarnsubtype && catalog.yarnSubtype && catalog.yarnType) {
    const typeId = getCatalogTypeId(catalog);
    const subtypeId = mongoose.Types.ObjectId.isValid(catalog.yarnSubtype) ? catalog.yarnSubtype : catalog.yarnSubtype._id;
    yarnsubtype = await resolveYarnSubtype(typeId, subtypeId);
  }

  return { yarnName, yarnType, yarnsubtype };
}

const run = async () => {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    if (DRY_RUN) logger.info('DRY RUN – no writes will be performed');

    logger.info('Loading suppliers with yarnDetails...');
    const suppliers = await Supplier.find({ 'yarnDetails.0': { $exists: true } }).lean().exec();
    const totalSuppliers = suppliers.length;
    logger.info(`Loaded ${totalSuppliers} suppliers.`);

    let suppliersUpdated = 0;
    let detailsLinked = 0;
    let detailsSynced = 0;
    let detailsNoMatch = 0;
    let detailsCatalogNotFound = 0;

    for (let i = 0; i < suppliers.length; i++) {
      const supplier = suppliers[i];
      if ((i + 1) % 10 === 0 || i === 0) {
        logger.info(`Processing supplier ${i + 1}/${totalSuppliers}: ${supplier.brandName}`);
      }

      const yarnDetails = supplier.yarnDetails || [];
      if (!yarnDetails.length) continue;

      let modified = false;
      const updatedDetails = [];

      for (const detail of yarnDetails) {
        const existingCatalogId = detail.yarnCatalogId
          ? (detail.yarnCatalogId._id || detail.yarnCatalogId)
          : null;

        if (existingCatalogId) {
          const catalogData = await getCatalogDataForSupplier(existingCatalogId);
          if (!catalogData) {
            updatedDetails.push(detail);
            detailsCatalogNotFound += 1;
            continue;
          }
          updatedDetails.push({
            ...detail,
            yarnCatalogId: existingCatalogId,
            yarnName: catalogData.yarnName ?? detail.yarnName,
            yarnType: catalogData.yarnType ?? detail.yarnType,
            yarnsubtype: catalogData.yarnsubtype ?? detail.yarnsubtype,
          });
          modified = true;
          detailsSynced += 1;
          continue;
        }

        const catalog = await findMatchingCatalog(detail);
        if (!catalog) {
          updatedDetails.push(detail);
          detailsNoMatch += 1;
          continue;
        }

        const catalogData = await getCatalogDataForSupplier(catalog._id);
        if (!catalogData) {
          updatedDetails.push(detail);
          detailsNoMatch += 1;
          continue;
        }

        updatedDetails.push({
          ...detail,
          yarnCatalogId: catalog._id,
          yarnName: catalogData.yarnName ?? detail.yarnName,
          yarnType: catalogData.yarnType ?? detail.yarnType,
          yarnsubtype: catalogData.yarnsubtype ?? detail.yarnsubtype,
        });
        modified = true;
        detailsLinked += 1;
      }

      if (modified && !DRY_RUN) {
        await Supplier.updateOne({ _id: supplier._id }, { $set: { yarnDetails: updatedDetails } });
        suppliersUpdated += 1;
      } else if (modified && DRY_RUN) {
        suppliersUpdated += 1;
      }
    }

    logger.info(
      `Done. Suppliers to update: ${suppliersUpdated}, Details linked (id added): ${detailsLinked}, Details synced (from catalog): ${detailsSynced}, No catalog match: ${detailsNoMatch}, Catalog not found: ${detailsCatalogNotFound}${DRY_RUN ? ' (DRY RUN)' : ''}`
    );
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB.');
  }
};

run();
