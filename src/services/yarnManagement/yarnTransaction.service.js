import mongoose from 'mongoose';
import httpStatus from 'http-status';
import { YarnTransaction, YarnInventory, YarnCatalog, YarnRequisition } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Produces an inventory bucket with all numeric values initialised to zero.
 */
const ZERO_BUCKET = () => ({
  totalWeight: 0,
  numberOfCones: 0,
  totalTearWeight: 0,
  netWeight: 0,
});

const toNumber = (value) => Number(value ?? 0);

/**
 * Makes sure the requested inventory bucket exists and contains numeric values.
 */
const ensureBucket = (inventory, key) => {
  if (!inventory[key]) {
    inventory[key] = ZERO_BUCKET();
  }
  inventory[key].totalWeight = toNumber(inventory[key].totalWeight);
  inventory[key].numberOfCones = toNumber(inventory[key].numberOfCones);
  inventory[key].totalTearWeight = toNumber(inventory[key].totalTearWeight);
  inventory[key].netWeight = toNumber(inventory[key].netWeight);
  return inventory[key];
};

/**
 * Adds the provided delta to the bucket and ensures we never drop below zero.
 */
const applyDelta = (bucket, delta, bucketName) => {
  bucket.totalWeight += toNumber(delta.totalWeight);
  bucket.totalTearWeight += toNumber(delta.totalTearWeight);
  bucket.netWeight += toNumber(delta.totalNetWeight);
  bucket.numberOfCones += toNumber(delta.numberOfCones);

  ['totalWeight', 'totalTearWeight', 'netWeight', 'numberOfCones'].forEach((field) => {
    if (bucket[field] < 0 - Number.EPSILON) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Operation would result in negative ${field} for ${bucketName}. Aborting transaction.`
      );
    }
    if (bucket[field] < 0) {
      bucket[field] = 0;
    }
  });
};

/**
 * Rebuilds the total inventory bucket based on short- and long-term buckets.
 */
const recalcTotalInventory = (inventory) => {
  const longTerm = ensureBucket(inventory, 'longTermInventory');
  const shortTerm = ensureBucket(inventory, 'shortTermInventory');
  const total = ensureBucket(inventory, 'totalInventory');

  total.totalWeight = toNumber(longTerm.totalWeight) + toNumber(shortTerm.totalWeight);
  total.totalTearWeight = toNumber(longTerm.totalTearWeight) + toNumber(shortTerm.totalTearWeight);
  total.netWeight = toNumber(longTerm.netWeight) + toNumber(shortTerm.netWeight);
  total.numberOfCones = toNumber(longTerm.numberOfCones) + toNumber(shortTerm.numberOfCones);
};

/**
 * Normalises client payload into the fields stored on the transaction document.
 * The API accepts camelCase convenience fields (e.g. totalWeight) and maps them
 * into the schema-specific properties. Block transactions rely on totalBlockedWeight.
 */
const normaliseTransactionPayload = (inputBody) => {
  const body = { ...inputBody };
  const isBlocked = body.transactionType === 'yarn_blocked';

  const totalWeight = body.totalWeight ?? body.transactionTotalWeight;
  const totalNetWeight = body.totalNetWeight ?? body.transactionNetWeight;
  const totalTearWeight =
    body.totalTearWeight ?? body.transactionTearWeight ?? (totalWeight != null && totalNetWeight != null
      ? Math.max(toNumber(totalWeight) - toNumber(totalNetWeight), 0)
      : undefined);
  const numberOfCones = body.numberOfCones ?? body.transactionConeCount;

  const payload = {
    yarn: body.yarn,
    yarnName: body.yarnName,
    transactionType: body.transactionType,
    transactionDate: body.transactionDate,
    transactionNetWeight: 0,
    transactionTotalWeight: 0,
    transactionTearWeight: 0,
    transactionConeCount: 0,
    orderno: body.orderno,
  };

  if (isBlocked) {
    const blockedWeight = body.totalBlockedWeight ?? body.transactionNetWeight ?? 0;
    payload.transactionNetWeight = toNumber(blockedWeight);
    payload.transactionTotalWeight = toNumber(blockedWeight);
    payload.transactionTearWeight = 0;
    payload.transactionConeCount = 0;
  } else {
    payload.transactionNetWeight = toNumber(totalNetWeight);
    payload.transactionTotalWeight = toNumber(totalWeight);
    payload.transactionTearWeight = toNumber(totalTearWeight);
    payload.transactionConeCount = toNumber(numberOfCones);
  }

  return payload;
};

/**
 * Loads or creates the YarnInventory document for the provided yarn reference.
 */
const ensureInventoryDocument = async (session, transactionPayload) => {
  let inventory = await YarnInventory.findOne({ yarn: transactionPayload.yarn }).session(session);

  if (!inventory) {
    inventory = new YarnInventory({
      yarn: transactionPayload.yarn,
      yarnName: transactionPayload.yarnName,
      totalInventory: ZERO_BUCKET(),
      longTermInventory: ZERO_BUCKET(),
      shortTermInventory: ZERO_BUCKET(),
      blockedNetWeight: 0,
      inventoryStatus: 'in_stock',
    });
  } else if (!inventory.yarnName) {
    inventory.yarnName = transactionPayload.yarnName;
  }

  ensureBucket(inventory, 'longTermInventory');
  ensureBucket(inventory, 'shortTermInventory');
  ensureBucket(inventory, 'totalInventory');

  inventory.blockedNetWeight = toNumber(inventory.blockedNetWeight);

  return inventory;
};

/**
 * Applies the transaction delta to inventory buckets. Negative deltas are validated
 * via applyDelta to guarantee the "never negative inventory" rule.
 */
const updateInventoryBuckets = (inventory, transaction) => {
  const delta = {
    totalWeight: transaction.transactionTotalWeight,
    totalTearWeight: transaction.transactionTearWeight,
    totalNetWeight: transaction.transactionNetWeight,
    numberOfCones: transaction.transactionConeCount,
  };

  switch (transaction.transactionType) {
    case 'yarn_issued': {
      // Physical yarn leaves short-term storage; blocked reservations are released.
      applyDelta(
        inventory.shortTermInventory,
        {
          totalWeight: -delta.totalWeight,
          totalTearWeight: -delta.totalTearWeight,
          totalNetWeight: -delta.totalNetWeight,
          numberOfCones: -delta.numberOfCones,
        },
        'short-term inventory'
      );
      inventory.blockedNetWeight = Math.max(
        0,
        toNumber(inventory.blockedNetWeight) - toNumber(delta.totalNetWeight)
      );
      break;
    }
    case 'yarn_blocked': {
      // Blocked yarn stays in place; we only track the reservation weight.
      inventory.blockedNetWeight = toNumber(inventory.blockedNetWeight) + toNumber(delta.totalNetWeight);
      break;
    }
    case 'yarn_stocked': {
      // Newly stocked yarn is assumed to land in long-term storage.
      applyDelta(inventory.longTermInventory, delta, 'long-term inventory');
      break;
    }
    case 'internal_transfer': {
      // Inventory moves from long-term to short-term staging areas.
      applyDelta(
        inventory.longTermInventory,
        {
          totalWeight: -delta.totalWeight,
          totalTearWeight: -delta.totalTearWeight,
          totalNetWeight: -delta.totalNetWeight,
          numberOfCones: -delta.numberOfCones,
        },
        'long-term inventory'
      );
      applyDelta(inventory.shortTermInventory, delta, 'short-term inventory');
      break;
    }
    case 'yarn_returned': {
      // Returned yarn is restaged into short-term storage for inspection/use.
      applyDelta(inventory.shortTermInventory, delta, 'short-term inventory');
      break;
    }
    default:
      break;
  }

  recalcTotalInventory(inventory);

  const totalNet = toNumber(inventory.totalInventory.netWeight);
  if (totalNet < 0 - Number.EPSILON) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Operation would result in negative total net weight. Aborting transaction.'
    );
  }

  if (totalNet < 0) {
    inventory.totalInventory.netWeight = 0;
  }
};

/**
 * Adjusts the inventory status (in_stock / low / soon) and raises/updates a yarn requisition
 * whenever we breach thresholds or block more yarn than is available.
 */
const updateInventoryStatusAndMaybeRaiseRequisition = async (
  session,
  inventory,
  yarnDoc,
  trigger
) => {
  const totalNet = toNumber(inventory.totalInventory.netWeight);
  const blockedNet = toNumber(inventory.blockedNetWeight);
  const availableNet = Math.max(totalNet - blockedNet, 0);
  const minQty = toNumber(yarnDoc?.minQuantity);

  let newStatus = 'in_stock';
  if (minQty > 0) {
    if (totalNet <= minQty) {
      newStatus = 'low_stock';
    } else if (totalNet <= minQty * 1.2) {
      newStatus = 'soon_to_be_low';
    }
  }
  inventory.inventoryStatus = newStatus;
  inventory.overbooked = blockedNet > totalNet;

  const shouldRaiseRequisition =
    inventory.overbooked ||
    newStatus === 'low_stock' ||
    newStatus === 'soon_to_be_low' ||
    trigger === 'overbooked';

  if (!shouldRaiseRequisition) {
    return;
  }

  const alertStatus = inventory.overbooked ? 'overbooked' : 'below_minimum';

  await YarnRequisition.findOneAndUpdate(
    { yarn: inventory.yarn, poSent: false },
    {
      yarn: inventory.yarn,
      yarnName: inventory.yarnName,
      minQty,
      availableQty: availableNet,
      blockedQty: blockedNet,
      alertStatus,
      poSent: false,
    },
    {
      upsert: true,
      new: true,
      session,
      setDefaultsOnInsert: true,
    }
  );
};

/**
 * When a block is requested we flag the inventory so downstream logic can mark it overbooked.
 */
const validateBlockedDoesNotExceedInventory = (inventory, transaction) => {
  if (transaction.transactionType !== 'yarn_blocked') {
    return;
  }
  const totalNet = toNumber(inventory.totalInventory.netWeight);
  const blockedWeight = transaction.transactionNetWeight;

  if (blockedWeight > totalNet) {
    // Flag as overbooked; handled downstream by status updater.
    inventory.overbooked = true;
  }
};

/**
 * Creates a yarn transaction and atomically updates inventory, status, and requisition data.
 * The entire workflow runs inside a MongoDB transaction to keep the system consistent.
 */
export const createYarnTransaction = async (transactionBody) => {
  const normalisedPayload = normaliseTransactionPayload(transactionBody);

  const session = await mongoose.startSession();
  let transactionRecord;

  await session.withTransaction(async () => {
    const yarnDoc = await YarnCatalog.findById(normalisedPayload.yarn).session(session);
    if (!yarnDoc) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Referenced yarn catalog entry does not exist');
    }

    const inventory = await ensureInventoryDocument(session, normalisedPayload);

    const [transaction] = await YarnTransaction.create([normalisedPayload], { session });
    transactionRecord = transaction;

    validateBlockedDoesNotExceedInventory(inventory, transaction);
    updateInventoryBuckets(inventory, transaction);

    if (inventory.blockedNetWeight < 0 - Number.EPSILON) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Operation would result in negative blocked weight. Aborting transaction.'
      );
    }
    if (inventory.blockedNetWeight < 0) {
      inventory.blockedNetWeight = 0;
    }

    await updateInventoryStatusAndMaybeRaiseRequisition(
      session,
      inventory,
      yarnDoc,
      inventory.overbooked ? 'overbooked' : undefined
    );

    await inventory.save({ session });
  });

  await session.endSession();

  return transactionRecord;
};

export const queryYarnTransactions = async (filters = {}) => {
  const mongooseFilter = {};

  if (filters.transaction_type) {
    mongooseFilter.transactionType = filters.transaction_type;
  }

  if (filters.yarn_id) {
    mongooseFilter.yarn = filters.yarn_id;
  }

  if (filters.yarn_name) {
    mongooseFilter.yarnName = { $regex: filters.yarn_name, $options: 'i' };
  }

  if (filters.orderno) {
    mongooseFilter.orderno = { $regex: filters.orderno, $options: 'i' };
  }

  if (filters.start_date || filters.end_date) {
    mongooseFilter.transactionDate = {};
    if (filters.start_date) {
      const start = new Date(filters.start_date);
      start.setHours(0, 0, 0, 0);
      mongooseFilter.transactionDate.$gte = start;
    }
    if (filters.end_date) {
      const end = new Date(filters.end_date);
      end.setHours(23, 59, 59, 999);
      mongooseFilter.transactionDate.$lte = end;
    }
  }

  const transactions = await YarnTransaction.find(mongooseFilter)
    .populate({
      path: 'yarn',
      select: '_id yarnName yarnType status',
    })
    .sort({ transactionDate: -1 })
    .lean();

  return transactions;
};


