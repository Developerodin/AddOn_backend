import { ProductionOrder } from '../../models/production/index.js';
import InwardReceive, { InwardReceiveStatus, InwardReceiveSource } from '../../models/whms/inwardReceive.model.js';

/**
 * After warehouse container accept, one InwardReceive per new `warehouse.receivedData` line.
 * QuantityFromFactory = line.transferred (qty from container / factory side); receivedQuantity starts 0 for WHMS confirmation.
 *
 * @param {import('mongoose').Document} article - Article mongoose doc (saved, with subdoc ids)
 * @param {Array<Record<string, unknown>>} newLines - Newly pushed receivedData subdocs
 * @param {import('mongoose').Types.ObjectId|null|undefined} containerId
 */
export async function createInwardReceivesForWarehouseAccept(article, newLines, containerId) {
  if (!newLines?.length || !article?._id) return;

  let orderSnapshot = null;
  try {
    orderSnapshot = await ProductionOrder.findById(article.orderId)
      .select('orderNumber status priority currentFloor plannedQuantity')
      .lean();
  } catch {
    // non-blocking
  }

  for (const line of newLines) {
    const lineId = line._id;
    if (lineId) {
      const exists = await InwardReceive.exists({ warehouseReceivedLineId: lineId });
      if (exists) continue;
    }

    const qty = Number(line.transferred) || 0;
    if (qty <= 0) continue;

    await InwardReceive.create({
      inwardSource: InwardReceiveSource.PRODUCTION,
      articleId: article._id,
      orderId: article.orderId,
      articleNumber: article.articleNumber || '',
      QuantityFromFactory: qty,
      receivedQuantity: 0,
      styleCode: line.styleCode || '',
      brand: line.brand || '',
      status: InwardReceiveStatus.PENDING,
      orderData: {
        productionOrder: orderSnapshot,
        containerId: containerId ? String(containerId) : undefined,
      },
      receivedAt: line.receivedTimestamp || new Date(),
      receivedInContainerId: containerId || line.receivedInContainerId || null,
      warehouseReceivedLineId: lineId || null,
    });
  }
}
