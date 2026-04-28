import { YarnBox, YarnCone } from '../../models/index.js';
import { yarnConeUnavailableIssueStatuses } from '../../models/yarnReq/yarnCone.model.js';

const toNum = (v) => Number(v ?? 0);

/**
 * Fetch all boxes for a PO number and attach cones currently in short-term storage.
 *
 * Short-term storage definition (existing system behavior):
 * - coneStorageId is set (non-empty)
 * - issueStatus is not 'issued' or 'used' (cone is still available in the slot)
 *
 * @param {Object} params
 * @param {string} params.poNumber
 * @returns {Promise<{
 *  poNumber: string,
 *  summary: {
 *    totalBoxes: number,
 *    totalShortTermCones: number,
 *    totalBoxWeight: number,
 *    totalConeWeight: number,
 *    totalConeNetWeight: number,
 *  },
 *  boxes: Array<{
 *    boxId: string,
 *    yarnName?: string,
 *    shadeCode?: string,
 *    lotNumber?: string,
 *    boxWeight?: number,
 *    tearweight?: number,
 *    netBoxWeight?: number,
 *    storageLocation?: string,
 *    storedStatus?: boolean,
 *    shortTermCones: Array<{
 *      barcode?: string,
 *      coneStorageId?: string,
 *      coneWeight?: number,
 *      tearWeight?: number,
 *      netConeWeight?: number,
 *    }>,
 *    shortTermTotals: { cones: number, coneWeight: number, coneNetWeight: number },
 *  }>,
 * }>}
 */
export async function getPoBoxesAndShortTermConesReport({ poNumber }) {
  const normalizedPo = String(poNumber || '').trim();
  if (!normalizedPo) {
    throw new Error('poNumber is required');
  }

  const [boxes, stCones] = await Promise.all([
    YarnBox.find({ poNumber: normalizedPo })
      .select('boxId poNumber yarnName shadeCode lotNumber boxWeight tearweight storageLocation storedStatus')
      .sort({ createdAt: 1 })
      .lean(),
    YarnCone.find({
      poNumber: normalizedPo,
      coneStorageId: { $exists: true, $nin: [null, ''] },
      issueStatus: { $nin: yarnConeUnavailableIssueStatuses },
    })
      .select('boxId barcode coneStorageId coneWeight tearWeight')
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  const conesByBoxId = new Map();
  for (const c of stCones) {
    const boxId = String(c.boxId || '').trim();
    if (!boxId) continue;
    if (!conesByBoxId.has(boxId)) conesByBoxId.set(boxId, []);
    conesByBoxId.get(boxId).push({
      barcode: c.barcode,
      coneStorageId: c.coneStorageId,
      coneWeight: toNum(c.coneWeight),
      tearWeight: toNum(c.tearWeight),
      netConeWeight: Math.max(0, toNum(c.coneWeight) - toNum(c.tearWeight)),
    });
  }

  let totalBoxWeight = 0;
  let totalConeWeight = 0;
  let totalConeNetWeight = 0;
  let totalShortTermCones = 0;

  const boxRows = (boxes || []).map((b) => {
    const boxId = String(b.boxId || '').trim();
    const cones = conesByBoxId.get(boxId) || [];

    const boxWeight = toNum(b.boxWeight);
    const boxTare = toNum(b.tearweight);
    const netBoxWeight = Math.max(0, boxWeight - boxTare);

    const shortTermTotals = cones.reduce(
      (acc, c) => {
        acc.cones += 1;
        acc.coneWeight += toNum(c.coneWeight);
        acc.coneNetWeight += toNum(c.netConeWeight);
        return acc;
      },
      { cones: 0, coneWeight: 0, coneNetWeight: 0 }
    );

    totalBoxWeight += boxWeight;
    totalConeWeight += shortTermTotals.coneWeight;
    totalConeNetWeight += shortTermTotals.coneNetWeight;
    totalShortTermCones += shortTermTotals.cones;

    return {
      boxId,
      yarnName: b.yarnName,
      shadeCode: b.shadeCode,
      lotNumber: b.lotNumber,
      boxWeight,
      tearweight: boxTare,
      netBoxWeight,
      storageLocation: b.storageLocation,
      storedStatus: b.storedStatus,
      shortTermCones: cones,
      shortTermTotals,
    };
  });

  return {
    poNumber: normalizedPo,
    summary: {
      totalBoxes: boxRows.length,
      totalShortTermCones,
      totalBoxWeight,
      totalConeWeight,
      totalConeNetWeight,
    },
    boxes: boxRows,
  };
}

