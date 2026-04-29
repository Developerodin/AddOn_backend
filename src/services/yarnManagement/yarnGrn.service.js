import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnGrn, YarnPurchaseOrder, YarnBox } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import {
  buildSnapshot,
  computeSnapshotDiff,
  lotMaterialChange,
} from './yarnGrnSnapshot.builder.js';

const GRN_BASE_PATTERN = /^GRN-(\d{4})-(\d+)$/;
const GRN_ANY_PATTERN = /^GRN-\d{4}-\d+(?:-R\d+)?$/;

/**
 * Lean POJOs bypass mongoose's toJSON plugin, so `_id` never becomes `id`.
 * Apply the same transform manually for any lean GRN going out the wire so
 * the frontend (which expects `id`) doesn't break on follow-up calls.
 *
 * @template T
 * @param {T | null} doc
 * @returns {T | null}
 */
const leanToClient = (doc) => {
  if (!doc) return doc;
  if (Array.isArray(doc)) return doc.map(leanToClient);
  const { _id, __v, ...rest } = doc;
  if (_id != null && rest.id == null) {
    rest.id = typeof _id.toString === 'function' ? _id.toString() : String(_id);
  }
  return rest;
};

/**
 * Generate the next sequential GRN number for the current year
 * (`GRN-YYYY-####`). Considers only base numbers, not -R{n} revisions.
 * Race-safe via E11000-retry on the unique grnNumber index.
 * @returns {Promise<string>}
 */
export const generateGrnNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `GRN-${year}-`;
  const last = await YarnGrn.findOne({ grnNumber: { $regex: `^${prefix}\\d+$` } })
    .sort({ createdAt: -1 })
    .select('grnNumber')
    .lean();
  let seq = 1;
  if (last?.grnNumber) {
    const m = last.grnNumber.match(GRN_BASE_PATTERN);
    seq = m ? parseInt(m[2], 10) + 1 : 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
};

/**
 * Resolve the {user,username,email} block stored on every GRN.
 * @param {Object} reqUser - typically req.user
 * @returns {{user: ?string, username: string, email: string}}
 */
const buildCreatedBy = (reqUser) => {
  const id = reqUser?.id || reqUser?._id?.toString?.() || null;
  return {
    user: id && mongoose.Types.ObjectId.isValid(id) ? id : null,
    username: reqUser?.username || reqUser?.email || 'system',
    email: reqUser?.email || '',
  };
};

/**
 * Persist a GRN doc id on the parent PO's grnHistory[] (append-only).
 * Uses an atomic $push so concurrent saves never lose entries.
 * @param {string} purchaseOrderId
 * @param {mongoose.Types.ObjectId} grnId
 */
const linkGrnToPo = async (purchaseOrderId, grnId) => {
  await YarnPurchaseOrder.updateOne(
    { _id: purchaseOrderId },
    { $push: { grnHistory: grnId } }
  );
};

/**
 * Insert a YarnGrn doc, retrying once if the unique grnNumber index races
 * with a concurrent insert (E11000). Mints a fresh number on retry.
 * @param {Object} payload - full doc body
 * @param {Function} numberFactory - async () => string
 */
const insertWithRetry = async (payload, numberFactory) => {
  try {
    return await YarnGrn.create(payload);
  } catch (err) {
    if (err?.code === 11000) {
      payload.grnNumber = await numberFactory();
      payload.baseGrnNumber = payload.revisionOf ? payload.baseGrnNumber : payload.grnNumber;
      return YarnGrn.create(payload);
    }
    throw err;
  }
};

/**
 * Create a brand-new GRN (revisionNo=0) for a freshly-received batch of lots.
 * @param {Object} po - populated YarnPurchaseOrder
 * @param {Array<string>} newLotNumbers - lots present in updated PO but not before
 * @param {Object} reqUser - req.user
 * @param {Object} [extras] - { vendorInvoiceNo, vendorInvoiceDate, discrepancyDetails, notes, grnDate }
 * @returns {Promise<Object>} created GRN doc (lean-ish toObject)
 */
