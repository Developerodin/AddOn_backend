import mongoose from 'mongoose';
import httpStatus from 'http-status';
import YarnCone from '../../models/yarnReq/yarnCone.model.js';
import YarnCatalog from '../../models/yarnManagement/yarnCatalog.model.js';
import YarnFloorIssueBatch from '../../models/yarnReq/yarnFloorIssueBatch.model.js';
import YarnTransaction from '../../models/yarnReq/yarnTransaction.model.js';
import ApiError from '../../utils/ApiError.js';
import {
  normaliseTransactionPayload,
  runCreateTransactionLogic,
} from './yarnTransaction.service.js';
import { activeYarnConeMatch } from './yarnStockActiveFilters.js';

/** Max net weight (kg) allowed when issuing a single cone to linking/sampling. */
const MAX_NET_KG_FLOOR = 5;

const WEIGHT_EPSILON = 1e-9;

/**
 * Creates a new floor-issue batch (system-generated id). User must start a batch before scanning cones.
 *
 * @param {{ floor: 'linking'|'sampling', issuedByEmail: string }} params
 * @returns {Promise<{ issueBatchId: string, floor: string, createdAt: Date, issuedByEmail: string }>}
 */
export const createFloorIssueBatch = async ({ floor, issuedByEmail }) => {
  const email = typeof issuedByEmail === 'string' ? issuedByEmail.trim().toLowerCase() : '';
  if (!email) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'issuedByEmail is required');
  }
  const issueBatchId = new mongoose.Types.ObjectId().toString();
  const doc = await YarnFloorIssueBatch.create({
    issueBatchId,
    floor,
    issuedByEmail: email,
  });
  return {
    issueBatchId: doc.issueBatchId,
    floor: doc.floor,
    createdAt: doc.createdAt,
    issuedByEmail: doc.issuedByEmail,
  };
};

/**
 * @param {unknown} err
 * @returns {boolean}
 */
const isStandaloneTransactionError = (err) =>
  Boolean(err?.message && err.message.includes('Transaction numbers are only allowed on a replica set member or mongos'));

/**
 * Sums net weight already issued in this batch for the same yarn catalog and transaction type.
 *
 * @param {mongoose.mongo.BSON.ObjectId} yarnCatalogId
 * @param {string} issueBatchId
 * @param {string} transactionType
 * @param {import('mongoose').ClientSession | null} session
 * @returns {Promise<number>}
 */
const sumNetWeightInBatchForYarn = async (yarnCatalogId, issueBatchId, transactionType, session) => {
  const pipe = [
    {
      $match: {
        issueBatchId,
        yarnCatalogId,
        transactionType,
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$transactionNetWeight' },
      },
    },
  ];
  const cursor = YarnTransaction.aggregate(pipe);
  if (session) cursor.session(session);
  const rows = await cursor;
  const total = rows?.[0]?.total;
  return Number.isFinite(Number(total)) ? Number(total) : 0;
};

/**
 * Ensures the batch exists, matches the floor, and adding `net` kg would not exceed per-yarn batch cap.
 *
 * @param {object} params
 * @param {string} params.issueBatchId
 * @param {'linking'|'sampling'} params.floor
 * @param {import('mongoose').Types.ObjectId} params.yarnCatalogId
 * @param {string} params.transactionType
 * @param {number} params.net
 * @param {import('mongoose').ClientSession | null} params.session
 */
const assertFloorBatchAllowsIssue = async ({
  issueBatchId,
  floor,
  yarnCatalogId,
  transactionType,
  net,
  session,
}) => {
  const q = YarnFloorIssueBatch.findOne({ issueBatchId });
  const batchDoc = session ? await q.session(session).lean() : await q.lean();
  if (!batchDoc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Floor issue batch not found. Create a new batch first.');
  }
  if (batchDoc.floor !== floor) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'This batch belongs to a different floor. Start a new batch for this tab.'
    );
  }
  const already = await sumNetWeightInBatchForYarn(yarnCatalogId, issueBatchId, transactionType, session);
  if (already + net > MAX_NET_KG_FLOOR + WEIGHT_EPSILON) {
    const remaining = Math.max(0, MAX_NET_KG_FLOOR - already);
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `This yarn already has ${already.toFixed(3)} kg net in this batch (limit ${MAX_NET_KG_FLOOR} kg). Remaining allowance: ${remaining.toFixed(3)} kg.`
    );
  }
};

/**
 * Issues one cone to linking or sampling with inventory + transaction + cone update in one Mongo transaction when supported.
 *
 * @param {{ barcode: string, floor: 'linking'|'sampling', issueBatchId: string, totalWeight: number, totalTearWeight?: number, issuedByEmail?: string }} params
 * @returns {Promise<{ transaction: import('mongoose').Document, cone: import('mongoose').Document | null }>}
 */
