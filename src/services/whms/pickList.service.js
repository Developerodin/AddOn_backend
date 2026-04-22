import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import PickList from '../../models/whms/pickList.model.js';
import StyleCodePairs from '../../models/styleCodePairs.model.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Auto-create picklist entries when a warehouse order is created.
 *
 * Single-pair items  → 1 picklist row  (skuCode === styleCode)
 * Multi-pair items   → N picklist rows (skuCode = pairStyleCode,
 *                      styleCode = each individual code inside the pair)
 */
export const createPickListForOrder = async (order) => {
  const docs = [];
  const orderSnapshot = order.toObject ? order.toObject() : { ...order };
  const base = {
    orderId: order._id,
    orderNumber: order.orderNumber,
    addonOrderId: order.addonOrderId,
    orderDetails: orderSnapshot,
  };

  const singleItems = Array.isArray(order.styleCodeSinglePair) ? order.styleCodeSinglePair : [];
  for (const item of singleItems) {
    docs.push({
      ...base,
      size: item.pack || '',
      shade: item.colour || '',
      skuCode: item.styleCode,
      styleCode: item.styleCode,
      quantity: item.quantity,
      pickupQuantity: 0,
    });
  }

  const multiItems = Array.isArray(order.styleCodeMultiPair) ? order.styleCodeMultiPair : [];
  if (multiItems.length) {
    const pairIds = multiItems.map((i) => i.styleCodeMultiPairId).filter(Boolean);
    const pairs = await StyleCodePairs.find({ _id: { $in: pairIds } })
      .populate('styleCodes', 'styleCode')
      .lean();
    const pairMap = new Map(pairs.map((p) => [String(p._id), p]));

    for (const item of multiItems) {
      const pair = pairMap.get(String(item.styleCodeMultiPairId));
      if (!pair) continue;

      const skuCode = pair.pairStyleCode || item.styleCode;
      const childCodes = Array.isArray(pair.styleCodes) ? pair.styleCodes : [];

      if (childCodes.length === 0) {
        docs.push({
          ...base,
          size: item.pack || '',
          shade: item.colour || '',
          skuCode,
          styleCode: skuCode,
          quantity: item.quantity,
          pickupQuantity: 0,
        });
      } else {
        for (const child of childCodes) {
          docs.push({
            ...base,
            size: item.pack || '',
            shade: item.colour || '',
            skuCode,
            styleCode: child.styleCode,
            quantity: item.quantity,
            pickupQuantity: 0,
          });
        }
      }
    }
  }

  const mergedDocs = mergePickListRowsByKey(docs);
  if (mergedDocs.length) {
    await PickList.insertMany(mergedDocs);
  }

  return mergedDocs.length;
};

const buildPickRowKey = (row) => [
  String(row.skuCode || ''),
  String(row.styleCode || ''),
  String(row.size || ''),
  String(row.shade || ''),
].join('||');

/** Merge rows with the same sku/style/size/shade; sum quantity (multi-line orders → one pick row). */
const mergePickListRowsByKey = (rows) => {
  const map = new Map();
  for (const row of rows) {
    const key = buildPickRowKey(row);
    const qty = Number(row.quantity || 0);
    if (!map.has(key)) {
      map.set(key, { ...row, quantity: qty });
    } else {
      const agg = map.get(key);
      agg.quantity = Number(agg.quantity || 0) + qty;
    }
  }
  return [...map.values()];
};

const getPickupStatus = (pickupQuantity, quantity) => {
  if (pickupQuantity > 0 && pickupQuantity < quantity) return 'partial';
  if (pickupQuantity >= quantity) return 'picked';
  return 'pending';
};

/**
 * Refresh denormalized order fields on existing pick rows (orderNumber, addonOrderId, orderDetails snapshot).
 * Use when the warehouse order was edited without replacing line items, so pickup progress is kept.
 */
export const syncPickListOrderMetadata = async (order) => {
  const orderSnapshot = order.toObject ? order.toObject() : { ...order };
  await PickList.updateMany(
    { orderId: order._id },
    { $set: { orderNumber: order.orderNumber, addonOrderId: order.addonOrderId, orderDetails: orderSnapshot } }
  );
};

/**
 * Incrementally sync picklist lines after warehouse-order line edits.
 * Keeps pickup progress for unchanged rows, and only creates/updates/deletes changed rows.
 */
