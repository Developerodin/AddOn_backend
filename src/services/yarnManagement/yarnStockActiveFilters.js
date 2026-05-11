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
