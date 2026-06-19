import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { VendorProductionFlow } from '../../models/index.js';
import ContainersMaster from '../../models/production/containersMaster.model.js';
import { ContainerStatus } from '../../models/production/enums.js';
import ApiError from '../../utils/ApiError.js';
import { computeDerivedForFloor, pickFloorSnapshot } from './vendorProductionFlowFloorPatch.js';
import { aggregateTransferredByStyleKey } from '../../utils/vendorStyleQuantity.util.js';
import { promoteVendorDispatchToInwardReceive } from '../whms/inwardReceiveFromVendorDispatch.helper.js';

/** WHMS: container accept after dispatch→warehouse transfer stages this floor. */
export const VENDOR_WAREHOUSE_INWARD_ACTIVE_FLOOR = 'Warehouse Inward';

/** `activeFloor` on ContainersMaster for vendor receive scans (must match accept mapping below). */
export const vendorFloorKeyToContainerActiveFloor = (floorKey) => {
  const map = {
    secondaryChecking: 'Secondary Checking',
    branding: 'Branding',
    reBoarding: 'Re-Boarding',
    finalChecking: 'Final Checking',
    dispatch: 'Dispatch',
    warehouse: VENDOR_WAREHOUSE_INWARD_ACTIVE_FLOOR,
  };
  return map[floorKey] || floorKey;
};

/** True when `activeFloor` on ContainersMaster is the vendor dispatch→WHMS staging target. */
export const isVendorWarehouseInwardActiveFloor = (activeFloor) => {
  const a = String(activeFloor || '').trim().toLowerCase();
  return a === VENDOR_WAREHOUSE_INWARD_ACTIVE_FLOOR.toLowerCase();
};

const FLOOR_NAME_TO_KEY = {
  'Secondary Checking': 'secondaryChecking',
  'Branding': 'branding',
  'Re-Boarding': 'reBoarding',
  'Final Checking': 'finalChecking',
  'Dispatch': 'dispatch',
  [VENDOR_WAREHOUSE_INWARD_ACTIVE_FLOOR]: 'warehouse',
};

/**
 * Floor that feeds Final Checking for this flow. With Embroidery the article passes through
 * Re-Boarding, so Final Checking's cap/style source is reBoarding; otherwise it is branding.
 * @param {Object} flow
 * @returns {'reBoarding'|'branding'}
 */
function getVendorFinalCheckingSourceFloorKey(flow) {
  const rb = flow?.floorQuantities?.reBoarding;
  const hasReBoardingActivity =
    rb &&
    (Number(rb.transferred || 0) > 0 ||
      Number(rb.received || 0) > 0 ||
      (Array.isArray(rb.transferredData) && rb.transferredData.length > 0));
  return hasReBoardingActivity ? 'reBoarding' : 'branding';
}

/**
 * Branding receive cannot exceed M1 quantity transferred from secondary checking.
 * @param {Object} flow - VendorProductionFlow document
 * @param {number} quantity - Units to accept on branding
 */