export const syncPickListForOrderLineItems = async (order) => {
  const orderSnapshot = order.toObject ? order.toObject() : { ...order };
  const base = {
    orderId: order._id,
    orderNumber: order.orderNumber,
    addonOrderId: order.addonOrderId,
    orderDetails: orderSnapshot,
  };

  const expectedRows = [];
  const singleItems = Array.isArray(order.styleCodeSinglePair) ? order.styleCodeSinglePair : [];
  for (const item of singleItems) {
    expectedRows.push({
      ...base,
      size: item.pack || '',
      shade: item.colour || '',
      skuCode: item.styleCode,
      styleCode: item.styleCode,
      quantity: item.quantity,
    });
  }

  const multiItems = Array.isArray(order.styleCodeMultiPair) ? order.styleCodeMultiPair : [];
  if (multiItems.length) {
    const pairIds = multiItems.map((i) => i.styleCodeMultiPairId).filter(Boolean);
    const pairs = await StyleCodePairs.find({ _id: { $in: pairIds } })
      .populate('styleCodes', 'styleCode')
      .lean();
    const pairMap = new Map(pairs.map((p) => [String(p._id), p]));

    for (const item of multiItems) {
      const pair = pairMap.get(String(item.styleCodeMultiPairId));
      if (!pair) continue;

      const skuCode = pair.pairStyleCode || item.styleCode;
      const childCodes = Array.isArray(pair.styleCodes) ? pair.styleCodes : [];

      if (childCodes.length === 0) {
        expectedRows.push({
          ...base,
          size: item.pack || '',
          shade: item.colour || '',
          skuCode,
          styleCode: skuCode,
          quantity: item.quantity,
        });
      } else {
        for (const child of childCodes) {
          expectedRows.push({
            ...base,
            size: item.pack || '',
            shade: item.colour || '',
            skuCode,
            styleCode: child.styleCode,
            quantity: item.quantity,
          });
        }
      }
    }
  }

  const mergedExpected = mergePickListRowsByKey(expectedRows);

  const existingRows = await PickList.find({ orderId: order._id }).sort({ createdAt: 1 });
  const existingBuckets = new Map();
  for (const row of existingRows) {
    const key = buildPickRowKey(row);
    if (!existingBuckets.has(key)) existingBuckets.set(key, []);
    existingBuckets.get(key).push(row);
  }

  const updates = [];
  const creates = [];
  const deleteIds = [];
  for (const expected of mergedExpected) {
    const key = buildPickRowKey(expected);
    const bucket = existingBuckets.get(key) || [];
    const matchedRows = bucket.length ? [...bucket] : [];
    existingBuckets.set(key, []);

    if (matchedRows.length === 0) {
      creates.push({ ...expected, pickupQuantity: 0, status: 'pending' });
      continue;
    }

    const [primary, ...duplicates] = matchedRows;
    const summedPickup = matchedRows.reduce((s, r) => s + Number(r.pickupQuantity || 0), 0);
    const nextPickup = Math.min(summedPickup, Number(expected.quantity || 0));

    updates.push({
      updateOne: {
        filter: { _id: primary._id },
        update: {
          $set: {
            orderNumber: expected.orderNumber,
            addonOrderId: expected.addonOrderId,
            orderDetails: expected.orderDetails,
            size: expected.size,
            shade: expected.shade,
            skuCode: expected.skuCode,
            styleCode: expected.styleCode,
            quantity: expected.quantity,
            pickupQuantity: nextPickup,
            status: getPickupStatus(nextPickup, Number(expected.quantity || 0)),
          },
        },
      },
    });
    for (const dup of duplicates) {
      deleteIds.push(dup._id);
    }
  }

  for (const bucket of existingBuckets.values()) {
    for (const row of bucket) deleteIds.push(row._id);
  }

  const operations = [];
  if (updates.length) operations.push(PickList.bulkWrite(updates));
  if (creates.length) operations.push(PickList.insertMany(creates));
  if (deleteIds.length) operations.push(PickList.deleteMany({ _id: { $in: deleteIds } }));
  if (operations.length) await Promise.all(operations);
};

export const buildPickListFilter = (query) => {
  const filter = {};

  if (query.orderId) filter.orderId = query.orderId;
  if (query.orderNumber && String(query.orderNumber).trim()) {
    filter.orderNumber = new RegExp(`^${escapeRegex(String(query.orderNumber).trim())}`, 'i');
  }
  if (query.addonOrderId && String(query.addonOrderId).trim()) {
    filter.addonOrderId = new RegExp(`^${escapeRegex(String(query.addonOrderId).trim())}`, 'i');
  }
  if (query.skuCode) filter.skuCode = new RegExp(`^${escapeRegex(String(query.skuCode).trim())}`, 'i');
  if (query.styleCode) filter.styleCode = new RegExp(`^${escapeRegex(String(query.styleCode).trim())}`, 'i');
  if (query.status) filter.status = query.status;

  if (query.q && String(query.q).trim()) {
    const term = escapeRegex(String(query.q).trim());
    const regex = new RegExp(term, 'i');
    filter.$or = [{ orderNumber: regex }, { addonOrderId: regex }, { skuCode: regex }, { styleCode: regex }];
  }

  return filter;
};

export const queryPickLists = async (filter, options) => {
  return PickList.paginate(filter, {
    ...options,
    populate: 'orderId',
  });
};

export const getPickListById = async (id) => {
  return PickList.findById(id).populate('orderId');
};

export const getPickListsByOrderId = async (orderId) => {
  return PickList.find({ orderId }).populate('orderId').sort({ createdAt: 1 });
};

