import httpStatus from 'http-status';
import { VendorProductionFlow } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import {
  assertValidFloorState,
  computeDerivedForFloor,
  floorPath,
  pickFloorSnapshot,
  toFiniteNumber,
} from './vendorProductionFlowFloorPatch.js';
import { stageVendorTransferOnExistingContainer } from './vendorProductionFlowReceive.service.js';

/**
 * Dispatch → warehouse: same pattern as final checking → dispatch — transfer stages a real container;
 * WHMS scan runs {@link applyVendorWarehouseInwardAcceptFromContainer} (container accept on “Warehouse Inward”).
 */
export async function transferVendorDispatchToWarehouseQuantity(flowId, quantity, opts = {}) {
  const bc = opts.existingContainerBarcode;
  if (!bc || !String(bc).trim()) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'existingContainerBarcode is required (reuse a container; quantity is staged for the warehouse scan).'
    );
  }

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Transfer quantity must be greater than 0');
  }

  const items = opts.transferItems;
  if (Array.isArray(items) && items.length > 0) {
    const sum = items.reduce((s, row) => s + Math.max(0, Number(row?.transferred || 0)), 0);
    if (Math.abs(sum - qty) > 0.0001) {
      throw new ApiError(httpStatus.BAD_REQUEST, `transferItems sum (${sum}) must equal quantity (${qty})`);
    }
  }

  const apply = async (session = null) => {
    const sessionOptions = session ? { session } : undefined;
    const flowQuery = VendorProductionFlow.findById(flowId);
    const flow = session ? await flowQuery.session(session) : await flowQuery;
    if (!flow) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
    }

    const dispatchBefore = pickFloorSnapshot(flow, 'dispatch');
    const received = Number(dispatchBefore.received || 0);
    const transferred = Number(dispatchBefore.transferred || 0);
    const available = Math.max(0, received - transferred);
    if (qty > available + 1e-6) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Only ${available} quantity on dispatch is available to send toward the warehouse (received − transferred).`
      );
    }

    const newTransferred = transferred + qty;
    const newCompleted = Math.min(
      received,
      Math.max(toFiniteNumber(dispatchBefore.completed, 0), newTransferred)
    );
    const dispatchAfter = {
      ...dispatchBefore,
      transferred: newTransferred,
      completed: newCompleted,
    };
    assertValidFloorState('dispatch', dispatchAfter);
    const dispatchDerived = computeDerivedForFloor('dispatch', dispatchAfter);

    const setPayload = {
      [floorPath('dispatch', 'transferred')]: newTransferred,
      [floorPath('dispatch', 'completed')]: newCompleted,
      ...Object.fromEntries(
        Object.entries(dispatchDerived).map(([k, v]) => [floorPath('dispatch', k), v])
      ),
    };
    await VendorProductionFlow.updateOne({ _id: flowId }, { $set: setPayload }, sessionOptions);

    const lines =
      Array.isArray(items) && items.length > 0
        ? items.map((row) => ({
            transferred: Math.max(0, Number(row?.transferred || 0)),
            styleCode: String(row?.styleCode || ''),
            brand: String(row?.brand || ''),
          }))
        : [{ transferred: qty, styleCode: '', brand: '' }];

    await VendorProductionFlow.updateOne(
      { _id: flowId },
      { $push: { 'floorQuantities.dispatch.transferredData': { $each: lines } } },
      sessionOptions
    );

    await VendorProductionFlow.updateOne(
      { _id: flowId },
      {
        $set: Object.fromEntries(
          Object.entries(dispatchDerived).map(([k, v]) => [floorPath('dispatch', k), v])
        ),
      },
      sessionOptions
    );

    const c = await stageVendorTransferOnExistingContainer({
      barcode: bc,
      flowId: flowId.toString(),
      quantity: qty,
      toFloorKey: 'warehouse',
      transferItems: lines,
      session,
    });

    const updatedQuery = VendorProductionFlow.findById(flowId);
    const updatedFlow = session ? await updatedQuery.session(session) : await updatedQuery;
    const o = updatedFlow.toObject ? updatedFlow.toObject() : { ...updatedFlow };
    o.vendorTransferContainer = { barcode: c.barcode, _id: c._id.toString() };
    return o;
  };

  const session = await VendorProductionFlow.startSession();
  try {
    try {
      let updatedFlow;
      await session.withTransaction(async () => {
        updatedFlow = await apply(session);
      });
      return updatedFlow;
    } catch (error) {
      const message = String(error?.message || '');
      const isReplicaSetError =
        message.includes('Transaction numbers are only allowed on a replica set member or mongos');
      if (!isReplicaSetError) {
        throw error;
      }
      return apply(null);
    }
  } finally {
    session.endSession();
  }
}
