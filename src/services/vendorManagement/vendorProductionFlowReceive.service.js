import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { VendorProductionFlow } from '../../models/index.js';
import ContainersMaster from '../../models/production/containersMaster.model.js';
import { ContainerStatus } from '../../models/production/enums.js';
import ApiError from '../../utils/ApiError.js';
import { computeDerivedForFloor, pickFloorSnapshot } from './vendorProductionFlowFloorPatch.js';
import { aggregateTransferredByStyleKey } from '../../utils/vendorStyleQuantity.util.js';

/** `activeFloor` on ContainersMaster for vendor receive scans (must match accept mapping below). */
export const vendorFloorKeyToContainerActiveFloor = (floorKey) => {
  const map = {
    secondaryChecking: 'Secondary Checking',
    branding: 'Branding',
    finalChecking: 'Final Checking',
    dispatch: 'Dispatch',
  };
  return map[floorKey] || floorKey;
};

const FLOOR_NAME_TO_KEY = {
  'Secondary Checking': 'secondaryChecking',
  'Branding': 'branding',
  'Final Checking': 'finalChecking',
  'Dispatch': 'dispatch',
};

/**
 * Cumulative FC receive per style cannot exceed what branding sent (sum of branding.transferredData per key).
 * Supports incremental containers: first scan +10, second +20 for same style → cap 30 from branding.
 */
function assertVendorFcReceiveWithinBrandingCap(flow, incomingRows) {
  const branding = flow.floorQuantities?.branding || {};
  const brandingTotal = Number(branding.transferred || 0);
  const brandingByStyle = aggregateTransferredByStyleKey(branding.transferredData);

  const fc = flow.floorQuantities?.finalChecking || {};
  const fcExisting = aggregateTransferredByStyleKey(fc.receivedData);
  const incomingMap = aggregateTransferredByStyleKey(incomingRows);
  const incomingTotal = [...incomingMap.values()].reduce((a, b) => a + b, 0);
  if (incomingTotal <= 0) return;

  if (brandingTotal <= 0 && brandingByStyle.size === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot receive at final checking: branding has not recorded an outbound transfer for this flow.'
    );
  }

  if (brandingByStyle.size > 0) {
    for (const [k, inc] of incomingMap) {
      if (inc <= 0) continue;
      const cap = brandingByStyle.get(k);
      if (cap === undefined) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Style/brand key "${k}" is not present in branding outbound lines. Each container line must match a styleCode/brand that branding already sent.`
        );
      }
      const after = (fcExisting.get(k) || 0) + inc;
      if (after > cap + 1e-6) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `For "${k}": final checking would receive ${after} cumulative but branding only sent ${cap}. Second+ containers must carry only **new** units for that style (e.g. 10 then 20 more, not 30 as a repeat of the first 10).`
        );
      }
    }
    return;
  }

  const fcAfter = Number(fc.received || 0) + incomingTotal;
  if (fcAfter > brandingTotal + 1e-6) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Final checking total receive would be ${fcAfter} but branding only sent ${brandingTotal} in total.`
    );
  }
}

function resolveVendorFloorKey(floor) {
  const s = String(floor || '').trim();
  if (['secondaryChecking', 'branding', 'finalChecking', 'dispatch'].includes(s)) return s;
  if (FLOOR_NAME_TO_KEY[s]) return FLOOR_NAME_TO_KEY[s];
  const lower = s.replace(/\s+/g, '').toLowerCase();
  if (lower === 'secondarychecking') return 'secondaryChecking';
  if (lower === 'branding') return 'branding';
  if (lower === 'finalchecking') return 'finalChecking';
  if (lower === 'dispatch') return 'dispatch';
  return null;
}

/**
 * Apply container accept: increment `received` on the vendor flow floor and append `receivedData`.
 * Mirrors production `updateArticleFloorReceivedData` for vendor documents.
 *
 * @param {string} flowId
 * @param {{ floor: string, quantity?: number, receivedData?: object, receivedTransferItems?: Array<{ transferred: number, styleCode?: string, brand?: string }> }} payload
 */
