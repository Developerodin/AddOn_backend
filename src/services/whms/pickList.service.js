import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import PickList from '../../models/whms/pickList.model.js';
import StyleCode from '../../models/styleCode.model.js';
import StyleCodePairs from '../../models/styleCodePairs.model.js';
import WarehouseInventory from '../../models/whms/warehouseInventory.model.js';
import WarehouseOrder, {
  WarehouseOrderFlowStatus,
  flowStatusForCoarseStatus,
} from '../../models/whms/warehouseOrder.model.js';
import { roleRights } from '../../config/roles.js';
import { appendWarehouseInventoryLog } from './warehouseInventory.service.js';
import { buildArticleAttrsByStyleCodeId } from './warehouseOrderCatalogEnrich.js';
import { runWithOptionalMongoTransaction } from '../../utils/mongoDeployment.js';

/**
 * Stages where pick quantities may still be edited. `picking-done` is a hard gate
 * (spec: supervisor verifies, no qty edits); the Barcode Team re-opens editing at
 * `barcode-in-progress`, and everything from `packing-done` onwards is locked.
 */
const QTY_EDITABLE_FLOW_STATUSES = new Set([
  WarehouseOrderFlowStatus.ORDER_CREATED,
  WarehouseOrderFlowStatus.PICKING,
  WarehouseOrderFlowStatus.BARCODE_IN_PROGRESS,
]);

/**
 * Throw unless the order's stage (and the caller's role, during the barcode stage)
 * allows pick-quantity edits. `user` may be null for legacy callers — stage gating
 * still applies, role gating is skipped.
 */
const assertPickQtyEditable = async (orderId, user) => {
  const order = await WarehouseOrder.findById(orderId).select('flowStatus status');
  if (!order) return; // orphan pick rows — keep legacy behaviour

  const flowStatus = order.flowStatus || WarehouseOrderFlowStatus.ORDER_CREATED;
  if (!QTY_EDITABLE_FLOW_STATUSES.has(flowStatus)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Pick quantities are locked while the order is in "${flowStatus}"`
    );
  }
  if (flowStatus === WarehouseOrderFlowStatus.BARCODE_IN_PROGRESS && user) {
    const rights = roleRights.get(user.role) || [];
    if (!rights.includes('whmsBarcode')) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Only the Barcode Team can update picked quantities at this stage');
    }
  }
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Apply a pick delta to warehouse inventory for a styleCode.
 * Positive delta reduces stock (picked more). Negative delta increases stock (picked qty reduced).
 * @param {object} args
 * @param {import('mongoose').ClientSession} args.session
 * @param {string} args.styleCode
 * @param {number} args.deltaPickupQuantity
 * @param {string} args.pickListId
 */
async function applyPickDeltaToInventory({ session, styleCode, deltaPickupQuantity, pickListId }) {
  if (!styleCode || !deltaPickupQuantity) return;
  if (!Number.isFinite(deltaPickupQuantity)) return;

  let invQuery = WarehouseInventory.findOne({ styleCode });
  if (session) invQuery = invQuery.session(session);
  const inv = await invQuery;

  if (deltaPickupQuantity > 0) {
    if (!inv) {
      throw new ApiError(httpStatus.BAD_REQUEST, `No inventory row found for styleCode "${styleCode}"`);
    }
    const total = Number(inv.totalQuantity ?? 0);
    if (total < deltaPickupQuantity) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Insufficient stock for styleCode "${styleCode}" (available total: ${total}, required: ${deltaPickupQuantity})`
      );
    }
  }

  // IMPORTANT: `availableQuantity` is derived from total - blocked, but the model's
  // pre('save') hook won't run for findOneAndUpdate. So we recompute in the update itself.
  // Uses pipeline update so it's atomic and consistent.
  const updated = await WarehouseInventory.findOneAndUpdate(
    { styleCode },
    [
      {
        $set: {
          totalQuantity: { $add: ['$totalQuantity', -deltaPickupQuantity] },
        },
      },
      {
        $set: {
          availableQuantity: {
            $max: [0, { $subtract: ['$totalQuantity', { $ifNull: ['$blockedQuantity', 0] }] }],
          },
        },
      },
    ],
    { new: true, ...(session ? { session } : {}) }
  );

  if (!updated) return;

  const totalAfter = Number(updated.totalQuantity ?? 0);
  const blockedAfter = Number(updated.blockedQuantity ?? 0);
  await appendWarehouseInventoryLog({
    warehouseInventoryId: updated._id,
    styleCodeId: updated.styleCodeId,
    styleCode: updated.styleCode,
    action: 'picklist_pick',
    message: `PickList pickupQuantity change (${pickListId})`,
    quantityDelta: -deltaPickupQuantity,
    blockedDelta: 0,
    totalQuantityAfter: totalAfter,
    blockedQuantityAfter: blockedAfter,
    availableQuantityAfter: Math.max(0, totalAfter - blockedAfter),
    userId: null,
  });
}

