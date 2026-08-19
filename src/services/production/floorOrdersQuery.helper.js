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

/**
 * Lean article populate for article-view payloads (no machine join).
 * @returns {object}
 */
export function getArticleViewPopulate() {
  return {
    path: 'articles',
    select: ARTICLE_VIEW_ARTICLE_SELECT,
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