export const updatePickListById = async (id, updateBody) => {
  const doc = await PickList.findById(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Pick list entry not found');

  Object.assign(doc, updateBody);

  if (doc.pickupQuantity > 0 && doc.pickupQuantity < doc.quantity) {
    doc.status = 'partial';
  } else if (doc.pickupQuantity >= doc.quantity) {
    doc.status = 'picked';
  }

  await doc.save();
  return getPickListById(id);
};

export const deletePickListById = async (id) => {
  const doc = await PickList.findByIdAndDelete(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Pick list entry not found');
  return doc;
};

export const deletePickListsByOrderId = async (orderId) => {
  return PickList.deleteMany({ orderId });
};

/**
 * Build a $match-safe filter for aggregation.
 * Converts `orderId` string to ObjectId so $group works correctly.
 */
export const buildPickListAggFilter = (query) => {
  const filter = buildPickListFilter(query);
  if (filter.orderId && typeof filter.orderId === 'string') {
    filter.orderId = new mongoose.Types.ObjectId(filter.orderId);
  }
  return filter;
};

/**
 * Return pick-list data grouped by order with pagination & summary counts.
 */
export const queryPickListsGroupedByOrder = async (filter, options) => {
  const page = Number(options.page) || 1;
  const limit = Number(options.limit) || 10;
  const skip = (page - 1) * limit;

  const basePipeline = [
    { $match: filter },
    // Attach live stock (WarehouseInventory) by styleCode before grouping.
    // Inventory collection name is legacy `stocks` (see WarehouseInventory model).
    {
      $lookup: {
        from: 'stocks',
        localField: 'styleCode',
        foreignField: 'styleCode',
        as: 'inv',
      },
    },
    { $unwind: { path: '$inv', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        availableStock: { $ifNull: ['$inv.availableQuantity', 0] },
      },
    },
    { $unset: ['inv'] },
    {
      $group: {
        _id: '$orderId',
        orderNumber: { $first: '$orderNumber' },
        addonOrderId: { $first: '$addonOrderId' },
        items: {
          $push: {
            id: '$_id',
            size: '$size',
            shade: '$shade',
            skuCode: '$skuCode',
            styleCode: '$styleCode',
            quantity: '$quantity',
            pickupQuantity: '$pickupQuantity',
            status: '$status',
            availableStock: '$availableStock',
          },
        },
        totalQuantity: { $sum: '$quantity' },
        totalPickupQuantity: { $sum: '$pickupQuantity' },
        totalItems: { $sum: 1 },
        pendingCount: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        partialCount: { $sum: { $cond: [{ $eq: ['$status', 'partial'] }, 1, 0] } },
        pickedCount: { $sum: { $cond: [{ $eq: ['$status', 'picked'] }, 1, 0] } },
      },
    },
    {
      $lookup: {
        from: 'warehouseorders',
        localField: '_id',
        foreignField: '_id',
        as: 'order',
      },
    },
    { $unwind: { path: '$order', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'warehouse_clients',
        localField: 'order.clientId',
        foreignField: '_id',
        as: 'whClient',
      },
    },
    { $unwind: { path: '$whClient', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        order: {
          $mergeObjects: [
            '$order',
            {
              clientName: {
                $cond: [
                  { $eq: ['$order.clientType', 'Store'] },
                  {
                    $ifNull: ['$whClient.storeProfile.billCode', '$order.clientName'],
                  },
                  {
                    $ifNull: ['$whClient.retailerName', '$order.clientName'],
                  },
                ],
              },
            },
          ],
        },
      },
    },
    { $unset: ['whClient'] },
    {
      $addFields: {
        orderId: '$_id',
        // Keep these at the top-level so clients don't have to dig into `order`.
        clientType: '$order.clientType',
        clientName: '$order.clientName',
        overallStatus: {
          $cond: [
            { $eq: ['$pickedCount', '$totalItems'] },
            'picked',
            {
              $cond: [
                { $or: [{ $gt: ['$partialCount', 0] }, { $gt: ['$pickedCount', 0] }] },
                'partial',
                'pending',
              ],
            },
          ],
        },
      },
    },
    { $sort: { 'order.createdAt': -1 } },
  ];

  const countPipeline = [...basePipeline, { $count: 'total' }];
  const [countResult] = await PickList.aggregate(countPipeline);
  const totalResults = countResult ? countResult.total : 0;

  const summaryPipeline = [
    { $match: filter },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        partial: { $sum: { $cond: [{ $eq: ['$status', 'partial'] }, 1, 0] } },
        picked: { $sum: { $cond: [{ $eq: ['$status', 'picked'] }, 1, 0] } },
      },
    },
    { $project: { _id: 0 } },
  ];
  const [summary] = await PickList.aggregate(summaryPipeline);

  const resultsPipeline = [...basePipeline, { $skip: skip }, { $limit: limit }];
  const results = await PickList.aggregate(resultsPipeline);

  return {
    results,
    summary: summary || { total: 0, pending: 0, partial: 0, picked: 0 },
    page,
    limit,
    totalPages: Math.ceil(totalResults / limit),
    totalResults,
  };
};
