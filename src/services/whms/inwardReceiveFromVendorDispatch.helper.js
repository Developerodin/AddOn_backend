import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import Product from '../../models/product.model.js';
import VendorPurchaseOrder from '../../models/vendorManagement/vendorPurchaseOrder.model.js';
import ContainersMaster from '../../models/production/containersMaster.model.js';
import { VendorProductionFlow } from '../../models/index.js';
import InwardReceive, {
  InwardReceiveStatus,
  InwardReceiveSource,
} from '../../models/whms/inwardReceive.model.js';

/**
 * After vendor dispatch container accept, one InwardReceive per new `dispatch.receivedData` line.
 * Mirrors {@link ./inwardReceiveFromWarehouse.helper.js} for production warehouse receive.
 *
 * @param {import('mongoose').Document} flow - VendorProductionFlow (saved; subdocs have _id)
 * @param {Array<Record<string, unknown>>} newLines - Newly pushed dispatch.receivedData subdocs
 * @param {import('mongoose').Types.ObjectId|null|undefined} containerId
 */
export async function createInwardReceivesForVendorDispatchAccept(flow, newLines, containerId) {
  if (!newLines?.length || !flow?._id) return;

  if (!flow.product) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Vendor production flow must have product linked before dispatch receive (required for WHMS inward / factory code).'
    );
  }

  const productLean = await Product.findById(flow.product).select('factoryCode name _id').lean();
  const articleNumber = String(productLean?.factoryCode || '').trim();
  if (!articleNumber) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Product ${flow.product} has no factoryCode; cannot create WHMS inward lines.`
    );
  }

  let poSnapshot = null;
  if (flow.vendorPurchaseOrder) {
    try {
      poSnapshot = await VendorPurchaseOrder.findById(flow.vendorPurchaseOrder)
        .select('vpoNumber currentStatus vendorName total vendor')
        .lean();
    } catch {
      // non-blocking
    }
  }

  for (const line of newLines) {
    const lineId = line._id;
    if (lineId) {
      const exists = await InwardReceive.exists({ vendorDispatchReceivedLineId: lineId });
      if (exists) continue;
    }

    const qty = Number(line.transferred) || 0;
    if (qty <= 0) continue;

    await InwardReceive.create({
      inwardSource: InwardReceiveSource.VENDOR,
      articleId: null,
      orderId: null,
      vendorProductionFlowId: flow._id,
      vendorPurchaseOrderId: flow.vendorPurchaseOrder || null,
      articleNumber,
      QuantityFromFactory: qty,
      receivedQuantity: 0,
      styleCode: line.styleCode || '',
      brand: line.brand || '',
      status: InwardReceiveStatus.PENDING,
      orderData: {
        vendorProductionFlow: {
          _id: flow._id,
          referenceCode: flow.referenceCode,
          plannedQuantity: flow.plannedQuantity,
        },
        vendorPurchaseOrder: poSnapshot,
        product: productLean
          ? { _id: productLean._id, factoryCode: productLean.factoryCode, name: productLean.name }
          : undefined,
        containerId: containerId ? String(containerId) : undefined,
      },
      receivedAt: line.receivedTimestamp || new Date(),
      receivedInContainerId: containerId || line.receivedInContainerId || null,
      vendorDispatchReceivedLineId: lineId || null,
    });
  }
}

/**
 * WHMS step: create {@link InwardReceive} rows from existing `dispatch.receivedData` lines.
 * Vendor dispatch container accept / confirm only updates the flow — they do **not** create inward rows.
 *
 * @param {string} flowId
 * @param {{ containerBarcode?: string }} [options] — if set, only lines whose `receivedInContainerId` matches this container (warehouse scan).
 * @returns {Promise<{ createdOrSkipped: number, linesMatched: number }>}
 */
export async function promoteVendorDispatchToInwardReceive(flowId, options = {}) {
  const raw = options.containerBarcode != null ? String(options.containerBarcode).trim() : '';
  let containerId = null;
  if (raw) {
    let doc = await ContainersMaster.findOne({ barcode: raw });
    if (!doc && /^[0-9a-fA-F]{24}$/.test(raw)) {
      doc = await ContainersMaster.findById(raw);
    }
    if (!doc) {
      throw new ApiError(httpStatus.NOT_FOUND, `Container not found for barcode/id "${raw}"`);
    }
    containerId = doc._id;
  }

  const flow = await VendorProductionFlow.findById(flowId);
  if (!flow) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
  }

  let lines = flow.floorQuantities?.dispatch?.receivedData || [];
  if (containerId) {
    const matching = lines.filter((l) => {
      const rid = l.receivedInContainerId;
      if (!rid) return false;
      return String(rid) === String(containerId);
    });
    const whTagged = matching.filter((l) =>
      String(l.receivedStatusFromPreviousFloor || '').startsWith('warehouse:')
    );
    /** Prefer dispatch→WHMS handoff lines when present; otherwise legacy `Completed` dispatch scans. */
    lines = whTagged.length > 0 ? whTagged : matching;
  }

  if (!lines.length) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      containerId
        ? 'No dispatch lines for this container. Complete vendor dispatch scan first, or use promote without barcode for confirm-only lines.'
        : 'No dispatch receivedData lines to promote.'
    );
  }

  const before = await InwardReceive.countDocuments({
    vendorProductionFlowId: flow._id,
    inwardSource: InwardReceiveSource.VENDOR,
  });

  await createInwardReceivesForVendorDispatchAccept(flow, lines, containerId);

  const after = await InwardReceive.countDocuments({
    vendorProductionFlowId: flow._id,
    inwardSource: InwardReceiveSource.VENDOR,
  });

  return { createdOrSkipped: after - before, linesMatched: lines.length };
}
