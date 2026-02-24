import { WhmsOrder, FactoryRequirement } from '../../models/whms/index.js';
import Product from '../../models/product.model.js';
import { resolveProductBySku } from './productResolution.service.js';

/**
 * Compute gap report: stock vs orders shortage by style/SKU.
 * Uses orders aggregation; currentStock can be from inventory service when available.
 * @param {Object} params - { warehouse, date, styleCode }
 * @returns {Promise<Array<{ styleCode, itemName, currentStock, ordersQty, requiredQty, shortage, factoryDispatchDate }>>}
 */
export const getGapReport = async (params = {}) => {
  const { styleCode } = params;
  const match = {};
  if (styleCode) match['items.sku'] = styleCode;

  const ordersQtyBySku = await WhmsOrder.aggregate([
    { $match: { status: { $nin: ['dispatched', 'cancelled'] } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.sku', ordersQty: { $sum: '$items.quantity' } } },
  ]);

  const skuToOrdersQty = Object.fromEntries(ordersQtyBySku.map((r) => [r._id, r.ordersQty]));
  const skus = [...new Set(ordersQtyBySku.map((r) => r._id))].filter(Boolean);
  if (styleCode) {
    if (!skus.includes(styleCode)) return [];
  }

  const products = await Product.find(
    skus.length ? { $or: [{ softwareCode: { $in: skus } }, { internalCode: { $in: skus } }] } : {}
  ).select('name softwareCode internalCode');

  const rows = [];
  for (const p of products) {
    const code = p.softwareCode || p.internalCode;
    const ordersQty = skuToOrdersQty[code] || 0;
    const currentStock = 0; // TODO: plug in inventory/stock when available
    const requiredQty = ordersQty;
    const shortage = Math.max(0, requiredQty - currentStock);
    rows.push({
      styleCode: code,
      itemName: p.name,
      currentStock,
      ordersQty,
      requiredQty,
      shortage,
      factoryDispatchDate: null,
    });
  }
  return rows;
};

export const sendRequirementToFactory = async (body, user) => {
  const items = Array.isArray(body) ? body : [body];
  const created = await FactoryRequirement.insertMany(
    items.map((i) => ({
      styleCode: i.styleCode,
      itemName: i.itemName,
      shortage: i.shortage,
      requestedQty: i.requestedQty ?? i.shortage,
      sentBy: user?.email || user?.username || 'system',
    }))
  );
  return created;
};
