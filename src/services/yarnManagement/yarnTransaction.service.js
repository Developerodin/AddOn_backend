import mongoose from 'mongoose';
import httpStatus from 'http-status';
import { YarnTransaction, YarnInventory, YarnCatalog, YarnRequisition } from '../../models/index.js';
import { ProductionOrder, Article } from '../../models/production/index.js';
import Product from '../../models/product.model.js';
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
 * Adds the provided delta to the bucket. Ensures values don't go negative.
 */
const applyDelta = (bucket, delta, bucketName) => {
  bucket.totalWeight += toNumber(delta.totalWeight);
  bucket.totalTearWeight += toNumber(delta.totalTearWeight);
  bucket.netWeight += toNumber(delta.totalNetWeight);
  bucket.numberOfCones += toNumber(delta.numberOfCones);
  
  // Ensure values don't go negative
  bucket.totalWeight = Math.max(0, bucket.totalWeight);
  bucket.totalTearWeight = Math.max(0, bucket.totalTearWeight);
  bucket.netWeight = Math.max(0, bucket.netWeight);
  bucket.numberOfCones = Math.max(0, bucket.numberOfCones);
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
    orderId: body.orderId || undefined,
    orderno: body.orderno,
    articleId: body.articleId || undefined,
    articleNumber: body.articleNumber,
    machineId: body.machineId || undefined,
    // Transfer tracking fields
    boxIds: body.boxIds || [],
    conesIdsArray: body.conesIdsArray || [],
    fromStorageLocation: body.fromStorageLocation,
    toStorageLocation: body.toStorageLocation,
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
 * Applies the transaction delta to inventory buckets. Negative values are allowed.
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
      // Ensure blockedNetWeight never goes negative
      inventory.blockedNetWeight = Math.max(0, toNumber(inventory.blockedNetWeight) - toNumber(delta.totalNetWeight));
      break;
    }
    case 'yarn_blocked': {
      // Blocked yarn stays in place; we only track the reservation weight.
      inventory.blockedNetWeight = toNumber(inventory.blockedNetWeight) + toNumber(delta.totalNetWeight);
      break;
    }
    case 'yarn_stocked': {
      // Newly stocked yarn is assumed to land in long-term storage.
      // Long-term storage: Only weight (boxes), NO cones (cones are created when boxes are opened/transferred to ST)
      applyDelta(
        inventory.longTermInventory,
        {
          totalWeight: delta.totalWeight,
          totalTearWeight: delta.totalTearWeight,
          totalNetWeight: delta.totalNetWeight,
          numberOfCones: 0, // Boxes in LT storage don't have individual cones
        },
        'long-term inventory'
      );
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
  const totalNet = toNumber(inventory.totalInventory?.totalNetWeight || 0);
  const blockedNet = Math.max(0, toNumber(inventory.blockedNetWeight || 0)); // Ensure non-negative
  const availableNet = Math.max(totalNet - blockedNet, 0);
  const minQty = toNumber(yarnDoc?.minQuantity || 0);

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
  const totalNet = toNumber(inventory.totalInventory?.totalNetWeight || 0);
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

  if (filters.order_id) {
    mongooseFilter.orderId = filters.order_id;
  }

  if (filters.orderno) {
    mongooseFilter.orderno = { $regex: filters.orderno, $options: 'i' };
  }

  if (filters.article_id) {
    mongooseFilter.articleId = filters.article_id;
  }

  if (filters.article_number) {
    mongooseFilter.articleNumber = { $regex: filters.article_number, $options: 'i' };
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
    .populate({ path: 'orderId', select: 'orderNumber' })
    .populate({ path: 'articleId', select: 'articleNumber orderId machineId' })
    .populate({ path: 'machineId', select: 'machineCode machineNumber model floor' })
    .sort({ transactionDate: -1 })
    .lean();

  return transactions;
};

/**
 * Enriches yarn transactions with article information by matching yarns to articles via BOM
 * @param {Array} transactions - Array of yarn transactions
 * @param {String} orderno - Order number to fetch articles for
 * @returns {Array} Transactions grouped by article with article details
 */
export const groupTransactionsByArticle = async (transactions, orderno) => {
  if (!transactions || transactions.length === 0) {
    return [];
  }

  // Find production order by orderNumber
  const productionOrder = await ProductionOrder.findOne({ 
    orderNumber: orderno 
  }).lean();

  if (!productionOrder) {
    // If order not found, group by articleNumber from transactions (if available)
    return groupTransactionsByArticleNumber(transactions);
  }

  // Get all articles for this order
  const articles = await Article.find({ 
    orderId: productionOrder._id 
  })
    .select('articleNumber plannedQuantity status progress')
    .lean();

  if (!articles || articles.length === 0) {
    // If no articles found, group by articleNumber from transactions (if available)
    return groupTransactionsByArticleNumber(transactions);
  }

  // Build a map of articleNumber -> yarnNames from BOM
  const articleYarnMap = new Map(); // articleNumber -> Set of yarnNames
  
  for (const article of articles) {
    try {
      // Find product by factoryCode (articleNumber = factoryCode)
      const product = await Product.findOne({ 
        factoryCode: article.articleNumber 
      })
        .populate({
          path: 'bom.yarnCatalogId',
          select: 'yarnName'
        })
        .select('bom')
        .lean();

      if (product && product.bom && product.bom.length > 0) {
        const yarnNames = new Set();
        product.bom.forEach(bomItem => {
          const yarnName = bomItem.yarnName || (bomItem.yarnCatalogId?.yarnName);
          if (yarnName) {
            yarnNames.add(yarnName);
          }
        });
        if (yarnNames.size > 0) {
          articleYarnMap.set(article.articleNumber, {
            yarnNames,
            articleInfo: article
          });
        }
      }
    } catch (error) {
      console.error(`Error fetching BOM for article ${article.articleNumber}:`, error.message);
    }
  }

  // Group transactions by article
  const groupedByArticle = {};
  const unmatchedTransactions = [];

  transactions.forEach(transaction => {
    const transactionYarnName = transaction.yarnName;
    let matched = false;

    // Try to match transaction to article via BOM
    for (const [articleNumber, { yarnNames, articleInfo }] of articleYarnMap.entries()) {
      if (yarnNames.has(transactionYarnName)) {
        if (!groupedByArticle[articleNumber]) {
          groupedByArticle[articleNumber] = {
            articleNumber: articleNumber,
            articleInfo: {
              plannedQuantity: articleInfo.plannedQuantity,
              status: articleInfo.status,
              progress: articleInfo.progress,
            },
            transactions: [],
            totals: {
              transactionNetWeight: 0,
              transactionTotalWeight: 0,
              transactionTearWeight: 0,
              transactionConeCount: 0,
            }
          };
        }
        
        groupedByArticle[articleNumber].transactions.push(transaction);
        groupedByArticle[articleNumber].totals.transactionNetWeight += transaction.transactionNetWeight || 0;
        groupedByArticle[articleNumber].totals.transactionTotalWeight += transaction.transactionTotalWeight || 0;
        groupedByArticle[articleNumber].totals.transactionTearWeight += transaction.transactionTearWeight || 0;
        groupedByArticle[articleNumber].totals.transactionConeCount += transaction.transactionConeCount || 0;
        matched = true;
        break;
      }
    }

    // If transaction has articleNumber but wasn't matched via BOM, use the articleNumber from transaction
    if (!matched && transaction.articleNumber) {
      if (!groupedByArticle[transaction.articleNumber]) {
        groupedByArticle[transaction.articleNumber] = {
          articleNumber: transaction.articleNumber,
          articleInfo: null,
          transactions: [],
          totals: {
            transactionNetWeight: 0,
            transactionTotalWeight: 0,
            transactionTearWeight: 0,
            transactionConeCount: 0,
          }
        };
      }
      groupedByArticle[transaction.articleNumber].transactions.push(transaction);
      groupedByArticle[transaction.articleNumber].totals.transactionNetWeight += transaction.transactionNetWeight || 0;
      groupedByArticle[transaction.articleNumber].totals.transactionTotalWeight += transaction.transactionTotalWeight || 0;
      groupedByArticle[transaction.articleNumber].totals.transactionTearWeight += transaction.transactionTearWeight || 0;
      groupedByArticle[transaction.articleNumber].totals.transactionConeCount += transaction.transactionConeCount || 0;
      matched = true;
    }

    if (!matched) {
      unmatchedTransactions.push(transaction);
    }
  });

  // Add unmatched transactions to a "NO_ARTICLE" group
  if (unmatchedTransactions.length > 0) {
    groupedByArticle['NO_ARTICLE'] = {
      articleNumber: null,
      articleInfo: null,
      transactions: unmatchedTransactions,
      totals: {
        transactionNetWeight: unmatchedTransactions.reduce((sum, t) => sum + (t.transactionNetWeight || 0), 0),
        transactionTotalWeight: unmatchedTransactions.reduce((sum, t) => sum + (t.transactionTotalWeight || 0), 0),
        transactionTearWeight: unmatchedTransactions.reduce((sum, t) => sum + (t.transactionTearWeight || 0), 0),
        transactionConeCount: unmatchedTransactions.reduce((sum, t) => sum + (t.transactionConeCount || 0), 0),
      }
    };
  }

  return Object.values(groupedByArticle);
};

/**
 * Groups transactions by articleNumber field if available
 * @param {Array} transactions - Array of yarn transactions
 * @returns {Array} Transactions grouped by articleNumber
 */
const groupTransactionsByArticleNumber = (transactions) => {
  const grouped = {};
  
  transactions.forEach(transaction => {
    const articleKey = transaction.articleNumber || 'NO_ARTICLE';
    
    if (!grouped[articleKey]) {
      grouped[articleKey] = {
        articleNumber: transaction.articleNumber || null,
        articleInfo: null,
        transactions: [],
        totals: {
          transactionNetWeight: 0,
          transactionTotalWeight: 0,
          transactionTearWeight: 0,
          transactionConeCount: 0,
        }
      };
    }
    
    grouped[articleKey].transactions.push(transaction);
    grouped[articleKey].totals.transactionNetWeight += transaction.transactionNetWeight || 0;
    grouped[articleKey].totals.transactionTotalWeight += transaction.transactionTotalWeight || 0;
    grouped[articleKey].totals.transactionTearWeight += transaction.transactionTearWeight || 0;
    grouped[articleKey].totals.transactionConeCount += transaction.transactionConeCount || 0;
  });
  
  return Object.values(grouped);
};

/**
 * Gets all yarn_issued transactions for a specific order number.
 * Returns transactions grouped by articleNumber if available, otherwise by yarnName.
 * If groupByArticle is true, returns data grouped by article; otherwise returns flat array.
 */
export const getYarnIssuedByOrder = async (orderno, groupByArticle = false) => {
  const transactions = await YarnTransaction.find({
    orderno: orderno,
    transactionType: 'yarn_issued',
  })
    .populate({
      path: 'yarn',
      select: '_id yarnName yarnType status',
    })
    .sort({ transactionDate: -1 })
    .lean();

  // If groupByArticle is true, group transactions by articleNumber
  if (groupByArticle) {
    const groupedByArticle = {};
    
    transactions.forEach(transaction => {
      const articleKey = transaction.articleNumber || 'NO_ARTICLE';
      
      if (!groupedByArticle[articleKey]) {
        groupedByArticle[articleKey] = {
          articleNumber: transaction.articleNumber || null,
          transactions: [],
          totals: {
            transactionNetWeight: 0,
            transactionTotalWeight: 0,
            transactionTearWeight: 0,
            transactionConeCount: 0,
          }
        };
      }
      
      groupedByArticle[articleKey].transactions.push(transaction);
      groupedByArticle[articleKey].totals.transactionNetWeight += transaction.transactionNetWeight || 0;
      groupedByArticle[articleKey].totals.transactionTotalWeight += transaction.transactionTotalWeight || 0;
      groupedByArticle[articleKey].totals.transactionTearWeight += transaction.transactionTearWeight || 0;
      groupedByArticle[articleKey].totals.transactionConeCount += transaction.transactionConeCount || 0;
    });
    
    // Convert to array format
    return Object.values(groupedByArticle);
  }

  // Default: return flat array grouped by yarnName
  const groupedByYarn = {};
  
  transactions.forEach(transaction => {
    const yarnKey = transaction.yarnName || 'UNKNOWN_YARN';
    
    if (!groupedByYarn[yarnKey]) {
      groupedByYarn[yarnKey] = {
        yarnName: transaction.yarnName,
        yarn: transaction.yarn,
        transactions: [],
        totals: {
          transactionNetWeight: 0,
          transactionTotalWeight: 0,
          transactionTearWeight: 0,
          transactionConeCount: 0,
        }
      };
    }
    
    groupedByYarn[yarnKey].transactions.push(transaction);
    groupedByYarn[yarnKey].totals.transactionNetWeight += transaction.transactionNetWeight || 0;
    groupedByYarn[yarnKey].totals.transactionTotalWeight += transaction.transactionTotalWeight || 0;
    groupedByYarn[yarnKey].totals.transactionTearWeight += transaction.transactionTearWeight || 0;
    groupedByYarn[yarnKey].totals.transactionConeCount += transaction.transactionConeCount || 0;
  });
  
  return Object.values(groupedByYarn);
};

/**
 * Gets all yarn_issued transactions.
 * Returns all transactions with transactionType 'yarn_issued' regardless of order number.
 * Optionally filters by date range if start_date and/or end_date are provided.
 */
export const getAllYarnIssued = async (filters = {}) => {
  const mongooseFilter = {
    transactionType: 'yarn_issued',
  };

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


