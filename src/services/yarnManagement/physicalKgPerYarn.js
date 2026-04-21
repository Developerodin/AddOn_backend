import mongoose from 'mongoose';
import { YarnBox, YarnCone, YarnCatalog } from '../../models/index.js';

const toNum = (v) => Number(v ?? 0);

/**
 * Discover yarnCatalogIds that have physical stock (boxes or cones).
 * Returns Set<string> of yarnCatalogId strings.
 */
export const getYarnIdsWithPhysicalStock = async () => {
  const ids = new Set();
  const [boxNames, boxCatalogIds, coneYarns, catalogAll] = await Promise.all([
    YarnBox.distinct('yarnName', { boxWeight: { $gt: 0 } }),
    YarnBox.distinct('yarnCatalogId', { boxWeight: { $gt: 0 }, yarnCatalogId: { $exists: true, $ne: null } }),
    YarnCone.distinct('yarnCatalogId', {
      coneStorageId: { $exists: true, $nin: [null, ''] },
      issueStatus: { $ne: 'issued' },
    }),
    YarnCatalog.find({}).select('_id yarnName').lean(),
  ]);
  coneYarns.forEach((id) => id && ids.add(id.toString()));
  (boxCatalogIds || []).forEach((id) => id && ids.add(id.toString()));
  const nameToId = new Map();
  catalogAll.forEach((c) => {
    if (c?.yarnName) nameToId.set(c.yarnName.trim().toLowerCase(), c._id.toString());
  });
  (boxNames || []).forEach((n) => {
    const id = nameToId.get((n || '').trim().toLowerCase());
    if (id) ids.add(id);
  });
  return ids;
};

/**
 * Compute net physical kg per yarnCatalogId from YarnBox + YarnCone (current live state).
 *
 * Boxes: boxWeight - tearweight (net), where boxWeight > 0.
 * Cones: in ST (coneStorageId set), not issued.
 *
 * @param {string[]} yarnIds
 * @param {Map<string, {yarnName: string}>} catalogMap
 * @returns {Promise<Map<string, number>>}
 */
export const computePhysicalKgMap = async (yarnIds, catalogMap) => {
  const map = new Map();
  const yarnNameToId = new Map();
  catalogMap.forEach((c, id) => {
    if (c?.yarnName) yarnNameToId.set(c.yarnName.trim().toLowerCase(), id);
  });

  const allBoxes = await YarnBox.find({ boxWeight: { $gt: 0 } })
    .select('yarnName boxWeight tearweight')
    .lean();

  for (const b of allBoxes) {
    const yarnId = yarnNameToId.get((b.yarnName || '').trim().toLowerCase());
    if (!yarnId) continue;
    const net = Math.max(0, toNum(b.boxWeight) - toNum(b.tearweight));
    if (net > 0) map.set(yarnId, (map.get(yarnId) || 0) + net);
  }

  const objectIds = yarnIds.map((id) => new mongoose.Types.ObjectId(id));
  const cones = await YarnCone.find({
    yarnCatalogId: { $in: objectIds },
    coneStorageId: { $exists: true, $nin: [null, ''] },
    issueStatus: { $ne: 'issued' },
  })
    .select('yarnCatalogId coneWeight tearWeight')
    .lean();

  for (const c of cones) {
    const yarnId = c.yarnCatalogId?.toString?.();
    if (!yarnId) continue;
    const net = Math.max(0, toNum(c.coneWeight) - toNum(c.tearWeight));
    if (net > 0) map.set(yarnId, (map.get(yarnId) || 0) + net);
  }

  return map;
};
