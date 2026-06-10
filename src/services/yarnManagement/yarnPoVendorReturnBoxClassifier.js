import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import YarnPurchaseOrder from '../../models/yarnReq/yarnPurchaseOrder.model.js';
import YarnCone from '../../models/yarnReq/yarnCone.model.js';
import YarnBox from '../../models/yarnReq/yarnBox.model.js';
import { activeYarnBoxMatch, activeYarnConeMatch } from './yarnStockActiveFilters.js';

const RETURNABLE_ISSUE_STATUS = 'not_issued';

/**
 * @param {object} cone
 * @returns {boolean}
 */
function coneHasShortTermStorage(cone) {
  return cone.coneStorageId != null && String(cone.coneStorageId).trim() !== '';
}

/**
 * Resolves gross/net kg and cone count for a box, falling back to lot averages when unweighed.
 *
 * @param {object} box - lean YarnBox
 * @param {object|null} lot - receivedLotDetails subdoc
 * @returns {{ grossWeight: number, tearWeight: number, netWeight: number, numberOfCones: number }}
 */
export function resolveBoxReturnWeights(box, lot) {
  const tearWeight = Number(box.tearweight ?? 0);
  let grossWeight = Number(box.boxWeight ?? box.grossWeight ?? 0);
  let numberOfCones = Number(box.numberOfCones ?? box.coneData?.numberOfCones ?? 0);
  let netWeight = Math.max(0, grossWeight - tearWeight);

  const lotBoxCount = Number(lot?.numberOfBoxes) || 0;
  const lotTotalWeight = Number(lot?.totalWeight) || 0;
  const lotConeCount = Number(lot?.numberOfCones) || 0;

  if (netWeight <= 0 && lotBoxCount > 0 && lotTotalWeight > 0) {
    grossWeight = lotTotalWeight / lotBoxCount;
    netWeight = Math.max(0, grossWeight - tearWeight);
  }
  if (numberOfCones <= 0 && lotBoxCount > 0 && lotConeCount > 0) {
    numberOfCones = Math.max(1, Math.round(lotConeCount / lotBoxCount));
  }

  return {
    grossWeight,
    tearWeight,
    netWeight,
    numberOfCones,
  };
}

/**
 * Builds a vendor-return box line payload from a YarnBox document.
 *
 * @param {object} box
 * @param {object|null} lot
 * @returns {object}
 */
export function buildBoxLinePayload(box, lot) {
  const weights = resolveBoxReturnWeights(box, lot);
  return {
    boxId: String(box.boxId || '').trim(),
    boxObjectId: box._id,
    lotNumber: String(box.lotNumber || lot?.lotNumber || '').trim(),
    yarnCatalogId: box.yarnCatalogId || undefined,
    yarnName: box.yarnName || '',
    shadeCode: box.shadeCode || '',
    numberOfCones: weights.numberOfCones,
    boxWeight: weights.grossWeight,
    tearWeight: weights.tearWeight,
    netWeight: weights.netWeight,
    grossWeight: weights.grossWeight,
    storageLocationBefore: box.storageLocation ? String(box.storageLocation) : '',
  };
}

/**
 * Classifies active boxes in a lot for QC vendor return.
 * Closed/unopened boxes → LT box return; opened boxes → ST cones for PO Return scan.
 *
 * @param {string} poNumber
 * @param {string} lotNumber
 * @returns {Promise<{ ltBoxes: object[], stCones: object[], excludedCones: object[], lot: object|null }>}
 */
export async function classifyLotBoxesForReturn(poNumber, lotNumber) {
  const po = String(poNumber || '').trim();
  const lot = String(lotNumber || '').trim();
  if (!po || !lot) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'poNumber and lotNumber are required');
  }

  const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber: po })
    .select('receivedLotDetails poItems')
    .lean();
  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  const lotDoc =
    (purchaseOrder.receivedLotDetails || []).find(
      (l) => String(l.lotNumber || '').trim() === lot
    ) || null;

  const boxes = await YarnBox.find({ poNumber: po, lotNumber: lot, ...activeYarnBoxMatch }).lean();

  /** @type {object[]} */
  const ltBoxes = [];
  /** @type {object[]} */
  const stCones = [];
  /** @type {object[]} */
  const excludedCones = [];

  for (const box of boxes) {
    const boxId = String(box.boxId || '').trim();
    if (!boxId) continue;

    const cones = await YarnCone.find({ poNumber: po, boxId, ...activeYarnConeMatch }).lean();
    const stForBox = cones.filter(
      (c) => coneHasShortTermStorage(c) && String(c.issueStatus) === RETURNABLE_ISSUE_STATUS
    );
    const isOpened = Boolean(box.coneData?.conesIssued) || stForBox.length > 0;

    if (isOpened) {
      for (const c of cones) {
        if (String(c.issueStatus) !== RETURNABLE_ISSUE_STATUS) {
          excludedCones.push(c);
        } else if (coneHasShortTermStorage(c)) {
          stCones.push(c);
        } else {
          stCones.push(c);
        }
      }
    } else {
      ltBoxes.push(buildBoxLinePayload(box, lotDoc));
    }
  }

  return { ltBoxes, stCones, excludedCones, lot: lotDoc };
}

/**
 * Classifies all lots on a PO (for full PO QC return).
 *
 * @param {string} poNumber
 * @returns {Promise<{ ltBoxes: object[], stCones: object[], excludedCones: object[] }>}
 */
export async function classifyPoBoxesForReturn(poNumber) {
  const po = String(poNumber || '').trim();
  if (!po) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'poNumber is required');
  }

  const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber: po })
    .select('receivedLotDetails')
    .lean();
  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  const ltBoxes = [];
  const stCones = [];
  const excludedCones = [];

  for (const lot of purchaseOrder.receivedLotDetails || []) {
    const ln = String(lot.lotNumber || '').trim();
    if (!ln) continue;
    const part = await classifyLotBoxesForReturn(po, ln);
    ltBoxes.push(...part.ltBoxes);
    stCones.push(...part.stCones);
    excludedCones.push(...part.excludedCones);
  }

  return { ltBoxes, stCones, excludedCones };
}