export const createGrnFromNewLots = async (po, newLotNumbers, reqUser, extras = {}) => {
  if (!po || !Array.isArray(newLotNumbers) || newLotNumbers.length === 0) return null;

  const grnNumber = await generateGrnNumber();
  const snapshot = buildSnapshot(po, newLotNumbers);

  const payload = {
    grnNumber,
    baseGrnNumber: grnNumber,
    grnDate: extras.grnDate ? new Date(extras.grnDate) : new Date(),
    status: 'active',
    revisionOf: null,
    revisionNo: 0,
    purchaseOrder: po._id,
    poNumber: po.poNumber,
    poDate: po.createDate || po.createdAt,
    ...snapshot,
    vendorInvoiceNo: extras.vendorInvoiceNo || '',
    vendorInvoiceDate: extras.vendorInvoiceDate ? new Date(extras.vendorInvoiceDate) : null,
    discrepancyDetails: extras.discrepancyDetails || '',
    notes: extras.notes || po.notes || '',
    isLegacy: Boolean(extras.isLegacy),
    createdBy: buildCreatedBy(reqUser),
  };

  const grn = await insertWithRetry(payload, generateGrnNumber);
  await linkGrnToPo(po._id, grn._id);
  return leanToClient(grn.toObject());
};

/**
 * Find the most recent ACTIVE GRN for each (po, lotNumber) tuple in the input.
 * One GRN may contain several lots — that GRN is returned once per lot match
 * but de-duped by id at the end.
 * @param {Object} po - populated YarnPurchaseOrder
 * @param {Array<string>} lotNumbers
 * @returns {Promise<Array<Object>>}
 */
export const findGrnsTouchedByLots = async (po, lotNumbers) => {
  if (!po?._id || !lotNumbers?.length) return [];
  const grns = await YarnGrn.find({
    purchaseOrder: po._id,
    status: 'active',
    'lots.lotNumber': { $in: lotNumbers },
  }).sort({ createdAt: -1 }).lean();

  const seen = new Set();
  const result = [];
  for (const g of grns) {
    const key = g._id.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(g);
  }
  return result;
};

/**
 * Issue a revision of a parent GRN with the updated PO data.
 * Marks the parent superseded, mints `${baseGrnNumber}-R{n}`, and links the
 * new id into the PO's grnHistory[].
 * @param {Object} parentGrn - lean GRN doc (must be currently active)
 * @param {Object} updatedPo - populated PO after the edit
 * @param {Object} reqUser - req.user
 * @param {string} reason - why the revision is being issued
 * @returns {Promise<Object>} new revision doc
 */
export const reviseGrn = async (parentGrn, updatedPo, reqUser, reason) => {
  if (!parentGrn?._id) throw new ApiError(httpStatus.BAD_REQUEST, 'Parent GRN required');

  const lotNumbers = (parentGrn.lots || []).map((l) => l.lotNumber).filter(Boolean);
  const snapshot = buildSnapshot(updatedPo, lotNumbers);
  const diff = computeSnapshotDiff(parentGrn, snapshot);

  const baseNumber = parentGrn.baseGrnNumber || parentGrn.grnNumber.replace(/-R\d+$/, '');
  const nextRevisionNo = (parentGrn.revisionNo || 0) + 1;
  const revisionNumber = `${baseNumber}-R${nextRevisionNo}`;

  const payload = {
    grnNumber: revisionNumber,
    baseGrnNumber: baseNumber,
    grnDate: new Date(),
    status: 'active',
    revisionOf: parentGrn._id,
    revisionNo: nextRevisionNo,
    revisionReason: reason || 'Lot data corrected after GRN issued',
    revisionDiff: diff,
    purchaseOrder: updatedPo._id,
    poNumber: updatedPo.poNumber,
    poDate: parentGrn.poDate || updatedPo.createDate,
    ...snapshot,
    vendorInvoiceNo: parentGrn.vendorInvoiceNo || '',
    vendorInvoiceDate: parentGrn.vendorInvoiceDate || null,
    discrepancyDetails: parentGrn.discrepancyDetails || '',
    notes: parentGrn.notes || updatedPo.notes || '',
    isLegacy: false,
    createdBy: buildCreatedBy(reqUser),
  };

  const newGrn = await insertWithRetry(payload, async () => {
    return `${baseNumber}-R${nextRevisionNo}`;
  });

  await YarnGrn.updateOne(
    { _id: parentGrn._id, status: 'active' },
    {
      $set: {
        status: 'superseded',
        supersededAt: new Date(),
        supersededByGrn: newGrn._id,
      },
    }
  );

  await linkGrnToPo(updatedPo._id, newGrn._id);
  return leanToClient(newGrn.toObject());
};

/**
 * Revise every active GRN that contains any of the changed lot numbers.
 * Returns the freshly-issued revision docs (one per parent that was touched).
 * @param {Object} updatedPo - populated PO after the edit
 * @param {Array<string>} changedLotNumbers
 * @param {Object} reqUser
 * @param {string} reason
 * @returns {Promise<Array<Object>>}
 */
