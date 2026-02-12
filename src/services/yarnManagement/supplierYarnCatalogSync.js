/**
 * Sync supplier yarnDetails with YarnCatalog: set yarnCatalogId when missing (match by
 * yarnName + yarnType + yarnsubtype) and update yarnName/yarnType/yarnsubtype from catalog
 * when yarnCatalogId is present. Uses .lean() to avoid YarnCatalog post-find hooks.
 */

import mongoose from 'mongoose';
import YarnCatalog from '../../models/yarnManagement/yarnCatalog.model.js';
import YarnType from '../../models/yarnManagement/yarnType.model.js';

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

async function resolveYarnType(typeId, typeCache) {
  if (!typeId) return undefined;
  const id = typeId.toString();
  if (typeCache.has(id)) return typeCache.get(id);
  const yt = await YarnType.findById(typeId).lean().exec();
  const out = yt ? { _id: yt._id, name: yt.name, status: yt.status || 'active' } : undefined;
  typeCache.set(id, out);
  return out;
}

async function resolveYarnSubtype(typeId, subtypeId, subtypeCache) {
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

async function getCatalogDataForSupplier(catalogId, typeCache, subtypeCache) {
  const catalog = await YarnCatalog.findById(catalogId).lean().exec();
  if (!catalog) return null;

  const yarnName = catalog.yarnName ? String(catalog.yarnName).trim() : undefined;
  let yarnType =
    catalog.yarnType && typeof catalog.yarnType === 'object' && catalog.yarnType.name
      ? { _id: catalog.yarnType._id, name: catalog.yarnType.name, status: catalog.yarnType.status || 'active' }
      : undefined;
  if (!yarnType && catalog.yarnType) {
    const typeId = mongoose.Types.ObjectId.isValid(catalog.yarnType) ? catalog.yarnType : catalog.yarnType._id;
    yarnType = await resolveYarnType(typeId, typeCache);
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
    yarnsubtype = await resolveYarnSubtype(typeId, subtypeId, subtypeCache);
  }

  return { yarnName, yarnType, yarnsubtype };
}

/**
 * Run sync for one supplier's yarnDetails. Supplier can be plain object (e.g. from .lean()).
 * @param {Object} supplier - Supplier doc with yarnDetails array
 * @returns {Promise<{ updatedDetails: Array, detailsLinked: number, detailsSynced: number, noMatch: number, catalogNotFound: number }>}
 */
export async function runSyncForSupplier(supplier) {
  const typeCache = new Map();
  const subtypeCache = new Map();
  const yarnDetails = supplier.yarnDetails || [];
  const updatedDetails = [];
  let detailsLinked = 0;
  let detailsSynced = 0;
  let noMatch = 0;
  let catalogNotFound = 0;

  for (const detail of yarnDetails) {
    const existingCatalogId = detail.yarnCatalogId
      ? (detail.yarnCatalogId._id || detail.yarnCatalogId)
      : null;

    if (existingCatalogId) {
      const catalogData = await getCatalogDataForSupplier(existingCatalogId, typeCache, subtypeCache);
      if (!catalogData) {
        updatedDetails.push(detail);
        catalogNotFound += 1;
        continue;
      }
      updatedDetails.push({
        ...detail,
        yarnCatalogId: existingCatalogId,
        yarnName: catalogData.yarnName ?? detail.yarnName,
        yarnType: catalogData.yarnType ?? detail.yarnType,
        yarnsubtype: catalogData.yarnsubtype ?? detail.yarnsubtype,
      });
      detailsSynced += 1;
      continue;
    }

    const catalog = await findMatchingCatalog(detail);
    if (!catalog) {
      updatedDetails.push(detail);
      noMatch += 1;
      continue;
    }

    const catalogData = await getCatalogDataForSupplier(catalog._id, typeCache, subtypeCache);
    if (!catalogData) {
      updatedDetails.push(detail);
      noMatch += 1;
      continue;
    }

    updatedDetails.push({
      ...detail,
      yarnCatalogId: catalog._id,
      yarnName: catalogData.yarnName ?? detail.yarnName,
      yarnType: catalogData.yarnType ?? detail.yarnType,
      yarnsubtype: catalogData.yarnsubtype ?? detail.yarnsubtype,
    });
    detailsLinked += 1;
  }

  return {
    updatedDetails,
    detailsLinked,
    detailsSynced,
    noMatch,
    catalogNotFound,
  };
}
