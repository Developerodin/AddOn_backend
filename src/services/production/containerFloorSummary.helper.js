import ContainersMaster from '../../models/production/containersMaster.model.js';

const SEARCH_COLLATION = { locale: 'en', strength: 2 };

/**
 * Sums ACTIVE (or filtered) container quantity per floor in one aggregation.
 * Replaces one with-articles hydration per floor on the supervisor upcoming tab.
 * @param {{ status?: string, contentDomain?: 'vendor'|'production', floors?: string[] }} [opts]
 * @returns {Promise<Array<{ floor: string, containerCount: number, totalQty: number }>>}
 */
export const summarizeUpcomingByFloor = async (opts = {}) => {
  const status = opts.status || 'Active';
  const floors = Array.isArray(opts.floors) ? opts.floors.map((floor) => String(floor).trim()).filter(Boolean) : [];
  const match = { status };
  if (floors.length > 0) match.activeFloor = { $in: floors };
  if (opts.contentDomain === 'vendor') {
    match['activeItems.vendorProductionFlow'] = { $exists: true, $ne: null };
  } else if (opts.contentDomain === 'production') {
    match['activeItems.article'] = { $exists: true, $ne: null };
  }

  const rows = await ContainersMaster.aggregate([
    { $match: match },
    {
      $project: {
        activeFloor: 1,
        qty: { $sum: '$activeItems.quantity' },
      },
    },
    {
      $group: {
        _id: '$activeFloor',
        containerCount: { $sum: 1 },
        totalQty: { $sum: '$qty' },
      },
    },
  ]).collation(SEARCH_COLLATION);

  const byLower = new Map();
  for (const row of rows) {
    const key = String(row._id || '').trim().toLowerCase();
    const prev = byLower.get(key) || { containerCount: 0, totalQty: 0 };
    prev.containerCount += row.containerCount || 0;
    prev.totalQty += row.totalQty || 0;
    byLower.set(key, prev);
  }

  if (floors.length > 0) {
    return floors.map((floor) => {
      const hit = byLower.get(floor.toLowerCase());
      return {
        floor,
        containerCount: hit?.containerCount || 0,
        totalQty: hit?.totalQty || 0,
      };
    });
  }

  return [...byLower.entries()].map(([key, value]) => ({
    floor: key,
    containerCount: value.containerCount,
    totalQty: value.totalQty,
  }));
};
