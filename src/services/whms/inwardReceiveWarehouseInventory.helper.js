import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import Product from '../../models/product.model.js';
import StyleCode from '../../models/styleCode.model.js';
import WarehouseInventory from '../../models/whms/warehouseInventory.model.js';
import { InwardReceiveStatus } from '../../models/whms/inwardReceive.model.js';
import { appendWarehouseInventoryLog } from './warehouseInventory.service.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How much of `receivedQuantity` has already been posted to WarehouseInventory for this line.
 * When status is accepted, target credited = receivedQuantity; otherwise 0 (reversals on reject).
 *
 * @param {Record<string, unknown>} previous - Snapshot before PATCH (or empty for new docs).
 * @param {Record<string, unknown>} merged - Current inward receive plain object after merge.
 * @returns {Promise<{ warehouseInventoryCreditedQty: number }>}
 */
export async function reconcileInwardReceiveWarehouseInventory(previous, merged) {
  const preCredited = Math.max(0, Number(previous?.warehouseInventoryCreditedQty) || 0);
  const targetCredited =
    merged.status === InwardReceiveStatus.ACCEPTED
      ? Math.max(0, Number(merged.receivedQuantity) || 0)
      : 0;
  const delta = targetCredited - preCredited;

  if (delta === 0) {
    return { warehouseInventoryCreditedQty: targetCredited };
  }

  const styleTrim = String(merged.styleCode || '').trim();
  if (!styleTrim) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'styleCode is required to post accepted quantity to warehouse inventory');
  }

  const articleNumber = String(merged.articleNumber || '').trim();
  if (!articleNumber) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'articleNumber missing on inward receive');
  }

  const product = await Product.findOne({
    factoryCode: new RegExp(`^${escapeRegex(articleNumber)}$`, 'i'),
  }).lean();

  if (!product?._id) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Product not found for factoryCode "${articleNumber}"; cannot update warehouse inventory`
    );
  }

  const styleCodeDoc = await StyleCode.findOne({
    styleCode: new RegExp(`^${escapeRegex(styleTrim)}$`, 'i'),
  }).lean();

  if (!styleCodeDoc?._id) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Style code "${styleTrim}" is not registered; add it in Style Code master before accepting`
    );
  }

  const canonicalStyle = styleCodeDoc.styleCode;
  const inwardId = merged._id;

  await applyWarehouseInventoryDelta({
    itemId: product._id,
    styleCodeId: styleCodeDoc._id,
    styleCodeString: canonicalStyle,
    itemData: {
      factoryCode: product.factoryCode,
      name: product.name,
      productId: String(product._id),
    },
    styleCodeData: {
      styleCode: styleCodeDoc.styleCode,
      eanCode: styleCodeDoc.eanCode,
      mrp: styleCodeDoc.mrp,
      brand: styleCodeDoc.brand,
      pack: styleCodeDoc.pack,
    },
    delta,
    inwardReceiveId: inwardId,
  });

  return { warehouseInventoryCreditedQty: targetCredited };
}

/**
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId} params.itemId
 * @param {import('mongoose').Types.ObjectId} params.styleCodeId
 * @param {string} params.styleCodeString
 * @param {Record<string, unknown>} [params.itemData]
 * @param {Record<string, unknown>} [params.styleCodeData]
 * @param {number} params.delta — positive = add accepted qty, negative = reverse
 * @param {import('mongoose').Types.ObjectId} [params.inwardReceiveId]
 */
async function applyWarehouseInventoryDelta({
  itemId,
  styleCodeId,
  styleCodeString,
  itemData,
  styleCodeData,
  delta,
  inwardReceiveId,
}) {
  let inv = await WarehouseInventory.findOne({ styleCodeId });

  if (!inv) {
    if (delta < 0) {
      return;
    }
    inv = new WarehouseInventory({
      itemId,
      styleCodeId,
      styleCode: styleCodeString,
      itemData,
      styleCodeData,
      totalQuantity: 0,
      blockedQuantity: 0,
      availableQuantity: 0,
    });
  }

  const nextTotal = Math.max(0, (inv.totalQuantity ?? 0) + delta);
  let nextBlocked = inv.blockedQuantity ?? 0;
  if (nextBlocked > nextTotal) {
    nextBlocked = nextTotal;
  }

  inv.totalQuantity = nextTotal;
  inv.blockedQuantity = nextBlocked;
  inv.itemId = itemId;
  inv.styleCode = styleCodeString;
  if (itemData !== undefined) inv.itemData = itemData;
  if (styleCodeData !== undefined) inv.styleCodeData = styleCodeData;

  await inv.save();

  await appendWarehouseInventoryLog({
    warehouseInventoryId: inv._id,
    styleCodeId: inv.styleCodeId,
    styleCode: inv.styleCode,
    action: delta >= 0 ? 'inward_accept' : 'inward_reverse',
    message: `Inward receive ${delta >= 0 ? '+' : ''}${delta} (accepted qty)`,
    quantityDelta: delta,
    totalQuantityAfter: nextTotal,
    blockedQuantityAfter: nextBlocked,
    availableQuantityAfter: Math.max(0, nextTotal - nextBlocked),
    meta: inwardReceiveId ? { inwardReceiveId: String(inwardReceiveId) } : undefined,
  });
}
