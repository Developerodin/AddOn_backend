/**
 * Load cones for a box and persist LT remaining / empty-carton fields.
 * Shared by cone post-save, LT→ST transfer, and storage-slot occupancy.
 */

import mongoose from 'mongoose';
import YarnBox from '../../models/yarnReq/yarnBox.model.js';
import { activeYarnConeMatch } from './yarnStockActiveFilters.js';
import {
  applyLtRemainingToBoxDoc,
  computeLtRemainingBoxWeight,
} from './yarnBoxLtRemaining.helper.js';

const WEIGHT_UNCHANGED_EPS_KG = 0.0005;

/**
 * YarnCone model (resolved at call time to avoid import cycle with yarnCone.model.js).
 * @returns {import('mongoose').Model}
 */
function yarnConeModel() {
  return mongoose.model('YarnCone');
}

/**
 * Mongo match for YarnCone docs that still count as having left the carton
 * (excludes vendor-return).
 * @type {Record<string, unknown>}
 */
export const movedOffPalletConeMatch = {
  ...activeYarnConeMatch,
};

/**
 * Count non-vendor-return YarnCone documents for a boxId.
 * @param {string} boxId
 * @returns {Promise<number>}
 */
export async function countMovedConesForBoxId(boxId) {
  const id = String(boxId || '').trim();
  if (!id) return 0;
  return yarnConeModel().countDocuments({ boxId: id, ...movedOffPalletConeMatch });
}

/**
 * Split cones for remaining math vs empty-carton count.
 * @param {string} boxId
 * @returns {Promise<{ conesInST: object[], conesReturnedVendor: object[], movedConeCount: number }>}
 */
export async function loadConesForLtRemaining(boxId) {
  const id = String(boxId || '').trim();
  if (!id) {
    return { conesInST: [], conesReturnedVendor: [], movedConeCount: 0 };
  }

  const cones = await yarnConeModel().find({ boxId: id }).lean();
  const conesReturnedVendor = cones.filter((c) => c.returnedToVendorAt != null);
  const moved = cones.filter((c) => c.returnedToVendorAt == null);
  const conesInST = moved.filter((c) => c.coneStorageId != null && String(c.coneStorageId).trim() !== '');

  return {
    conesInST,
    conesReturnedVendor,
    movedConeCount: moved.length,
  };
}

/**
 * Recompute LT remaining for a box from its YarnCone docs and persist.
 * Empty carton (moved count >= expected) zeros boxWeight and unsets the slot.
 * @param {string} boxId
 * @param {{ coneIssueDate?: Date }} [opts]
 * @returns {Promise<{ skipped?: boolean, fullyTransferred?: boolean, persistBoxWeight?: number }|null>}
 */
export async function syncBoxLtRemainingFromCones(boxId, opts = {}) {
  const id = String(boxId || '').trim();
  if (!id) return null;

  const box = await YarnBox.findOne({ boxId: id, returnedToVendorAt: null });
  if (!box) return null;

  const { conesInST, conesReturnedVendor, movedConeCount } = await loadConesForLtRemaining(id);
  const result = computeLtRemainingBoxWeight(box, conesInST, conesReturnedVendor, {
    movedConeCount,
  });

  const currentWeight = Number(box.boxWeight ?? 0);
  const weightUnchanged = Math.abs(currentWeight - result.persistBoxWeight) <= WEIGHT_UNCHANGED_EPS_KG;
  const alreadyDetached =
    result.fullyTransferred &&
    box.storedStatus === false &&
    (!box.storageLocation || String(box.storageLocation).trim() === '') &&
    weightUnchanged;

  if (!result.fullyTransferred && weightUnchanged) {
    return { skipped: true, fullyTransferred: false, persistBoxWeight: result.persistBoxWeight };
  }
  if (alreadyDetached) {
    return { skipped: true, fullyTransferred: true, persistBoxWeight: result.persistBoxWeight };
  }

  applyLtRemainingToBoxDoc(box, result, opts.coneIssueDate);
  await box.save();
  return {
    skipped: false,
    fullyTransferred: result.fullyTransferred,
    persistBoxWeight: result.persistBoxWeight,
  };
}
