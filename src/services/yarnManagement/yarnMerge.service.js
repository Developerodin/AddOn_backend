import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import YarnCatalog from '../../models/yarnManagement/yarnCatalog.model.js';
import Product from '../../models/product.model.js';
import YarnPurchaseOrder from '../../models/yarnReq/yarnPurchaseOrder.model.js';
import YarnBox from '../../models/yarnReq/yarnBox.model.js';
import YarnCone from '../../models/yarnReq/yarnCone.model.js';
import YarnInventory from '../../models/yarnReq/yarnInventory.model.js';
import YarnTransaction from '../../models/yarnReq/yarnTransaction.model.js';
import YarnRequisition from '../../models/yarnReq/yarnRequisition.model.js';
import Supplier from '../../models/yarnManagement/supplier.model.js';

/**
 * Find potential duplicate yarn catalog entries.
 * Groups by yarnType + countSize + blend (core identity) and returns groups with >1 entry.
 * colorFamily and pantonName differences are the most common source of "false" duplicates.
 */
export const findDuplicateYarns = async () => {
  const pipeline = [
    { $match: { status: { $ne: 'suspended' } } },
    {
      $group: {
        _id: {
          yarnType: '$yarnType._id',
          yarnTypeName: '$yarnType.name',
          countSize: '$countSize._id',
          countSizeName: '$countSize.name',
          blend: '$blend._id',
          blendName: '$blend.name',
          yarnSubtype: '$yarnSubtype._id',
          yarnSubtypeName: '$yarnSubtype.subtype',
        },
        entries: {
          $push: {
            id: '$_id',
            yarnName: '$yarnName',
            colorFamily: '$colorFamily',
            pantonName: '$pantonName',
            pantonShade: '$pantonShade',
            status: '$status',
            createdAt: '$createdAt',
          },
        },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ];

  const groups = await YarnCatalog.aggregate(pipeline);

  return groups.map((g) => ({
    key: {
      yarnType: { id: g._id.yarnType, name: g._id.yarnTypeName },
      countSize: { id: g._id.countSize, name: g._id.countSizeName },
      blend: { id: g._id.blend, name: g._id.blendName },
      yarnSubtype: g._id.yarnSubtype ? { id: g._id.yarnSubtype, name: g._id.yarnSubtypeName } : null,
    },
    count: g.count,
    entries: g.entries.map((e) => ({
      id: e.id.toString(),
      yarnName: e.yarnName,
      colorFamily: e.colorFamily
        ? { id: e.colorFamily._id?.toString(), name: e.colorFamily.name, colorCode: e.colorFamily.colorCode }
        : null,
      pantonName: e.pantonName || null,
      pantonShade: e.pantonShade || null,
      status: e.status,
      createdAt: e.createdAt,
    })),
  }));
};

const toNumber = (v) => Math.max(0, Number(v ?? 0));

/**
 * References to "duplicate" yarn by catalog ids and/or yarnName strings stored outside YarnCatalog (operational aliases).
 */
const buildDupRefQuery = (allOldIds, allOldNames) => {
  const parts = [];
  if (allOldIds.length) parts.push({ yarnCatalogId: { $in: allOldIds } });
  if (allOldNames.length) parts.push({ yarnName: { $in: allOldNames } });
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : { $or: parts };
};

/**
 * Count how many documents reference old yarn IDs/names in each collection.
 * Used for dry-run previews.
 */
const countAffectedDocuments = async (allOldIds, allOldNames) => {
  const [products, purchaseOrders, yarnBoxes, yarnCones, yarnTransactions, yarnRequisitions, yarnInventories, suppliers] =
    await Promise.all([
      Product.countDocuments({
        $or: [{ 'bom.yarnCatalogId': { $in: allOldIds } }, { bom: { $elemMatch: { yarnName: { $in: allOldNames } } } }],
      }),
      YarnPurchaseOrder.countDocuments({
        $or: [{ 'poItems.yarnCatalogId': { $in: allOldIds } }, { 'poItems.yarnName': { $in: allOldNames } }],
      }),
      YarnBox.countDocuments({
        $or: [{ yarnName: { $in: allOldNames } }, { yarnCatalogId: { $in: allOldIds } }],
      }),
      YarnCone.countDocuments({ $or: [{ yarnCatalogId: { $in: allOldIds } }, { yarnName: { $in: allOldNames } }] }),
      YarnTransaction.countDocuments({ $or: [{ yarnCatalogId: { $in: allOldIds } }, { yarnName: { $in: allOldNames } }] }),
      (() => {
        const q = buildDupRefQuery(allOldIds, allOldNames);
        return q ? YarnRequisition.countDocuments(q) : Promise.resolve(0);
      })(),
      (() => {
        const q = buildDupRefQuery(allOldIds, allOldNames);
        return q ? YarnInventory.countDocuments(q) : Promise.resolve(0);
      })(),
      Supplier.countDocuments({
        $or: [{ 'yarnDetails.yarnCatalogId': { $in: allOldIds } }, { 'yarnDetails.yarnName': { $in: allOldNames } }],
      }),
    ]);

  return { products, purchaseOrders, yarnBoxes, yarnCones, yarnTransactions, yarnRequisitions, yarnInventories, suppliers };
};

/**
 * Merge inventory rows from duplicate yarns into the canonical yarn's inventory.
 * Handles the unique constraint on YarnInventory.yarnCatalogId.
 */
const mergeInventories = async (canonicalOid, canonicalName, allOldIds, allOldNames) => {
  const dupMatch = buildDupRefQuery(allOldIds, allOldNames);
  if (!dupMatch) {
    return { merged: 0, deleted: 0 };
  }

  const canonicalInv = await YarnInventory.findOne({ yarnCatalogId: canonicalOid });
  const duplicateInvs = await YarnInventory.find(dupMatch);

  if (duplicateInvs.length === 0) {
    return { merged: 0, deleted: 0 };
  }

  if (canonicalInv) {
    for (const dupInv of duplicateInvs) {
      for (const bucket of ['totalInventory', 'longTermInventory', 'shortTermInventory']) {
        if (!dupInv[bucket]) continue;
        if (!canonicalInv[bucket]) {
          canonicalInv[bucket] = { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, totalBlockedWeight: 0, numberOfCones: 0 };
        }
        canonicalInv[bucket].totalWeight = toNumber(canonicalInv[bucket].totalWeight) + toNumber(dupInv[bucket].totalWeight);
        canonicalInv[bucket].totalTearWeight =
          toNumber(canonicalInv[bucket].totalTearWeight) + toNumber(dupInv[bucket].totalTearWeight);
        canonicalInv[bucket].totalNetWeight =
          toNumber(canonicalInv[bucket].totalNetWeight) + toNumber(dupInv[bucket].totalNetWeight);
        canonicalInv[bucket].numberOfCones =
          toNumber(canonicalInv[bucket].numberOfCones) + toNumber(dupInv[bucket].numberOfCones);
      }
      canonicalInv.blockedNetWeight = toNumber(canonicalInv.blockedNetWeight) + toNumber(dupInv.blockedNetWeight);
    }
    canonicalInv.yarnName = canonicalName;
    await canonicalInv.save();
    await YarnInventory.updateMany({ yarnCatalogId: canonicalOid }, { $unset: { yarn: '' } });
    await YarnInventory.deleteMany({ _id: { $in: duplicateInvs.map((d) => d._id) } });
    return { merged: duplicateInvs.length, deleted: duplicateInvs.length };
  }

  const firstInv = duplicateInvs[0];
  firstInv.yarnCatalogId = canonicalOid;
  firstInv.yarnName = canonicalName;

  for (let i = 1; i < duplicateInvs.length; i++) {
    const dupInv = duplicateInvs[i];
    for (const bucket of ['totalInventory', 'longTermInventory', 'shortTermInventory']) {
      if (!dupInv[bucket]) continue;
      if (!firstInv[bucket]) {
        firstInv[bucket] = { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, totalBlockedWeight: 0, numberOfCones: 0 };
      }
      firstInv[bucket].totalWeight = toNumber(firstInv[bucket].totalWeight) + toNumber(dupInv[bucket].totalWeight);
      firstInv[bucket].totalTearWeight = toNumber(firstInv[bucket].totalTearWeight) + toNumber(dupInv[bucket].totalTearWeight);
      firstInv[bucket].totalNetWeight = toNumber(firstInv[bucket].totalNetWeight) + toNumber(dupInv[bucket].totalNetWeight);
      firstInv[bucket].numberOfCones = toNumber(firstInv[bucket].numberOfCones) + toNumber(dupInv[bucket].numberOfCones);
    }
    firstInv.blockedNetWeight = toNumber(firstInv.blockedNetWeight) + toNumber(dupInv.blockedNetWeight);
  }
  await firstInv.save();
  await YarnInventory.updateMany({ yarnCatalogId: canonicalOid }, { $unset: { yarn: '' } });

  const restIds = duplicateInvs.slice(1).map((d) => d._id);
  let deletedCount = duplicateInvs.length - 1;
  if (restIds.length > 0) {
    await YarnInventory.deleteMany({ _id: { $in: restIds } });
  }
  return { merged: duplicateInvs.length, deleted: deletedCount };
};

/**
 * Merge requisitions: keep canonical's requisition, delete duplicates'.
 * If canonical has no requisition, re-point the first duplicate's.
 */
const mergeRequisitions = async (canonicalOid, canonicalName, allOldIds, allOldNames) => {
  const canonicalReq = await YarnRequisition.findOne({ yarnCatalogId: canonicalOid });
  const dupQ = buildDupRefQuery(allOldIds, allOldNames);
  if (!dupQ) {
    return { migrated: 0, deleted: 0 };
  }

  if (canonicalReq) {
    const deleteResult = await YarnRequisition.deleteMany(dupQ);
    return { migrated: 0, deleted: deleteResult.deletedCount };
  }

  const firstDupReq = await YarnRequisition.findOne(dupQ);
  if (!firstDupReq) {
    return { migrated: 0, deleted: 0 };
  }

  firstDupReq.yarnCatalogId = canonicalOid;
  firstDupReq.yarnName = canonicalName;
  await firstDupReq.save();
  await YarnRequisition.updateOne({ _id: firstDupReq._id }, { $unset: { yarn: '' } });

  const deleteResult = await YarnRequisition.deleteMany({
    $and: [dupQ, { _id: { $ne: firstDupReq._id } }],
  });
  return { migrated: 1, deleted: deleteResult.deletedCount };
};

/**
 * Resolve a yarn identifier (ID or name) to a YarnCatalog document.
 * Tries ObjectId first, falls back to exact yarnName match, then case-insensitive.
 */
const resolveYarn = async (idOrName, label = 'Yarn') => {
  if (mongoose.Types.ObjectId.isValid(idOrName)) {
    const doc = await YarnCatalog.findById(idOrName).lean();
    if (doc) return doc;
  }

  const name = String(idOrName).trim();
  let doc = await YarnCatalog.findOne({ yarnName: name, status: { $ne: 'suspended' } }).lean();
  if (!doc) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    doc = await YarnCatalog.findOne({
      yarnName: { $regex: new RegExp(`^${escaped}$`, 'i') },
      status: { $ne: 'suspended' },
    }).lean();
  }

  if (!doc) {
    throw new ApiError(httpStatus.NOT_FOUND, `${label} not found in yarn catalog: "${idOrName}"`);
  }
  return doc;
};

/**
 * Merge duplicate yarn catalog entries into one canonical entry,
 * OR repoint operational data that uses yarn names/lines missing from YarnCatalog.
 *
 * @param {Object} params
 * @param {string} [params.canonicalId] - ID of the yarn to keep
 * @param {string} [params.canonicalName] - Name of the yarn to keep (alternative to canonicalId)
 * @param {string[]} [params.duplicateIds] - IDs of yarns to merge (must exist as YarnCatalog)
 * @param {string[]} [params.duplicateNames] - Names matching YarnCatalog, and/or operational-only aliases when allowDuplicateNamesNotInCatalog is true (exact yarnName match in operational collections).
 * @param {boolean} [params.allowDuplicateNamesNotInCatalog=false] - Allow unmatched duplicateNames (migrate by name only)
 * @param {Object} options
 * @param {boolean} [options.dryRun=false] - If true, only report what would change
 * @returns {Object} Summary of updates
 */
export const mergeYarns = async (
  { canonicalId, canonicalName, duplicateIds, duplicateNames, allowDuplicateNamesNotInCatalog = false },
  { dryRun = false } = {}
) => {
  const canonical = await resolveYarn(canonicalId || canonicalName, 'Canonical yarn');
  const canonicalOid = canonical._id;
  const resolvedCanonicalName = canonical.yarnName;

  const catalogDuplicateDocsMap = new Map();
  const operationalOnlyNames = new Set();

  const rawDuplicateProvidedCount = (duplicateIds?.length ?? 0) + (duplicateNames?.length ?? 0);
  if (rawDuplicateProvidedCount === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Provide at least one duplicate yarn (duplicateIds or duplicateNames)');
  }

  if (duplicateIds?.length) {
    for (const id of duplicateIds) {
      const doc = await resolveYarn(id, 'Duplicate yarn');
      const sid = doc._id.toString();
      if (sid === canonicalOid.toString()) continue;
      catalogDuplicateDocsMap.set(sid, doc);
    }
  }

  if (duplicateNames?.length) {
    for (const name of duplicateNames) {
      const trimmed = String(name).trim();
      if (!trimmed) continue;

      try {
        const doc = await resolveYarn(trimmed, 'Duplicate yarn');
        const sid = doc._id.toString();
        if (sid === canonicalOid.toString()) continue;
        catalogDuplicateDocsMap.set(sid, doc);
      } catch (e) {
        if (allowDuplicateNamesNotInCatalog) {
          if (trimmed.toLowerCase() === resolvedCanonicalName.toLowerCase()) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Operational duplicate yarn name cannot match canonical yarn name: "${trimmed}"`
            );
          }
          operationalOnlyNames.add(trimmed);
        } else {
          throw e;
        }
      }
    }
  }

  const filteredCatalogDuplicates = [...catalogDuplicateDocsMap.values()];
  const duplicateOids = filteredCatalogDuplicates.map((d) => d._id);
  const duplicateYarnNamesFromCatalog = [...new Set(filteredCatalogDuplicates.map((d) => d.yarnName).filter(Boolean))];
  const operationalOnlyDuplicateNames = [...operationalOnlyNames];

  const duplicateYarnNames = [...new Set([...duplicateYarnNamesFromCatalog, ...operationalOnlyDuplicateNames])].filter(
    (n) => n.toLowerCase() !== resolvedCanonicalName.toLowerCase()
  );

  if (filteredCatalogDuplicates.length === 0 && operationalOnlyDuplicateNames.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'All provided duplicates resolve to the canonical yarn itself; nothing to merge'
    );
  }

  const report = {
    dryRun,
    canonicalId: canonicalOid.toString(),
    canonicalName: resolvedCanonicalName,
    duplicateIds: duplicateOids.map((id) => id.toString()),
    duplicateNames: duplicateYarnNames,
    operationalOnlyDuplicateNames,
    allowDuplicateNamesNotInCatalog,
    updates: {},
  };

  // --- Dry-run: just count affected documents ---
  if (dryRun) {
    report.updates = await countAffectedDocuments(duplicateOids, duplicateYarnNames);
    return report;
  }

  // --- Live merge ---

  // 1. Product BOM: match by yarnCatalogId or yarnName (same idea as migrate-yarn-to-yarnCatalogId backfill)
  const productResult = await Product.updateMany(
    {
      $or: [
        { 'bom.yarnCatalogId': { $in: duplicateOids } },
        { bom: { $elemMatch: { yarnName: { $in: duplicateYarnNames } } } },
      ],
    },
    {
      $set: {
        'bom.$[b].yarnCatalogId': canonicalOid,
        'bom.$[b].yarnName': resolvedCanonicalName,
      },
    },
    {
      arrayFilters: [
        { $or: [{ 'b.yarnCatalogId': { $in: duplicateOids } }, { 'b.yarnName': { $in: duplicateYarnNames } }] },
      ],
    }
  );
  report.updates.products = productResult.modifiedCount;

  // 2. YarnPurchaseOrder: poItems[].yarnCatalogId + yarnName; drop legacy poItems[].yarn from migration
  const poResult = await YarnPurchaseOrder.updateMany(
    { $or: [{ 'poItems.yarnCatalogId': { $in: duplicateOids } }, { 'poItems.yarnName': { $in: duplicateYarnNames } }] },
    {
      $set: {
        'poItems.$[p].yarnCatalogId': canonicalOid,
        'poItems.$[p].yarnName': resolvedCanonicalName,
      },
      $unset: { 'poItems.$[p].yarn': '' },
    },
    {
      arrayFilters: [
        { $or: [{ 'p.yarnCatalogId': { $in: duplicateOids } }, { 'p.yarnName': { $in: duplicateYarnNames } }] },
      ],
    }
  );
  report.updates.purchaseOrders = poResult.modifiedCount;

  // 3. YarnBox: by duplicate name or catalog id (backfill may have set id without renaming)
  const boxResult = await YarnBox.updateMany(
    { $or: [{ yarnName: { $in: duplicateYarnNames } }, { yarnCatalogId: { $in: duplicateOids } }] },
    { $set: { yarnName: resolvedCanonicalName, yarnCatalogId: canonicalOid } }
  );
  report.updates.yarnBoxes = boxResult.modifiedCount;

  // 4. YarnCone — legacy top-level `yarn` removed by migrate-yarn-to-yarnCatalogId
  const coneResult = await YarnCone.updateMany(
    { $or: [{ yarnCatalogId: { $in: duplicateOids } }, { yarnName: { $in: duplicateYarnNames } }] },
    { $set: { yarnCatalogId: canonicalOid, yarnName: resolvedCanonicalName }, $unset: { yarn: '' } }
  );
  report.updates.yarnCones = coneResult.modifiedCount;

  // 5. YarnTransaction
  const txResult = await YarnTransaction.updateMany(
    { $or: [{ yarnCatalogId: { $in: duplicateOids } }, { yarnName: { $in: duplicateYarnNames } }] },
    { $set: { yarnCatalogId: canonicalOid, yarnName: resolvedCanonicalName }, $unset: { yarn: '' } }
  );
  report.updates.yarnTransactions = txResult.modifiedCount;

  // 6. YarnRequisition: merge/delete duplicates
  const reqResult = await mergeRequisitions(canonicalOid, resolvedCanonicalName, duplicateOids, duplicateYarnNames);
  report.updates.yarnRequisitions = reqResult;

  // 7. YarnInventory: merge inventory rows (unique yarnCatalogId)
  const invResult = await mergeInventories(canonicalOid, resolvedCanonicalName, duplicateOids, duplicateYarnNames);
  report.updates.yarnInventories = invResult;

  // 8. Supplier: yarnDetails[].yarnCatalogId + yarnName
  const supplierResult = await Supplier.updateMany(
    {
      $or: [
        { 'yarnDetails.yarnCatalogId': { $in: duplicateOids } },
        { 'yarnDetails.yarnName': { $in: duplicateYarnNames } },
      ],
    },
    {
      $set: {
        'yarnDetails.$[d].yarnCatalogId': canonicalOid,
        'yarnDetails.$[d].yarnName': resolvedCanonicalName,
      },
      $unset: { 'yarnDetails.$[d].yarn': '' },
    },
    {
      arrayFilters: [
        { $or: [{ 'd.yarnCatalogId': { $in: duplicateOids } }, { 'd.yarnName': { $in: duplicateYarnNames } }] },
      ],
    }
  );
  report.updates.suppliers = supplierResult.modifiedCount;

  // 9. Delete duplicate YarnCatalog entries
  const catalogResult = await YarnCatalog.deleteMany({ _id: { $in: duplicateOids } });
  report.updates.yarnCatalogsDeleted = catalogResult.deletedCount;

  return report;
};

/**
 * Bulk merge: process an array of merge operations in sequence.
 *
 * @param {Array<Object>} merges - Each item: { canonicalId?, canonicalName?, duplicateIds?, duplicateNames?, allowDuplicateNamesNotInCatalog? }
 * @param {Object} options
 * @param {boolean} [options.dryRun=false]
 * @returns {Object} Aggregated results
 */
export const bulkMergeYarns = async (merges, { dryRun = false } = {}) => {
  const results = [];
  const errors = [];

  for (let i = 0; i < merges.length; i++) {
    const entry = merges[i];
    const label = entry.canonicalName || entry.canonicalId || `#${i + 1}`;
    try {
      const report = await mergeYarns(
        {
          canonicalId: entry.canonicalId,
          canonicalName: entry.canonicalName,
          duplicateIds: entry.duplicateIds,
          duplicateNames: entry.duplicateNames,
          allowDuplicateNamesNotInCatalog: entry.allowDuplicateNamesNotInCatalog === true,
        },
        { dryRun }
      );
      results.push(report);
    } catch (error) {
      errors.push({ index: i, canonical: label, error: error.message });
    }
  }

  return {
    dryRun,
    total: merges.length,
    succeeded: results.length,
    failed: errors.length,
    results,
    errors,
  };
};
