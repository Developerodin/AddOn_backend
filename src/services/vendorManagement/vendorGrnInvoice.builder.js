/**
 * Invoice-level vendor GRN snapshot merge (VPO + lot grouping).
 * Kept separate from vendorGrn.service.js so that file stays under 500 lines.
 */

import {
  VendorGrn,
  VendorProductionFlow,
  VendorPurchaseOrder,
  VendorBox,
} from '../../models/index.js';
import { buildSnapshotFromFlow } from './vendorGrnSnapshot.builder.js';
import { isScReadyForGrn } from './vendorGrnScComplete.util.js';

/**
 * Find active GRN for a VPO + invoice/lot number (grouping key).
 * @param {string|import('mongoose').Types.ObjectId} vpoId
 * @param {string} lotNumber
 */
export const findActiveGrnForInvoice = async (vpoId, lotNumber) => {
  const lot = String(lotNumber || '').trim();
  if (!vpoId || !lot) return null;
  return VendorGrn.findOne({
    status: 'active',
    vendorPurchaseOrder: vpoId,
    'lots.lotNumber': lot,
  })
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Merge per-flow lot snapshots into one invoice-level GRN snapshot.
 * @param {Array<{ lots: Array<Object>, totals: Object }>} snapshots
 * @returns {{ lots: Array<Object>, totals: Object }}
 */
export const mergeInvoiceSnapshots = (snapshots) => {
  const lotMap = new Map();
  const totals = { expected: 0, verified: 0, variance: 0, m1: 0, m2: 0, m3: 0, m4: 0 };

  snapshots.forEach((snap) => {
    (snap.lots || []).forEach((lot) => {
      const key = String(lot.lotNumber || '').trim();
      if (!key) return;
      const existing = lotMap.get(key);
      if (!existing) {
        lotMap.set(key, {
          lotNumber: key,
          numberOfBoxes: Number(lot.numberOfBoxes) || 0,
          totalUnits: Number(lot.totalUnits) || 0,
          items: [...(lot.items || [])],
        });
        return;
      }
      existing.numberOfBoxes = Math.max(existing.numberOfBoxes, Number(lot.numberOfBoxes) || 0);
      existing.totalUnits += Number(lot.totalUnits) || 0;
      (lot.items || []).forEach((item) => {
        const flowId = String(item.vendorProductionFlowId || '');
        const idx = existing.items.findIndex(
          (it) => String(it.vendorProductionFlowId || '') === flowId
        );
        if (idx >= 0) existing.items[idx] = item;
        else existing.items.push(item);
      });
    });
    totals.expected += Number(snap.totals?.expected) || 0;
    totals.verified += Number(snap.totals?.verified) || 0;
    totals.variance += Number(snap.totals?.variance) || 0;
    totals.m1 += Number(snap.totals?.m1) || 0;
    totals.m2 += Number(snap.totals?.m2) || 0;
    totals.m3 += Number(snap.totals?.m3) || 0;
    totals.m4 += Number(snap.totals?.m4) || 0;
  });

  return { lots: [...lotMap.values()], totals };
};

/**
 * Build merged GRN snapshot for all classified flows sharing an invoice on a VPO.
 * @param {string|import('mongoose').Types.ObjectId} vpoId
 * @param {string} lotNumber
 */
export const buildInvoiceGrnSnapshot = async (vpoId, lotNumber) => {
  const lot = String(lotNumber || '').trim();
  if (!vpoId || !lot) return null;

  const vpo = await VendorPurchaseOrder.findById(vpoId).lean();
  if (!vpo) return null;

  const boxes = await VendorBox.find({
    vendorPurchaseOrderId: vpoId,
    lotNumber: lot,
    secondaryCheckingAccepted: true,
  }).lean();

  const productIds = [...new Set(boxes.map((b) => String(b.productId)).filter(Boolean))];
  const flowQuery = productIds.length
    ? {
        vendorPurchaseOrder: vpoId,
        $or: [
          { product: { $in: productIds } },
          { 'floorQuantities.secondaryChecking.receivedData.lotNumber': lot },
        ],
      }
    : {
        vendorPurchaseOrder: vpoId,
        'floorQuantities.secondaryChecking.receivedData.lotNumber': lot,
      };

  const flows = await VendorProductionFlow.find(flowQuery)
    .populate({ path: 'product', select: 'name vendorCode' })
    .lean();

  const snapshots = [];
  for (const flow of flows) {
    const sc = flow.floorQuantities?.secondaryChecking || {};
    const classified =
      Number(sc.m1Quantity || 0) +
      Number(sc.m2Quantity || 0) +
      Number(sc.m3Quantity || 0) +
      Number(sc.vm4Quantity ?? sc.m4Quantity ?? 0);
    if (classified <= 0) continue;

    const flowProductId = String(flow.product?._id || flow.product || '');
    const flowBoxes = boxes.filter((b) => String(b.productId) === flowProductId);
    const snap = buildSnapshotFromFlow({
      flow,
      vpo,
      boxes: flowBoxes,
      lotNumberFilter: lot,
    });
    if ((snap.lots || []).length > 0 && (snap.totals?.verified || 0) > 0) {
      snapshots.push(snap);
    }
  }

  if (snapshots.length === 0) return null;
  return mergeInvoiceSnapshots(snapshots);
};

/**
 * Whether every flow with scan-accepted boxes on this invoice is SC-complete.
 * @param {string|import('mongoose').Types.ObjectId} vpoId
 * @param {string} lotNumber
 */
export const evaluateInvoiceGrnCompleteness = async (vpoId, lotNumber) => {
  const lot = String(lotNumber || '').trim();
  if (!vpoId || !lot) return { incomplete: true };

  const boxes = await VendorBox.find({
    vendorPurchaseOrderId: vpoId,
    lotNumber: lot,
    secondaryCheckingAccepted: true,
  })
    .select('productId')
    .lean();

  const productIds = [...new Set(boxes.map((b) => b.productId).filter(Boolean))];
  if (productIds.length === 0) return { incomplete: true };

  const flows = await VendorProductionFlow.find({
    vendorPurchaseOrder: vpoId,
    product: { $in: productIds },
  })
    .select('floorQuantities.secondaryChecking')
    .lean();

  const incomplete = flows.some((flow) => !isScReadyForGrn(flow.floorQuantities?.secondaryChecking));
  return { incomplete };
};