/**
 * Resolve catalogue colour/pattern keyed by styleCode string.
 * @param {string[]} styleCodes
 * @returns {Promise<Map<string, { colour: string; pattern: string }>>}
 */
async function buildArticleAttrsByStyleCodeString(styleCodes) {
  const unique = [...new Set(styleCodes.map((code) => String(code || '').trim()).filter(Boolean))];
  const result = new Map();
  if (!unique.length) return result;

  const docs = await StyleCode.find({ styleCode: { $in: unique } }).select('_id styleCode').lean();
  if (!docs.length) return result;

  const attrsById = await buildArticleAttrsByStyleCodeId(docs.map((doc) => String(doc._id)));
  for (const doc of docs) {
    const attrs = attrsById.get(String(doc._id)) || { colour: '', pattern: '' };
    result.set(doc.styleCode, attrs);
  }
  return result;
}

/**
 * Resolve shade for a pick row from order line colour and catalogue attrs.
 * Multi-pair child rows prefer catalogue colour (stored per individual style code).
 * @param {string|undefined|null} orderLineColour
 * @param {{ colour?: string }} catalogAttrs
 * @param {boolean} preferCatalogue
 * @returns {string}
 */
function resolvePickRowShade(orderLineColour, catalogAttrs, preferCatalogue = false) {
  const lineColour = String(orderLineColour || '').trim();
  const catalogColour = String(catalogAttrs?.colour || '').trim();
  if (preferCatalogue) return catalogColour || lineColour;
  return lineColour || catalogColour;
}

/**
 * Build expected pick-list row payloads from a warehouse order document.
 * Multi-pair child rows use catalogue colour per individual styleCode.
 * @param {import('../../models/whms/warehouseOrder.model.js').default|object} order
 * @returns {Promise<object[]>}
 */
async function buildExpectedPickRowsFromOrder(order) {
  const orderSnapshot = order.toObject ? order.toObject() : { ...order };
  const base = {
    orderId: order._id,
    orderNumber: order.orderNumber,
    addonOrderId: order.addonOrderId,
    orderDetails: orderSnapshot,
  };

  const rows = [];
  const singleItems = Array.isArray(order.styleCodeSinglePair) ? order.styleCodeSinglePair : [];
  const singleAttrsByCode = await buildArticleAttrsByStyleCodeString(
    singleItems.map((item) => item.styleCode).filter(Boolean)
  );

  for (const item of singleItems) {
    const catalogAttrs = singleAttrsByCode.get(item.styleCode) || { colour: '', pattern: '' };
    const preferCatalogue = !String(item.colour || '').trim();
    rows.push({
      ...base,
      size: item.pack || '',
      shade: resolvePickRowShade(item.colour, catalogAttrs, preferCatalogue),
      skuCode: item.styleCode,
      styleCode: item.styleCode,
      styleCodeId: item.styleCodeId || null,
      quantity: item.quantity,
    });
  }

  const multiItems = Array.isArray(order.styleCodeMultiPair) ? order.styleCodeMultiPair : [];
  if (multiItems.length) {
    const pairIds = multiItems.map((item) => item.styleCodeMultiPairId).filter(Boolean);
    const pairs = await StyleCodePairs.find({ _id: { $in: pairIds } })
      .populate('styleCodes', 'styleCode')
      .lean();
    const pairMap = new Map(pairs.map((pair) => [String(pair._id), pair]));

    const childStyleCodes = [];
    for (const pair of pairs) {
      for (const child of pair.styleCodes || []) {
        if (child?.styleCode) childStyleCodes.push(child.styleCode);
      }
    }
    const childAttrsByCode = await buildArticleAttrsByStyleCodeString(childStyleCodes);

    for (const item of multiItems) {
      const pair = pairMap.get(String(item.styleCodeMultiPairId));
      if (!pair) continue;

      const skuCode = pair.pairStyleCode || item.styleCode;
      const childCodes = Array.isArray(pair.styleCodes) ? pair.styleCodes : [];

      if (childCodes.length === 0) {
        const catalogAttrs = childAttrsByCode.get(skuCode) || { colour: '', pattern: '' };
        rows.push({
          ...base,
          size: item.pack || '',
          shade: resolvePickRowShade(item.colour, catalogAttrs, false),
          skuCode,
          styleCode: skuCode,
          styleCodeId: null,
          quantity: item.quantity,
        });
      } else {
        for (const child of childCodes) {
          const catalogAttrs = childAttrsByCode.get(child.styleCode) || { colour: '', pattern: '' };
          rows.push({
            ...base,
            size: item.pack || '',
            shade: resolvePickRowShade(item.colour, catalogAttrs, true),
            skuCode,
            styleCode: child.styleCode,
            styleCodeId: child._id || null,
            quantity: item.quantity,
          });
        }
      }
    }
  }

  return rows;
}

