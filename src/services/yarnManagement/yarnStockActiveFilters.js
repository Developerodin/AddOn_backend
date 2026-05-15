/**
 * Mongo match fragments for yarn stock that is still on premises and usable.
 * Vendor-returned cones/boxes set `returnedToVendorAt` and must be excluded from
 * issue, slot listing, and inventory rollups that represent live stock.
 */

/** @type {Record<string, unknown>} */
export const activeYarnConeMatch = {
  $or: [{ returnedToVendorAt: { $exists: false } }, { returnedToVendorAt: null }],
};

/** @type {Record<string, unknown>} */
export const activeYarnBoxMatch = {
  $or: [{ returnedToVendorAt: { $exists: false } }, { returnedToVendorAt: null }],
};

/**
 * Boxes visible in default listings and counted toward unallocated rollups.
 * Excludes “cones issued” shells with no remaining net box weight (boxWeight ≤ 0),
 * so GET /without-storage-location matches GET /yarn-inventories unallocated kg.
 * @type {Record<string, unknown>}
 */
export const activeYarnBoxListingMatch = {
  $or: [{ 'coneData.conesIssued': { $ne: true } }, { boxWeight: { $gt: 0 } }],
  ...activeYarnBoxMatch,
};
