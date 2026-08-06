import httpStatus from 'http-status';
import { StorageSlot } from '../../models/index.js';
import {
  LT_SECTION_CODES,
  ST_SECTION_CODE,
  STORAGE_ZONES,
} from '../../models/storageManagement/storageSlot.model.js';
import ApiError from '../../utils/ApiError.js';

/** LT: legacy LT-* OR slot barcodes B7-02-, B7-03-, B7-04-, B7-05- */
export const LT_STORAGE_PATTERN = new RegExp(
  `^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`,
  'i'
);

/** ST: legacy ST-* OR slot barcode B7-01- */
export const ST_STORAGE_PATTERN = new RegExp(`^(ST-|${ST_SECTION_CODE}-)`, 'i');

/**
 * @param {string|null|undefined} location
 * @returns {boolean}
 */
export const isLtLocation = (location) =>
  Boolean(location && LT_STORAGE_PATTERN.test(String(location).trim()));

/**
 * @param {string|null|undefined} location
 * @returns {boolean}
 */
export const isStLocation = (location) =>
  Boolean(location && ST_STORAGE_PATTERN.test(String(location).trim()));

/**
 * Resolve zone from a storage location barcode string.
 * @param {string|null|undefined} location
 * @returns {'LT'|'ST'|null}
 */
export const resolveZone = (location) => {
  if (isLtLocation(location)) return STORAGE_ZONES.LONG_TERM;
  if (isStLocation(location)) return STORAGE_ZONES.SHORT_TERM;
  return null;
};

/**
 * True when location matches a known LT or ST barcode pattern.
 * @param {string|null|undefined} location
 * @returns {boolean}
 */
export const isValidStorageLocationPattern = (location) => resolveZone(location) != null;

/**
 * Find an active StorageSlot by barcode (or label fallback).
 * @param {string} barcode
 * @returns {Promise<Object>}
 */
export const requireActiveStorageSlot = async (barcode) => {
  const trimmed = String(barcode ?? '').trim();
  if (!trimmed) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Storage location barcode is required');
  }

  const slot = await StorageSlot.findOne({
    $or: [{ barcode: trimmed }, { label: trimmed }],
    isActive: true,
  }).lean();

  if (!slot) {
    throw new ApiError(httpStatus.NOT_FOUND, `Active storage slot not found: ${trimmed}`);
  }

  return slot;
};