/**
 * Fill missing shade values from product catalogue (per individual styleCode).
 * @param {object[]} groups
 * @returns {Promise<object[]>}
 */
async function enrichPickListGroupsWithCatalogueShades(groups) {
  if (!Array.isArray(groups) || !groups.length) return groups;

  const styleCodesNeedingShade = [];
  for (const group of groups) {
    for (const item of group.items || []) {
      if (!String(item.shade || '').trim() && item.styleCode) {
        styleCodesNeedingShade.push(item.styleCode);
      }
    }
  }
  if (!styleCodesNeedingShade.length) return groups;

  const attrsByCode = await buildArticleAttrsByStyleCodeString(styleCodesNeedingShade);
  return groups.map((group) => ({
    ...group,
    items: (group.items || []).map((item) => {
      const existing = String(item.shade || '').trim();
      if (existing) return item;
      const catalogColour = String(attrsByCode.get(item.styleCode)?.colour || '').trim();
      if (!catalogColour) return item;
      return { ...item, shade: catalogColour };
    }),
  }));
}

/**
 * Auto-create picklist entries when a warehouse order is created.
 *
 * Single-pair items  → 1 picklist row  (skuCode === styleCode)
 * Multi-pair items   → N picklist rows (skuCode = pairStyleCode,
 *                      styleCode = each individual code inside the pair)
 */