export const issueConeForFloor = async ({ barcode, floor, totalWeight, totalTearWeight, issuedByEmail, issueBatchId }) => {
  const trimmed = String(barcode || '').trim();
  if (!trimmed) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode is required');
  }

  const issueBatchIdTrim = String(issueBatchId || '').trim();
  if (!issueBatchIdTrim) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'issueBatchId is required. Start a new batch first.');
  }

  const cone = await YarnCone.findOne({ barcode: trimmed, ...activeYarnConeMatch });
  if (!cone) {
    throw new ApiError(httpStatus.NOT_FOUND, `Yarn cone with barcode ${trimmed} not found`);
  }

  if (cone.issueStatus === 'used') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This cone is already used and cannot be issued.');
  }
  if (cone.issueStatus === 'issued') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'This cone is already issued (e.g. to production) and cannot be issued for linking/sampling.'
    );
  }

  if (!cone.yarnCatalogId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cone has no yarn catalog reference; cannot issue for linking/sampling.');
  }

  const catalog = await YarnCatalog.findById(cone.yarnCatalogId).lean();
  if (!catalog) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Yarn catalog not found for this cone.');
  }

  if (floor === 'linking' && catalog.linking !== true) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'This yarn is not enabled for linking in the catalog. Update the yarn catalog to allow linking.'
    );
  }
  if (floor === 'sampling' && catalog.sampling !== true) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'This yarn is not enabled for sampling in the catalog. Update the yarn catalog to allow sampling.'
    );
  }

  const tw = Number(totalWeight);
  const tt = Number(totalTearWeight ?? 0);
  if (Number.isNaN(tw) || tw < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid total weight.');
  }
  if (Number.isNaN(tt) || tt < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid tear weight.');
  }
  const net = Math.max(0, tw - tt);
  if (net <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Net weight must be greater than zero.');
  }
  if (net > MAX_NET_KG_FLOOR + 1e-9) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cone exceeds 5 kg net limit for this floor.');
  }

  const transactionType = floor === 'linking' ? 'yarn_issued_linking' : 'yarn_issued_sampling';
  const yarnName = cone.yarnName || catalog.yarnName || '';

  const basePayload = normaliseTransactionPayload({
    yarnCatalogId: cone.yarnCatalogId.toString(),
    yarnName,
    transactionType,
    transactionDate: new Date().toISOString(),
    totalWeight: tw,
    totalTearWeight: tt,
    totalNetWeight: net,
    numberOfCones: 1,
    conesIdsArray: [cone._id],
    issueBatchId: issueBatchIdTrim,
  });
  const issuer = typeof issuedByEmail === 'string' ? issuedByEmail.trim() : '';
  const normalisedPayload = issuer
    ? { ...basePayload, issuedByEmail: issuer.toLowerCase() }
    : basePayload;

  const coneId = /** @type {mongoose.Types.ObjectId} */ (cone._id);

  const applyConeUpdate = async (sess) => {
    const opts = sess ? { new: true, session: sess } : { new: true };
    return YarnCone.findByIdAndUpdate(
      coneId,
      {
        $set: {
          issueStatus: 'used',
          issueDate: new Date(),
          issueWeight: net,
          coneWeight: 0,
          tearWeight: 0,
        },
        $unset: { coneStorageId: '', orderId: '', articleId: '' },
      },
      opts
    ).exec();
  };

  const session = await mongoose.startSession();
  /** @type {{ transaction: import('mongoose').Document, cone: import('mongoose').Document | null } | undefined} */
  let result;

  try {
    await session.withTransaction(async () => {
      await assertFloorBatchAllowsIssue({
        issueBatchId: issueBatchIdTrim,
        floor,
        yarnCatalogId: cone.yarnCatalogId,
        transactionType,
        net,
        session,
      });
      const txn = await runCreateTransactionLogic(session, normalisedPayload);
      const updatedCone = await applyConeUpdate(session);
      result = { transaction: txn, cone: updatedCone };
    });
  } catch (err) {
    await session.endSession();
    if (isStandaloneTransactionError(err)) {
      await assertFloorBatchAllowsIssue({
        issueBatchId: issueBatchIdTrim,
        floor,
        yarnCatalogId: cone.yarnCatalogId,
        transactionType,
        net,
        session: null,
      });
      const txn = await runCreateTransactionLogic(null, normalisedPayload);
      const updatedCone = await applyConeUpdate(null);
      return { transaction: txn, cone: updatedCone };
    }
    throw err;
  }

  await session.endSession();
  if (!result) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Floor issue did not complete.');
  }
  return result;
};