function assertVendorBrandingReceiveWithinSecondaryCap(flow, quantity) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return;

  const sc = flow.floorQuantities?.secondaryChecking || {};
  const branding = flow.floorQuantities?.branding || {};
  const m1Transferred = Number(sc.m1Transferred || 0);
  const brandingReceived = Number(branding.received || 0);

  if (m1Transferred <= 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot receive at branding: secondary checking has not transferred M1 quantity for this flow.'
    );
  }

  const maxReceivable = Math.max(0, m1Transferred - brandingReceived);
  if (qty > maxReceivable + 1e-6) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Accept quantity (${qty}) exceeds receivable from secondary checking (${maxReceivable}). Transfer from secondary checking first.`
    );
  }
}

/**
 * Cumulative receive per style on `destFloorKey` cannot exceed what `sourceFloorKey` sent
 * (sum of source.transferredData per key). Supports incremental containers: first scan +10,
 * second +20 for same style → cap 30 from the source floor.
 * Used for: branding → reBoarding, branding → finalChecking, reBoarding → finalChecking.
 * @param {Object} flow
 * @param {'branding'|'reBoarding'} sourceFloorKey
 * @param {'reBoarding'|'finalChecking'} destFloorKey
 * @param {Array<{ transferred: number, styleCode?: string, brand?: string }>} incomingRows
 */
function assertVendorReceiveWithinSourceCap(flow, sourceFloorKey, destFloorKey, incomingRows) {
  const source = flow.floorQuantities?.[sourceFloorKey] || {};
  const sourceTotal = Number(source.transferred || 0);
  const sourceByStyle = aggregateTransferredByStyleKey(source.transferredData);
  const sourceLabel = sourceFloorKey === 'reBoarding' ? 're-boarding' : 'branding';
  const destLabel = destFloorKey === 'reBoarding' ? 're-boarding' : 'final checking';

  const dest = flow.floorQuantities?.[destFloorKey] || {};
  const destExisting = aggregateTransferredByStyleKey(dest.receivedData);
  const incomingMap = aggregateTransferredByStyleKey(incomingRows);
  const incomingTotal = [...incomingMap.values()].reduce((a, b) => a + b, 0);
  if (incomingTotal <= 0) return;

  if (sourceTotal <= 0 && sourceByStyle.size === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot receive at ${destLabel}: ${sourceLabel} has not recorded an outbound transfer for this flow.`
    );
  }

  if (sourceByStyle.size > 0) {
    for (const [k, inc] of incomingMap) {
      if (inc <= 0) continue;
      const cap = sourceByStyle.get(k);
      if (cap === undefined) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Style/brand key "${k}" is not present in ${sourceLabel} outbound lines. Each container line must match a styleCode/brand that ${sourceLabel} already sent.`
        );
      }
      const after = (destExisting.get(k) || 0) + inc;
      if (after > cap + 1e-6) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `For "${k}": ${destLabel} would receive ${after} cumulative but ${sourceLabel} only sent ${cap}. Second+ containers must carry only **new** units for that style (e.g. 10 then 20 more, not 30 as a repeat of the first 10).`
        );
      }
    }
    return;
  }

  const destAfter = Number(dest.received || 0) + incomingTotal;
  if (destAfter > sourceTotal + 1e-6) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `${destLabel} total receive would be ${destAfter} but ${sourceLabel} only sent ${sourceTotal} in total.`
    );
  }
}

/**
 * Cumulative dispatch receive per style cannot exceed final checking’s outbound ledger toward dispatch
 * (`finalChecking.transferredData`, plus same totals as `finalChecking.transferred` when style rows are maintained).
 */
function assertVendorDispatchReceiveWithinFinalCheckingCap(flow, incomingRows) {
  const fc = flow.floorQuantities?.finalChecking || {};
  const fcTotal = Number(fc.transferred || 0);
  const fcByStyle = aggregateTransferredByStyleKey(fc.transferredData);

  const dispatch = flow.floorQuantities?.dispatch || {};
  const dispatchExisting = aggregateTransferredByStyleKey(dispatch.receivedData);
  const incomingMap = aggregateTransferredByStyleKey(incomingRows);
  const incomingTotal = [...incomingMap.values()].reduce((a, b) => a + b, 0);
  if (incomingTotal <= 0) return;

  if (fcTotal <= 0 && fcByStyle.size === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot receive at dispatch: final checking has not recorded quantity toward dispatch (transfer or confirm).'
    );
  }

  if (fcByStyle.size > 0) {
    for (const [k, inc] of incomingMap) {
      if (inc <= 0) continue;
      const cap = fcByStyle.get(k);
      if (cap === undefined) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Style/brand key "${k}" is not present in final checking outbound toward dispatch. Each dispatch line must match a style final checking already sent.`
        );
      }
      const after = (dispatchExisting.get(k) || 0) + inc;
      if (after > cap + 1e-6) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `For "${k}": dispatch would receive ${after} cumulative but final checking only sent ${cap} toward dispatch.`
        );
      }
    }
    return;
  }

  const dispatchTotal = [...dispatchExisting.values()].reduce((a, b) => a + b, 0);
  if (dispatchTotal + incomingTotal > fcTotal + 1e-6) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Dispatch total receive would be ${dispatchTotal + incomingTotal} but final checking only sent ${fcTotal} toward dispatch in total.`
    );
  }
}

function resolveVendorFloorKey(floor) {
  const s = String(floor || '').trim();
  if (['secondaryChecking', 'branding', 'reBoarding', 'finalChecking', 'dispatch'].includes(s)) return s;
  if (FLOOR_NAME_TO_KEY[s]) return FLOOR_NAME_TO_KEY[s];
  const lower = s.replace(/[\s-]+/g, '').toLowerCase();
  if (lower === 'secondarychecking') return 'secondaryChecking';
  if (lower === 'branding') return 'branding';
  if (lower === 'reboarding') return 'reBoarding';
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

  /**
   * No container-id idempotency guard here: vendor staging **re-uses** the same physical container
   * across cycles (existingContainerBarcode), so a container id legitimately appears in this floor's
   * receivedData from earlier batches. Double-accept of the *same* staged batch is already prevented at
   * the container level — `acceptContainerByBarcode` clears `activeItems` after crediting, so re-scanning
   * an unchanged container finds no items. Crediting here must run for every newly staged batch.
   */
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

  if (containerTransferItems && (floorKey === 'reBoarding' || floorKey === 'finalChecking' || floorKey === 'dispatch')) {
    receivedTransferItems = containerTransferItems;
  }

  /** Re-Boarding receives the branding outbound style breakdown (Embroidery articles). */
  if (
    (!receivedTransferItems || receivedTransferItems.length === 0) &&
    typeof quantity === 'number' &&
    quantity > 0 &&
    floorKey === 'reBoarding'
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

  if (
    (!receivedTransferItems || receivedTransferItems.length === 0) &&
    typeof quantity === 'number' &&
    quantity > 0 &&
    floorKey === 'finalChecking'
  ) {
    const sourceFloorKey = getVendorFinalCheckingSourceFloorKey(flow);
    const sourceFloor = flow.floorQuantities?.[sourceFloorKey];
    const prevTransferredData = sourceFloor?.transferredData;
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

  if (
    (!receivedTransferItems || receivedTransferItems.length === 0) &&
    typeof quantity === 'number' &&
    quantity > 0 &&
    floorKey === 'dispatch'
  ) {
    const fc = flow.floorQuantities?.finalChecking;
    const prevTransferredData = fc?.transferredData;
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

  if (floorKey === 'reBoarding') {
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
      assertVendorReceiveWithinSourceCap(flow, 'branding', 'reBoarding', capLines);
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
      assertVendorReceiveWithinSourceCap(flow, getVendorFinalCheckingSourceFloorKey(flow), 'finalChecking', capLines);
    }
  }

  if (floorKey === 'dispatch') {
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
      assertVendorDispatchReceiveWithinFinalCheckingCap(flow, capLines);
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

  if (floorKey === 'branding' && typeof quantity === 'number' && quantity > 0) {
    assertVendorBrandingReceiveWithinSecondaryCap(flow, quantity);
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
  for (const [k, v] of Object.entries(derived)) {
    floorData[k] = v;
  }
  flow.markModified(`floorQuantities.${floorKey}`);

  await flow.save();

  // Mongoose subdoc save can silently drop derived fields — reconcile with atomic $set.
  const derivedSet = {};
  for (const [k, v] of Object.entries(derived)) {
    derivedSet[`floorQuantities.${floorKey}.${k}`] = v;
  }
  if (Object.keys(derivedSet).length > 0) {
    await VendorProductionFlow.updateOne({ _id: flow._id }, { $set: derivedSet });
  }

  const receivedDataNewLines = floorData.receivedData.slice(receivedDataLengthBefore);

  return { flow, receivedDataNewLines };
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
  if (!['branding', 'finalChecking', 'dispatch', 'warehouse'].includes(toFloorKey)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Vendor staging is only used for Branding, Final Checking, Dispatch, or warehouse (WHMS handoff)'
    );
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

  const hasActiveItems =
    Array.isArray(doc.activeItems) &&
    doc.activeItems.some((i) => Number(i?.quantity || 0) > 0);
  const hasActiveFloor = Boolean(doc.activeFloor && String(doc.activeFloor).trim());
  if (hasActiveItems || hasActiveFloor) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Container must be empty before staging a vendor transfer (no active floor or items)'
    );
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

/**
 * WHMS container scan: record `warehouse:handoff` rows on `dispatch.receivedData` and create inward queue lines
 * (same scan as production “accept”, but destination is WHMS inward via {@link promoteVendorDispatchToInwardReceive}).
 *
 * @param {import('mongoose').Document} doc - ContainersMaster with {@link VENDOR_WAREHOUSE_INWARD_ACTIVE_FLOOR}
 * @returns {Promise<{ flows: import('mongoose').Document[], barcode: string }>}
 */
export async function applyVendorWarehouseInwardAcceptFromContainer(doc) {
  const items = doc.activeItems || [];
  const flows = [];
  const barcode = doc.barcode && String(doc.barcode).trim() ? doc.barcode : doc._id.toString();

  for (const item of items) {
    const vpf = item.vendorProductionFlow;
    if (!vpf) continue;
    const qty = Number(item.quantity || 0);
    if (qty <= 0) continue;

    const flowId = typeof vpf === 'object' ? vpf._id.toString() : String(vpf);
    const flow = await VendorProductionFlow.findById(flowId);
    if (!flow) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
    }

    let rows = [];
    if (Array.isArray(item.transferItems) && item.transferItems.length > 0) {
      rows = item.transferItems.map((t) => ({
        receivedStatusFromPreviousFloor: 'warehouse:handoff',
        receivedInContainerId: doc._id,
        receivedTimestamp: new Date(),
        transferred: Math.max(0, Number(t.transferred || 0)),
        styleCode: String(t.styleCode || ''),
        brand: String(t.brand || ''),
      }));
    } else {
      rows = [
        {
          receivedStatusFromPreviousFloor: 'warehouse:handoff',
          receivedInContainerId: doc._id,
          receivedTimestamp: new Date(),
          transferred: qty,
          styleCode: '',
          brand: '',
        },
      ];
    }

    if (!flow.floorQuantities.dispatch) {
      flow.floorQuantities.dispatch = {};
    }
    if (!Array.isArray(flow.floorQuantities.dispatch.receivedData)) {
      flow.floorQuantities.dispatch.receivedData = [];
    }
    for (const r of rows) {
      flow.floorQuantities.dispatch.receivedData.push(r);
    }
    flow.markModified('floorQuantities.dispatch');
    await flow.save();
    flows.push(flow);

    await promoteVendorDispatchToInwardReceive(flowId, { containerBarcode: barcode });
  }

  return { flows, barcode };
}
