import { WarehouseOrder } from '../../models/whms/index.js';

/**
 * Next warehouse order number `WO-YYYY-#####` from the latest created order.
 * @returns {Promise<string>}
 */
export const generateWarehouseOrderNumber = async () => {
  const last = await WarehouseOrder.findOne().sort({ createdAt: -1 }).select('orderNumber');
  const match = String(last?.orderNumber || '').match(/^WO-\d{4}-(\d+)$/);
  const seq = match ? parseInt(match[1], 10) + 1 : 1;
  return `WO-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
};