export const updateVendorProductionFlowFloorReceivedData = async (flowId, payload) => {
  const flow = await VendorProductionFlow.findById(flowId);
  if (!flow) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
  }

  const floorKey = resolveVendorFloorKey(payload.floor);

  if (!floorKey || !flow.floorQuantities?.[floorKey]) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Invalid floor for vendor flow: "${payload.floor}". Expected Branding, Final Checking, Secondary Checking, or Dispatch.`
    );
  }

  const floorData = flow.floorQuantities[floorKey];
  if (!Array.isArray(floorData.receivedData)) {
    floorData.receivedData = [];
  }

  const receivedDataLengthBefore = floorData.receivedData.length;

  let receivedTransferItems = payload.receivedTransferItems;
  let quantity =
    payload.quantity !== undefined && payload.quantity !== null ? Number(payload.quantity) : undefined;
  if (quantity !== undefined && Number.isNaN(quantity)) {
    quantity = undefined;
  }

  const containerTransferItems =
    Array.isArray(payload.containerTransferItems) && payload.containerTransferItems.length > 0
      ? payload.containerTransferItems
      : null;

  if (containerTransferItems && (floorKey === 'finalChecking' || floorKey === 'dispatch')) {
    receivedTransferItems = containerTransferItems;
  }

  if (
    (!receivedTransferItems || receivedTransferItems.length === 0) &&
    typeof quantity === 'number' &&
    quantity > 0 &&
    floorKey === 'finalChecking'
  ) {
    const branding = flow.floorQuantities?.branding;
    const prevTransferredData = branding?.transferredData;
    if (Array.isArray(prevTransferredData) && prevTransferredData.length > 0) {
      const totalAvailable = prevTransferredData.reduce((s, i) => s + (i.transferred || 0), 0);
      if (totalAvailable >= quantity) {
        let remaining = quantity;
        const items = [];
        for (const i of prevTransferredData) {
          if (remaining <= 0) break;
          const take = Math.min(i.transferred || 0, remaining);
          if (take > 0) {
            items.push({ transferred: take, styleCode: i.styleCode || '', brand: i.brand || '' });
            remaining -= take;
          }
        }
        if (items.length > 0 && items.reduce((s, x) => s + x.transferred, 0) === quantity) {
          receivedTransferItems = items;
        }
      }
    }
  }

  if (floorKey === 'finalChecking') {
    const capLines =
      Array.isArray(receivedTransferItems) && receivedTransferItems.length > 0
        ? receivedTransferItems.map((item) => ({
            transferred: Number(item.transferred || 0),
            styleCode: item.styleCode || '',
            brand: item.brand || '',
          }))
        : typeof quantity === 'number' && quantity > 0
          ? [{ transferred: quantity, styleCode: '', brand: '' }]
          : [];
    const capSum = capLines.reduce((s, x) => s + Math.max(0, x.transferred), 0);
    if (capSum > 0) {
      assertVendorFcReceiveWithinBrandingCap(flow, capLines);
    }
  }

  if (Array.isArray(receivedTransferItems) && receivedTransferItems.length > 0) {
    quantity = receivedTransferItems.reduce((sum, item) => sum + (item.transferred || 0), 0);
    const rd = payload.receivedData || {};
    receivedTransferItems.forEach((item) => {
      floorData.receivedData.push({
        receivedStatusFromPreviousFloor: rd.receivedStatusFromPreviousFloor != null ? rd.receivedStatusFromPreviousFloor : '',
        receivedInContainerId: rd.receivedInContainerId || null,
        receivedTimestamp: rd.receivedTimestamp ? new Date(rd.receivedTimestamp) : new Date(),
        transferred: item.transferred,
        styleCode: item.styleCode || '',
        brand: item.brand || '',
      });
    });
  } else {
    const rd = payload.receivedData || {};
    floorData.receivedData.push({
      receivedStatusFromPreviousFloor: rd.receivedStatusFromPreviousFloor != null ? rd.receivedStatusFromPreviousFloor : '',
      receivedInContainerId: rd.receivedInContainerId || null,
      receivedTimestamp: rd.receivedTimestamp ? new Date(rd.receivedTimestamp) : null,
      transferred: quantity || 0,
      styleCode: rd.styleCode || '',
      brand: rd.brand || '',
    });
  }

  if (typeof quantity === 'number' && quantity > 0) {
    floorData.received = (floorData.received || 0) + quantity;
    if (floorData.completed > floorData.received) {
      floorData.completed = floorData.received;
    }
    flow.currentFloorKey = floorKey;
    flow.markModified('currentFloorKey');
  }

  flow.floorQuantities[floorKey] = floorData;
  const snap = { ...pickFloorSnapshot(flow, floorKey) };
  const derived = computeDerivedForFloor(floorKey, snap);
  Object.assign(floorData, derived);
  flow.markModified(`floorQuantities.${floorKey}`);
  await flow.save();

  return { flow, receivedDataNewLines: floorData.receivedData.slice(receivedDataLengthBefore) };
};

/**
 * Stage a vendor transfer on an **existing** container (barcode). Sets `activeFloor` to the receiving
 * floor and appends one `activeItems` row. Destination floor `received` updates on accept scan.
 *
 * @param {Object} opts
 * @param {string} opts.barcode - Existing container barcode / id string
 * @param {string} opts.flowId
 * @param {number} opts.quantity
 * @param {string} opts.toFloorKey - `branding` | `finalChecking` | `dispatch`
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} [opts.transferItems]
 * @param {import('mongoose').ClientSession} [opts.session]
 * @returns {Promise<import('mongoose').Document>}
 */
export const stageVendorTransferOnExistingContainer = async ({
  barcode,
  flowId,
  quantity,
  toFloorKey,
  transferItems,
  session,
}) => {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid quantity for vendor container');
  }
  if (!['branding', 'finalChecking', 'dispatch'].includes(toFloorKey)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor staging is only used for Branding, Final Checking, or Dispatch');
  }

  const trimmed = String(barcode || '').trim();
  if (!trimmed) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'existingContainerBarcode is required');
  }

  let doc = await ContainersMaster.findOne({ barcode: trimmed });
  if (!doc && /^[0-9a-fA-F]{24}$/.test(trimmed)) {
    doc = await ContainersMaster.findById(trimmed);
  }
  if (!doc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Container not found for this barcode');
  }
  if (doc.status !== ContainerStatus.ACTIVE) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Container must be Active to stage a vendor transfer');
  }

  const activeFloor = vendorFloorKeyToContainerActiveFloor(toFloorKey);
  const item = {
    vendorProductionFlow: new mongoose.Types.ObjectId(flowId),
    quantity: qty,
  };
  if (Array.isArray(transferItems) && transferItems.length > 0) {
    item.transferItems = transferItems.map((t) => ({
      transferred: Math.max(0, Number(t.transferred || 0)),
      styleCode: String(t.styleCode || ''),
      brand: String(t.brand || ''),
    }));
  }

  if (!doc.activeItems) doc.activeItems = [];
  doc.activeItems.push(item);
  doc.activeFloor = activeFloor;
  await doc.save(session ? { session } : undefined);
  return doc;
};
