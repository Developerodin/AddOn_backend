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
 * Count how many documents reference old yarn IDs/names in each collection.
 * Used for dry-run previews.
 */
const countAffectedDocuments = async (allOldIds, allOldNames) => {
  const [products, purchaseOrders, yarnBoxes, yarnCones, yarnTransactions, yarnRequisitions, yarnInventories, suppliers] =
    await Promise.all([
      Product.countDocuments({ 'bom.yarnCatalogId': { $in: allOldIds } }),
      YarnPurchaseOrder.countDocuments({
        $or: [{ 'poItems.yarn': { $in: allOldIds } }, { 'poItems.yarnName': { $in: allOldNames } }],
      }),
      YarnBox.countDocuments({ yarnName: { $in: allOldNames } }),
      YarnCone.countDocuments({ $or: [{ yarn: { $in: allOldIds } }, { yarnName: { $in: allOldNames } }] }),
      YarnTransaction.countDocuments({ $or: [{ yarn: { $in: allOldIds } }, { yarnName: { $in: allOldNames } }] }),
      YarnRequisition.countDocuments({ yarn: { $in: allOldIds } }),
      YarnInventory.countDocuments({ yarn: { $in: allOldIds } }),
      Supplier.countDocuments({
        $or: [{ 'yarnDetails.yarnCatalogId': { $in: allOldIds } }, { 'yarnDetails.yarnName': { $in: allOldNames } }],
      }),
    ]);

  return { products, purchaseOrders, yarnBoxes, yarnCones, yarnTransactions, yarnRequisitions, yarnInventories, suppliers };
};

/**
 * Merge inventory rows from duplicate yarns into the canonical yarn's inventory.
 * Handles the unique constraint on YarnInventory.yarn.
 */
const mergeInventories = async (canonicalOid, canonicalName, allOldIds) => {
  const canonicalInv = await YarnInventory.findOne({ yarn: canonicalOid });
  const duplicateInvs = await YarnInventory.find({ yarn: { $in: allOldIds } });

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
  } else {
    // No canonical inventory yet; re-point the first duplicate's row
    const firstInv = duplicateInvs[0];
    firstInv.yarn = canonicalOid;
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
  }

  const deleteResult = await YarnInventory.deleteMany({ yarn: { $in: allOldIds } });
  return { merged: duplicateInvs.length, deleted: deleteResult.deletedCount };
};

/**
 * Merge requisitions: keep canonical's requisition, delete duplicates'.
 * If canonical has no requisition, re-point the first duplicate's.
 */
