/**
 * Pure send/receive eligibility for Yarn to Vendor (no DB).
 * Location flags are injected so unit tests do not load Mongoose models.
 */

export const SEND_BLOCK = {
  PO_RETURNED: 'Box was returned to the PO supplier and cannot be sent',
  AT_VENDOR: 'Box is already at a vendor — use Receive',
  CONES_ISSUED: 'Opened boxes with cones cannot be sent (boxes only)',
  ST_LOCATION: 'Short-term storage boxes cannot be sent',
  NO_WEIGHT: 'Box has no remaining net weight',
  LT_NOT_QC: 'Long-term boxes must be QC approved before send',
};

export const RECEIVE_BLOCK = {
  PO_RETURNED: 'Box was returned to the PO supplier and cannot be received',
  NOT_AT_VENDOR: 'Box is not currently at a vendor',
  MIXED_VENDOR: 'All boxes in one receipt must belong to the same vendor',
};

/**
 * Net kg used for send/receive eligibility (boxWeight is already net).
 * @param {object} box
 * @returns {number}
 */
export const getBoxNetWeight = (box) => {
  const n = Number(box?.boxWeight ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param {object} box
 * @returns {boolean}
 */
export const isPoReturnedBox = (box) => box?.returnedToVendorAt != null;

/**
 * @param {object} box
 * @returns {boolean}
 */
export const isAtVendorBox = (box) => box?.atVendorAt != null;

/**
 * @param {object} box
 * @returns {boolean}
 */
export const isConesIssuedBox = (box) => box?.coneData?.conesIssued === true;

/**
 * Why this box cannot be sent. Null when send is allowed.
 * @param {object} box
 * @param {{ isLt: boolean, isSt: boolean }} location
 * @returns {string|null}
 */
export const getSendBlockReason = (box, location) => {
  const isLt = Boolean(location?.isLt);
  const isSt = Boolean(location?.isSt);
  if (isPoReturnedBox(box)) return SEND_BLOCK.PO_RETURNED;
  if (isAtVendorBox(box)) return SEND_BLOCK.AT_VENDOR;
  if (isConesIssuedBox(box)) return SEND_BLOCK.CONES_ISSUED;
  if (isSt) return SEND_BLOCK.ST_LOCATION;
  if (getBoxNetWeight(box) <= 0) return SEND_BLOCK.NO_WEIGHT;
  if (isLt && box?.qcData?.status !== 'qc_approved') return SEND_BLOCK.LT_NOT_QC;
  return null;
};

/**
 * Why this box cannot be received. Null when receive is allowed.
 * @param {object} box
 * @param {{ expectedSupplierId?: string }} [opts]
 * @returns {string|null}
 */
export const getReceiveBlockReason = (box, opts = {}) => {
  if (isPoReturnedBox(box)) return RECEIVE_BLOCK.PO_RETURNED;
  if (!isAtVendorBox(box)) return RECEIVE_BLOCK.NOT_AT_VENDOR;
  const expected = opts.expectedSupplierId != null ? String(opts.expectedSupplierId) : '';
  if (expected) {
    const actual = box?.vendorSupplierId != null ? String(box.vendorSupplierId) : '';
    if (actual && actual !== expected) return RECEIVE_BLOCK.MIXED_VENDOR;
  }
  return null;
};

/**
 * Preview mode for a scanned box.
 * @param {object} box
 * @param {{ isLt: boolean, isSt: boolean }} location
 * @returns {{ eligibleFor: 'send'|'receive'|'none', reason: string|null }}
 */
export const classifyVendorPreview = (box, location) => {
  if (isAtVendorBox(box) && !isPoReturnedBox(box)) {
    return { eligibleFor: 'receive', reason: null };
  }
  const sendReason = getSendBlockReason(box, location);
  if (sendReason) {
    return { eligibleFor: 'none', reason: sendReason };
  }
  return { eligibleFor: 'send', reason: null };
};
