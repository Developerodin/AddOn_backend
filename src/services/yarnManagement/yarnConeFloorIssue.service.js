import mongoose from 'mongoose';
import httpStatus from 'http-status';
import YarnCone from '../../models/yarnReq/yarnCone.model.js';
import YarnCatalog from '../../models/yarnManagement/yarnCatalog.model.js';
import ApiError from '../../utils/ApiError.js';
import {
  normaliseTransactionPayload,
  runCreateTransactionLogic,
} from './yarnTransaction.service.js';

/** Max net weight (kg) allowed when issuing a single cone to linking/sampling. */
const MAX_NET_KG_FLOOR = 5;

/**
 * @param {unknown} err
 * @returns {boolean}
 */
const isStandaloneTransactionError = (err) =>
  Boolean(err?.message && err.message.includes('Transaction numbers are only allowed on a replica set member or mongos'));

/**
 * Issues one cone to linking or sampling with inventory + transaction + cone update in one Mongo transaction when supported.
 *
 * @param {{ barcode: string, floor: 'linking'|'sampling', totalWeight: number, totalTearWeight?: number }} params
 * @returns {Promise<{ transaction: import('mongoose').Document, cone: import('mongoose').Document | null }>}
 */
export const issueConeForFloor = async ({ barcode, floor, totalWeight, totalTearWeight }) => {
  const trimmed = String(barcode || '').trim();
  if (!trimmed) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode is required');
  }

  const cone = await YarnCone.findOne({ barcode: trimmed });
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

  const normalisedPayload = normaliseTransactionPayload({
    yarnCatalogId: cone.yarnCatalogId.toString(),
    yarnName,
    transactionType,
    transactionDate: new Date().toISOString(),
    totalWeight: tw,
    totalTearWeight: tt,
    totalNetWeight: net,
    numberOfCones: 1,
    conesIdsArray: [cone._id],
  });

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
      const txn = await runCreateTransactionLogic(session, normalisedPayload);
      const updatedCone = await applyConeUpdate(session);
      result = { transaction: txn, cone: updatedCone };
    });
  } catch (err) {
    await session.endSession();
    if (isStandaloneTransactionError(err)) {
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