export const createPickListForOrder = async (order) => {
  const mergedDocs = mergePickListRowsByKey(await buildExpectedPickRowsFromOrder(order)).map((row) => ({
    ...row,
    pickupQuantity: 0,
  }));
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
  const mergedExpected = mergePickListRowsByKey(await buildExpectedPickRowsFromOrder(order));

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
            styleCodeId: expected.styleCodeId ?? null,
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

/**
 * Set picker name for all pick lines of an order.
 * @param {string} orderId
 * @param {string} pickerName
 */
export const setPickerNameForOrder = async (orderId, pickerName) => {
  const name = String(pickerName || '').trim();
  if (!name) throw new ApiError(httpStatus.BAD_REQUEST, 'pickerName is required');
  await PickList.updateMany({ orderId }, { $set: { pickerName: name } });
  return { orderId, pickerName: name };
};

export const updatePickListById = async (id, updateBody, user = null) => {
  let updatedId = id;

  await runWithOptionalMongoTransaction(async (session) => {
    let docQuery = PickList.findById(id);
    if (session) docQuery = docQuery.session(session);
    const doc = await docQuery;
    if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Pick list entry not found');

    if (updateBody.pickupQuantity !== undefined) {
      await assertPickQtyEditable(doc.orderId, user);
    }

    const prevPickup = Number(doc.pickupQuantity ?? 0);
    Object.assign(doc, updateBody);

    const nextPickup = Number(doc.pickupQuantity ?? 0);
    const delta = nextPickup - prevPickup;

    if (delta !== 0) {
      await applyPickDeltaToInventory({
        session,
        styleCode: doc.styleCode,
        deltaPickupQuantity: delta,
        pickListId: String(doc._id),
      });
    }

    if (doc.pickupQuantity > 0 && doc.pickupQuantity < doc.quantity) {
      doc.status = 'partial';
    } else if (doc.pickupQuantity >= doc.quantity) {
      doc.status = 'picked';
    } else {
      doc.status = 'pending';
    }

    await doc.save(session ? { session } : undefined);
    updatedId = String(doc._id);
  }, 'pickList.update');

  return getPickListById(updatedId);
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
 * Print-ready pick list payload for one order. Kept as an isolated serializer so
 * the physical pick-list format can change without touching pick data logic.
 */
export const buildPickListPrintPayload = async (orderId) => {
  const order = await WarehouseOrder.findById(orderId).populate('clientId');
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');

  const rows = await PickList.find({ orderId }).sort({ styleCode: 1, size: 1 }).lean();
  if (!rows.length) throw new ApiError(httpStatus.NOT_FOUND, 'No pick list exists for this order');

  return {
    order: {
      id: String(order._id),
      orderNumber: order.orderNumber,
      addonOrderId: order.addonOrderId,
      date: order.date,
      clientType: order.clientType,
      clientName: order.clientName,
      flowStatus: order.flowStatus,
      pickerName: rows[0]?.pickerName || '',
    },
    items: rows.map((row, index) => ({
      srNo: index + 1,
      skuCode: row.skuCode,
      styleCode: row.styleCode,
      size: row.size || '',
      shade: row.shade || '',
      quantity: row.quantity,
      pickupQuantity: row.pickupQuantity ?? 0,
      status: row.status,
    })),
    totals: {
      totalItems: rows.length,
      totalQuantity: rows.reduce((s, r) => s + Number(r.quantity || 0), 0),
      totalPickupQuantity: rows.reduce((s, r) => s + Number(r.pickupQuantity || 0), 0),
    },
    generatedAt: new Date(),
  };
};

/**
 * Shortage/excess report per pick row for the Barcode Team screen.
 * variance = pickupQuantity - quantity (negative → short, positive → excess).
 */
export const buildPickListVariance = async (orderId) => {
  const order = await WarehouseOrder.findById(orderId).select('orderNumber flowStatus clientName');
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');

  const rows = await PickList.find({ orderId }).sort({ styleCode: 1, size: 1 }).lean();
  const items = rows.map((row) => {
    const quantity = Number(row.quantity || 0);
    const pickupQuantity = Number(row.pickupQuantity || 0);
    const variance = pickupQuantity - quantity;
    return {
      id: String(row._id),
      skuCode: row.skuCode,
      styleCode: row.styleCode,
      size: row.size || '',
      shade: row.shade || '',
      quantity,
      pickupQuantity,
      variance,
      varianceType: variance === 0 ? 'ok' : variance < 0 ? 'short' : 'excess',
      status: row.status,
    };
  });

  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    clientName: order.clientName,
    flowStatus: order.flowStatus,
    items,
    summary: {
      totalItems: items.length,
      okCount: items.filter((i) => i.varianceType === 'ok').length,
      shortCount: items.filter((i) => i.varianceType === 'short').length,
      excessCount: items.filter((i) => i.varianceType === 'excess').length,
      totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
      totalPickupQuantity: items.reduce((s, i) => s + i.pickupQuantity, 0),
    },
  };
};

/**
 * Barcode label payload for the Barcode Team: one row per pick line with the
 * actually-picked quantity (labels to print). Barcode content = styleCode.
 */
export const buildBarcodeLabelsPayload = async (orderId) => {
  const order = await WarehouseOrder.findById(orderId).select('orderNumber addonOrderId clientName flowStatus');
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');

  const rows = await PickList.find({ orderId }).sort({ styleCode: 1, size: 1 }).lean();
  const labels = rows
    .filter((row) => Number(row.pickupQuantity || 0) > 0)
    .map((row) => ({
      pickListId: String(row._id),
      barcode: row.styleCode,
      skuCode: row.skuCode,
      styleCode: row.styleCode,
      size: row.size || '',
      shade: row.shade || '',
      quantity: Number(row.pickupQuantity || 0),
    }));

  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    clientName: order.clientName,
    flowStatus: order.flowStatus,
    labels,
    totalLabels: labels.reduce((s, l) => s + l.quantity, 0),
  };
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
 * Mongo $lookup stage: join warehouse inventory by styleCodeId, fallback to case-insensitive styleCode.
 * @returns {object}
 */
const stockLookupStage = () => ({
  $lookup: {
    from: 'stocks',
    let: { scId: '$styleCodeId', sc: '$styleCode' },
    pipeline: [
      {
        $match: {
          $expr: {
            $cond: {
              if: { $ne: ['$$scId', null] },
              then: { $eq: ['$styleCodeId', '$$scId'] },
              else: {
                $eq: [
                  { $toLower: { $ifNull: ['$styleCode', ''] } },
                  { $toLower: { $ifNull: ['$$sc', ''] } },
                ],
              },
            },
          },
        },
      },
      { $limit: 1 },
    ],
    as: 'inv',
  },
});

/**
 * Return pick-list data grouped by order with pagination & summary counts.
 */
export const queryPickListsGroupedByOrder = async (filter, options) => {
  const page = Number(options.page) || 1;
  const limit = Number(options.limit) || 10;
  const skip = (page - 1) * limit;

  const basePipeline = [
    { $match: filter },
    // Attach live stock (WarehouseInventory) by styleCodeId, fallback to styleCode string.
    stockLookupStage(),
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
        pickerName: { $first: '$pickerName' },
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
  const rawResults = await enrichPickListGroupsWithCatalogueShades(await PickList.aggregate(resultsPipeline));
  const results = rawResults.map((group) => {
    const order = group.order && typeof group.order === 'object' ? group.order : {};
    const flowStatus = order.flowStatus || flowStatusForCoarseStatus(order.status);
    return {
      ...group,
      flowStatus,
      order: { ...order, flowStatus },
    };
  });

  return {
    results,
    summary: summary || { total: 0, pending: 0, partial: 0, picked: 0 },
    page,
    limit,
    totalPages: Math.ceil(totalResults / limit),
    totalResults,
  };
};