const mergeRequisitions = async (canonicalOid, canonicalName, allOldIds) => {
  const canonicalReq = await YarnRequisition.findOne({ yarn: canonicalOid });

  if (canonicalReq) {
    const deleteResult = await YarnRequisition.deleteMany({ yarn: { $in: allOldIds } });
    return { migrated: 0, deleted: deleteResult.deletedCount };
  }

  const firstDupReq = await YarnRequisition.findOne({ yarn: { $in: allOldIds } });
  if (!firstDupReq) {
    return { migrated: 0, deleted: 0 };
  }

  firstDupReq.yarn = canonicalOid;
  firstDupReq.yarnName = canonicalName;
  await firstDupReq.save();

  const deleteResult = await YarnRequisition.deleteMany({ yarn: { $in: allOldIds } });
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
 * Resolve an array of yarn identifiers (IDs or names) to YarnCatalog documents.
 */
const resolveYarns = async (idsOrNames, label = 'Duplicate yarn') => {
  const docs = [];
  const notFound = [];

  for (const val of idsOrNames) {
    try {
      docs.push(await resolveYarn(val, label));
    } catch {
      notFound.push(val);
    }
  }

  if (notFound.length > 0) {
    throw new ApiError(httpStatus.NOT_FOUND, `${label}(s) not found in yarn catalog: ${notFound.map((n) => `"${n}"`).join(', ')}`);
  }
  return docs;
};

/**
 * Merge duplicate yarn catalog entries into one canonical entry.
 * Updates all references across 9 collections.
 *
 * Accepts IDs or yarn names (or a mix). Names are resolved to catalog entries automatically.
 *
 * @param {Object} params
 * @param {string} [params.canonicalId] - ID of the yarn to keep
 * @param {string} [params.canonicalName] - Name of the yarn to keep (alternative to canonicalId)
 * @param {string[]} [params.duplicateIds] - IDs of yarns to merge
 * @param {string[]} [params.duplicateNames] - Names of yarns to merge (alternative to duplicateIds)
 * @param {Object} options
 * @param {boolean} [options.dryRun=false] - If true, only report what would change
 * @returns {Object} Summary of updates
 */
export const mergeYarns = async (
  { canonicalId, canonicalName, duplicateIds, duplicateNames },
  { dryRun = false } = {}
) => {
  // --- Resolve canonical yarn ---
  const canonical = await resolveYarn(canonicalId || canonicalName, 'Canonical yarn');
  const canonicalOid = canonical._id;
  const resolvedCanonicalName = canonical.yarnName;

  // --- Resolve duplicate yarns ---
  const rawDuplicateList = [...(duplicateIds || []), ...(duplicateNames || [])];
  if (rawDuplicateList.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Provide at least one duplicate yarn (duplicateIds or duplicateNames)');
  }

  const duplicates = await resolveYarns(rawDuplicateList, 'Duplicate yarn');

  // Filter out canonical if it accidentally appears in duplicates
  const filteredDuplicates = duplicates.filter((d) => d._id.toString() !== canonicalOid.toString());
  if (filteredDuplicates.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'All provided duplicates resolve to the canonical yarn itself; nothing to merge');
  }

  const duplicateOids = filteredDuplicates.map((d) => d._id);
  const duplicateYarnNames = [...new Set(filteredDuplicates.map((d) => d.yarnName).filter(Boolean))];

  const report = {
    dryRun,
    canonicalId: canonicalOid.toString(),
    canonicalName: resolvedCanonicalName,
    duplicateIds: duplicateOids.map((id) => id.toString()),
    duplicateNames: duplicateYarnNames,
    updates: {},
  };

  // --- Dry-run: just count affected documents ---
  if (dryRun) {
    report.updates = await countAffectedDocuments(duplicateOids, duplicateYarnNames);
    return report;
  }

  // --- Live merge ---

  // 1. Product BOM: only update yarnCatalogId + yarnName on matching items (arrayFilters)
  const productResult = await Product.updateMany(
    { 'bom.yarnCatalogId': { $in: duplicateOids } },
    {
      $set: {
        'bom.$[b].yarnCatalogId': canonicalOid,
        'bom.$[b].yarnName': resolvedCanonicalName,
      },
    },
    { arrayFilters: [{ 'b.yarnCatalogId': { $in: duplicateOids } }] }
  );
  report.updates.products = productResult.modifiedCount;

  // 2. YarnPurchaseOrder: only update poItems[].yarn + poItems[].yarnName (arrayFilters)
  const poResult = await YarnPurchaseOrder.updateMany(
    { $or: [{ 'poItems.yarn': { $in: duplicateOids } }, { 'poItems.yarnName': { $in: duplicateYarnNames } }] },
    {
      $set: {
        'poItems.$[p].yarn': canonicalOid,
        'poItems.$[p].yarnName': resolvedCanonicalName,
      },
    },
    {
      arrayFilters: [
        { $or: [{ 'p.yarn': { $in: duplicateOids } }, { 'p.yarnName': { $in: duplicateYarnNames } }] },
      ],
    }
  );
  report.updates.purchaseOrders = poResult.modifiedCount;

  // 3. YarnBox: name-only field
  const boxResult = await YarnBox.updateMany(
    { yarnName: { $in: duplicateYarnNames } },
    { $set: { yarnName: resolvedCanonicalName } }
  );
  report.updates.yarnBoxes = boxResult.modifiedCount;

  // 4. YarnCone: yarn (ObjectId) + yarnName
  const coneResult = await YarnCone.updateMany(
    { $or: [{ yarn: { $in: duplicateOids } }, { yarnName: { $in: duplicateYarnNames } }] },
    { $set: { yarn: canonicalOid, yarnName: resolvedCanonicalName } }
  );
  report.updates.yarnCones = coneResult.modifiedCount;

  // 5. YarnTransaction: yarn + yarnName
  const txResult = await YarnTransaction.updateMany(
    { $or: [{ yarn: { $in: duplicateOids } }, { yarnName: { $in: duplicateYarnNames } }] },
    { $set: { yarn: canonicalOid, yarnName: resolvedCanonicalName } }
  );
  report.updates.yarnTransactions = txResult.modifiedCount;

  // 6. YarnRequisition: merge/delete duplicates
  const reqResult = await mergeRequisitions(canonicalOid, resolvedCanonicalName, duplicateOids);
  report.updates.yarnRequisitions = reqResult;

  // 7. YarnInventory: merge inventory rows (unique constraint on yarn)
  const invResult = await mergeInventories(canonicalOid, resolvedCanonicalName, duplicateOids);
  report.updates.yarnInventories = invResult;

  // 8. Supplier: only update yarnDetails[].yarnCatalogId + yarnDetails[].yarnName (arrayFilters)
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
 * @param {Array<Object>} merges - Each item: { canonicalId?, canonicalName?, duplicateIds?, duplicateNames? }
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