export const reviseAffectedGrns = async (updatedPo, changedLotNumbers, reqUser, reason) => {
  const parents = await findGrnsTouchedByLots(updatedPo, changedLotNumbers);
  const revisions = [];
  for (const parent of parents) {
    const r = await reviseGrn(parent, updatedPo, reqUser, reason);
    revisions.push(r);
  }
  return revisions;
};

/**
 * Mongoose paginate filter wrapper for the GRN list page.
 * @param {Object} filter - passthrough Mongo filter (already shaped by controller)
 * @param {Object} options - { sortBy, limit, page }
 */
export const queryGrns = async (filter, options) => {
  return YarnGrn.paginate(filter, { sortBy: 'createdAt:desc', ...options });
};

/**
 * @param {string} id
 */
export const getGrnById = async (id) => {
  const grn = await YarnGrn.findById(id).lean();
  if (!grn) return null;
  if (grn.revisionOf) {
    const parent = await YarnGrn.findById(grn.revisionOf)
      .select('grnNumber baseGrnNumber revisionNo status')
      .lean();
    grn.parent = leanToClient(parent);
  }
  return leanToClient(grn);
};

/**
 * @param {string} grnNumber
 */
export const getGrnByNumber = async (grnNumber) => {
  const grn = await YarnGrn.findOne({ grnNumber }).lean();
  return leanToClient(grn);
};

/**
 * Return the full revision chain for a GRN (parent + every R*) ordered oldest→newest.
 * Accepts any id within the chain — original or revision — and resolves baseGrnNumber.
 * @param {string} grnId
 */
export const getRevisionsOf = async (grnId) => {
  const start = await YarnGrn.findById(grnId).select('baseGrnNumber').lean();
  if (!start) return [];
  const list = await YarnGrn.find({ baseGrnNumber: start.baseGrnNumber })
    .sort({ revisionNo: 1, createdAt: 1 })
    .lean();
  return list.map(leanToClient);
};

/**
 * @param {string} purchaseOrderId
 * @param {Object} [options] - { includeSuperseded: boolean }
 */
export const getGrnsByPurchaseOrder = async (purchaseOrderId, options = {}) => {
  const filter = { purchaseOrder: purchaseOrderId };
  if (!options.includeSuperseded) filter.status = 'active';
  const list = await YarnGrn.find(filter).sort({ createdAt: -1 }).lean();
  return list.map(leanToClient);
};

/**
 * @param {string} lotNumber
 * @param {Object} [options] - { includeSuperseded }
 */
export const getGrnsByLot = async (lotNumber, options = {}) => {
  const filter = { 'lots.lotNumber': lotNumber };
  if (!options.includeSuperseded) filter.status = 'active';
  const list = await YarnGrn.find(filter).sort({ createdAt: -1 }).lean();
  return list.map(leanToClient);
};

/**
 * Patch the header-only fields on an existing GRN. These fields (vendor
 * invoice no/date, discrepancy notes, narration) are *metadata* — not part
 * of the materially-immutable lot snapshot — so it's safe to update them
 * post-issuance without minting a revision. Only persists fields the caller
 * actually supplied as a non-empty value, so passing `{}` is a no-op.
 *
 * @param {string} grnId
 * @param {Object} fields - any subset of { vendorInvoiceNo, vendorInvoiceDate, discrepancyDetails, notes }
 * @returns {Promise<?Object>} updated GRN doc (lean)
 */
export const updateGrnHeader = async (grnId, fields = {}) => {
  if (!grnId) return null;
  const $set = {};
  if (typeof fields.vendorInvoiceNo === 'string' && fields.vendorInvoiceNo.trim()) {
    $set.vendorInvoiceNo = fields.vendorInvoiceNo.trim();
  }
  if (fields.vendorInvoiceDate) {
    const d = new Date(fields.vendorInvoiceDate);
    if (!Number.isNaN(d.getTime())) $set.vendorInvoiceDate = d;
  }
  if (typeof fields.discrepancyDetails === 'string') {
    $set.discrepancyDetails = fields.discrepancyDetails;
  }
  if (typeof fields.notes === 'string' && fields.notes.trim()) {
    $set.notes = fields.notes.trim();
  }
  const doc =
    Object.keys($set).length === 0
      ? await YarnGrn.findById(grnId).lean()
      : await YarnGrn.findByIdAndUpdate(grnId, { $set }, { new: true }).lean();
  return leanToClient(doc);
};

