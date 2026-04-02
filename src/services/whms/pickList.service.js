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
  const base = { orderId: order._id, orderNumber: order.orderNumber };

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

  if (docs.length) {
    await PickList.insertMany(docs);
  }

  return docs.length;
};

export const buildPickListFilter = (query) => {
  const filter = {};

  if (query.orderId) filter.orderId = query.orderId;
  if (query.orderNumber && String(query.orderNumber).trim()) {
    filter.orderNumber = new RegExp(`^${escapeRegex(String(query.orderNumber).trim())}`, 'i');
  }
  if (query.skuCode) filter.skuCode = new RegExp(`^${escapeRegex(String(query.skuCode).trim())}`, 'i');
  if (query.styleCode) filter.styleCode = new RegExp(`^${escapeRegex(String(query.styleCode).trim())}`, 'i');
  if (query.status) filter.status = query.status;

  if (query.q && String(query.q).trim()) {
    const term = escapeRegex(String(query.q).trim());
    const regex = new RegExp(term, 'i');
    filter.$or = [{ orderNumber: regex }, { skuCode: regex }, { styleCode: regex }];
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
