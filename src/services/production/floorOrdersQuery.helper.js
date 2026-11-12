/**
 * Lean populate/select for floor "article view" lists.
 * Omits nested machine populate and history arrays; keeps knitting qty scalars
 * and order fields the knitting Article view / view-order modal already use.
 */

/** @type {string} */
export const ARTICLE_VIEW_ARTICLE_SELECT = [
  'articleNumber',
  'plannedQuantity',
  'completedQuantity',
  'linkingType',
  'priority',
  'status',
  'progress',
  'currentFloor',
  'machineId',
  'remarks',
  'brandingType',
  'knittingCode',
  'quantityFromPreviousFloor',
  'm1Quantity',
  'm2Quantity',
  'm3Quantity',
  'm4Quantity',
  'repairStatus',
  'repairRemarks',
  'qualityConfirmed',
  'finalQualityConfirmed',
  'finalQualityConfirmedAt',
  'createdAt',
  'updatedAt',
  'floorQuantities.knitting.received',
  'floorQuantities.knitting.completed',
  'floorQuantities.knitting.remaining',
  'floorQuantities.knitting.transferred',
  'floorQuantities.knitting.m4Quantity',
  'floorQuantities.knitting.weight',
].join(' ');

/** @type {string} */
export const ARTICLE_VIEW_ORDER_SELECT = [
  'orderNumber',
  'priority',
  'status',
  'currentFloor',
  'articles',
  'orderNote',
  'customerId',
  'customerName',
  'customerOrderNumber',
  'plannedStartDate',
  'plannedEndDate',
  'actualStartDate',
  'actualEndDate',
  'forwardedToBranding',
  'createdAt',
  'updatedAt',
  'createdBy',
  'lastModifiedBy',
].join(' ');

/**
 * Full nested populate used by Orders tab and other floors.
 * @returns {object}
 */
export function getFullFloorOrderPopulate() {
  return {
    path: 'articles',
    populate: {
      path: 'machineId',
      select: 'machineCode machineNumber model floor status capacityPerShift capacityPerDay assignedSupervisor',
    },
  };
}

const FLOOR_QTY_KEYS = [
  'knitting',
  'linking',
  'checking',
  'washing',
  'boarding',
  'silicon',
  'secondaryChecking',
  'branding',
  'reBoarding',
  'finalChecking',
  'warehouse',
  'dispatch',
];

const FLOOR_QTY_SCALARS = [
  'received',
  'completed',
  'remaining',
  'transferred',
  'm1Quantity',
  'm2Quantity',
  'm3Quantity',
  'm4Quantity',
  'm1Transferred',
  'm1Remaining',
  'm2Transferred',
  'm2Remaining',
  'repairReceived',
  'repairStatus',
  'repairRemarks',
  'weight',
];

/**
 * Article fields for a floor catalog. Scalars for every floor, line history only for the open floor.
 * Omits the machine join and the other floors' receivedData arrays, which are the bulk of the 2MB payload.
 * @param {string} [floorKey] - floorQuantities key for the page being opened, such as `finalChecking`
 * @returns {string}
 */
export function getFloorListArticleSelect(floorKey) {
  const parts = [ARTICLE_VIEW_ARTICLE_SELECT];
  for (const key of FLOOR_QTY_KEYS) {
    for (const field of FLOOR_QTY_SCALARS) {
      parts.push(`floorQuantities.${key}.${field}`);
    }
  }
  if (floorKey) {
    parts.push(`floorQuantities.${floorKey}.receivedData`);
    parts.push(`floorQuantities.${floorKey}.transferredData`);
  }
  return parts.join(' ');
}

/**
 * Lean article populate for article-view payloads (no machine join).
 * @param {string} [floorKey] - floorQuantities key whose transfer lines the page renders
 * @returns {object}
 */
export function getArticleViewPopulate(floorKey) {
  return {
    path: 'articles',
    select: getFloorListArticleSelect(floorKey),
  };
}

/**
 * Whether request asked for the compact article-view payload.
 * @param {object} options
 * @returns {boolean}
 */
export function isArticleViewPayload(options = {}) {
  const v = options.articleView;
  return v === true || v === 'true' || v === '1' || v === 1;
}