/**
 * Idempotent "Print Summary" entry-point. Looks at every lot currently on the
 * PO (after trimming/empty filtering) and issues a brand-new GRN for the lots
 * that aren't already on an active GRN. Existing lots are left alone — the
 * caller (UI) gets back the latest GRN for one-click printing.
 *
 * Header metadata supplied via `extras` (vendor invoice no/date, discrepancy
 * notes) is ALWAYS persisted: applied to the freshly-created GRN if one is
 * minted, otherwise patched onto the latest active GRN so the user's modal
 * input is never silently dropped.
 *
 * Call sites: process-page Print Summary button, GRN history page "Issue GRN
 * for unGRN'd lots" action. Safe to call repeatedly: returns the same GRN
 * when nothing new needs issuing.
 *
 * @param {string} purchaseOrderId
 * @param {Object} reqUser - req.user
 * @param {Object} [extras] - { vendorInvoiceNo, vendorInvoiceDate, discrepancyDetails, notes }
 * @returns {Promise<{ createdGrn: ?Object, latestGrn: ?Object, allGrns: Array<Object>, message: string }>}
 */
export const ensureGrnForPo = async (purchaseOrderId, reqUser, extras = {}) => {
  if (!purchaseOrderId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'purchaseOrderId is required');
  }

  // Lazy-required to avoid a circular import: yarnPurchaseOrder.service ->
  // yarnReceivingPipeline.service -> yarnGrn.service.
  const yarnPoService = await import('./yarnPurchaseOrder.service.js');
  const po = await yarnPoService.getPurchaseOrderById(purchaseOrderId);
  if (!po) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  const validLots = (po.receivedLotDetails || [])
    .map((l) => ({ ...(l.toObject ? l.toObject() : l) }))
    .filter((l) => String(l.lotNumber || '').trim() && Number(l.numberOfBoxes) > 0);

  if (validLots.length === 0) {
    return {
      createdGrn: null,
      latestGrn: null,
      allGrns: [],
      message: 'No received lots on this PO yet — save lots first.',
    };
  }

  const existingActiveGrns = await YarnGrn.find({
    purchaseOrder: po._id,
    status: 'active',
  })
    .select('lots.lotNumber')
    .lean();

  const lotsAlreadyOnGrn = new Set();
  existingActiveGrns.forEach((g) => {
    (g.lots || []).forEach((l) => {
      if (l.lotNumber) lotsAlreadyOnGrn.add(String(l.lotNumber).trim());
    });
  });

  const ungrnnedLotNumbers = validLots
    .map((l) => String(l.lotNumber).trim())
    .filter((num) => !lotsAlreadyOnGrn.has(num));

  let createdGrn = null;
  if (ungrnnedLotNumbers.length > 0) {
    createdGrn = await createGrnFromNewLots(po, ungrnnedLotNumbers, reqUser, extras);
  }

  let allGrns = await getGrnsByPurchaseOrder(po._id);
  let latestGrn = allGrns[0] || null;

  // No new GRN was minted but the user supplied header metadata — patch it
  // onto the latest GRN so reprints from history show the entered values.
  if (!createdGrn && latestGrn) {
    const hasHeaderChanges =
      (extras.vendorInvoiceNo && extras.vendorInvoiceNo !== latestGrn.vendorInvoiceNo) ||
      (extras.vendorInvoiceDate &&
        new Date(extras.vendorInvoiceDate).getTime() !==
          new Date(latestGrn.vendorInvoiceDate || 0).getTime()) ||
      (typeof extras.discrepancyDetails === 'string' &&
        extras.discrepancyDetails !== (latestGrn.discrepancyDetails || '')) ||
      (extras.notes && extras.notes !== latestGrn.notes);
    if (hasHeaderChanges) {
      const patched = await updateGrnHeader(latestGrn._id, extras);
      if (patched) {
        latestGrn = patched;
        allGrns = await getGrnsByPurchaseOrder(po._id);
      }
    }
  }

  return {
    createdGrn,
    latestGrn,
    allGrns,
    message: createdGrn
      ? `Issued ${createdGrn.grnNumber} for ${ungrnnedLotNumbers.length} new lot(s).`
      : 'All received lots are already on an active GRN.',
  };
};

/**
 * Convenience wrapper used by the GRN list page banner: returns true if any
 * boxes have already been created against the lots inside this GRN. The list
 * page surfaces a warning before letting the user edit a lot whose GRN is
 * already supporting downstream inventory rows.
 * @param {Object} grn - lean GRN doc
 * @returns {Promise<number>} count of boxes touching any lot in this GRN
 */
export const countBoxesForGrn = async (grn) => {
  if (!grn?.poNumber || !Array.isArray(grn.lots) || grn.lots.length === 0) return 0;
  const lotNumbers = grn.lots.map((l) => l.lotNumber).filter(Boolean);
  if (!lotNumbers.length) return 0;
  return YarnBox.countDocuments({ poNumber: grn.poNumber, lotNumber: { $in: lotNumbers } });
};

export { lotMaterialChange };
