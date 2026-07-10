import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { roleRights } from '../../config/roles.js';
import WarehouseOrder, {
  WarehouseOrderFlowStatus as F,
  coarseStatusForFlowStatus,
  flowStatusForCoarseStatus,
} from '../../models/whms/warehouseOrder.model.js';
import PickList from '../../models/whms/pickList.model.js';
import ScanSession from '../../models/whms/scanSession.model.js';
import { notifyWebsiteFromOrder } from '../integrations/websiteOrderOutbound.service.js';

/**
 * Allowed transitions per current flow status. Each stage may also step back to
 * the previous stage (re-open) so supervisors can correct mistakes.
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  [F.ORDER_CREATED]: [F.PICKING, F.CANCELLED],
  [F.PICKING]: [F.PICKING_DONE, F.CANCELLED],
  [F.PICKING_DONE]: [F.BARCODE_IN_PROGRESS, F.PICKING, F.CANCELLED],
  [F.BARCODE_IN_PROGRESS]: [F.PACKING_DONE, F.PICKING_DONE, F.CANCELLED],
  [F.PACKING_DONE]: [F.SENT_TO_SCANNING, F.BARCODE_IN_PROGRESS, F.CANCELLED],
  [F.SENT_TO_SCANNING]: [F.SCANNING_IN_PROGRESS, F.PACKING_DONE, F.CANCELLED],
  [F.SCANNING_IN_PROGRESS]: [F.SCANNING_DONE, F.SENT_TO_SCANNING, F.CANCELLED],
  [F.SCANNING_DONE]: [F.SENT_TO_BILLING, F.SCANNING_IN_PROGRESS, F.CANCELLED],
  [F.SENT_TO_BILLING]: [F.BILLED, F.SCANNING_DONE, F.CANCELLED],
  [F.BILLED]: [F.READY_TO_DISPATCH, F.CANCELLED],
  [F.READY_TO_DISPATCH]: [F.DISPATCHED, F.PARTIAL_DISPATCHED, F.READY_FOR_PICKUP, F.CANCELLED],
  [F.DISPATCHED]: [F.DELIVERED],
  [F.PARTIAL_DISPATCHED]: [F.DISPATCHED, F.DELIVERED],
  [F.READY_FOR_PICKUP]: [F.DISPATCHED, F.DELIVERED],
  [F.DELIVERED]: [],
  [F.CANCELLED]: [],
});

/** Permission required to move an order INTO each flow status. */
const TRANSITION_PERMISSIONS = Object.freeze({
  [F.PICKING]: 'whmsPickingSupervise',
  [F.PICKING_DONE]: 'whmsPickingSupervise',
  [F.BARCODE_IN_PROGRESS]: 'whmsBarcode',
  [F.PACKING_DONE]: 'whmsPickingSupervise',
  [F.SENT_TO_SCANNING]: 'whmsPickingSupervise',
  [F.SCANNING_IN_PROGRESS]: 'whmsScanning',
  [F.SCANNING_DONE]: 'whmsScanning',
  [F.SENT_TO_BILLING]: 'whmsScanning',
  [F.BILLED]: 'whmsBilling',
  [F.READY_TO_DISPATCH]: 'whmsDispatch',
  [F.DISPATCHED]: 'whmsDispatch',
  [F.PARTIAL_DISPATCHED]: 'whmsDispatch',
  [F.READY_FOR_PICKUP]: 'whmsDispatch',
  [F.DELIVERED]: 'whmsDispatch',
  [F.CANCELLED]: 'manageOrders',
});

const userHasRight = (user, right) => {
  if (!user || !right) return false;
  const rights = roleRights.get(user.role) || [];
  return rights.includes(right);
};

/** Effective flow status — falls back to a mapping from the coarse status for pre-migration docs. */
export const effectiveFlowStatus = (order) => order.flowStatus || flowStatusForCoarseStatus(order.status);

/**
 * Stage-entry guards. Each receives the order and may throw ApiError.
 * Guards marked `internalOnly` reject manual transitions entirely.
 */
const guards = {
  async [F.PICKING_DONE](order) {
    const rowCount = await PickList.countDocuments({ orderId: order._id });
    if (!rowCount) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot mark picking done: no pick list exists for this order');
    }
  },
  async [F.PACKING_DONE](order) {
    const rows = await PickList.find({ orderId: order._id }).select('pickupQuantity').lean();
    if (!rows.length) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot mark packing done: no pick list exists for this order');
    }
    const totalPicked = rows.reduce((sum, r) => sum + Number(r.pickupQuantity || 0), 0);
    if (totalPicked <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot mark packing done: no picked quantities saved yet (barcode step incomplete)'
      );
    }
  },
  async [F.SCANNING_DONE](order, { system }) {
    if (system) return; // raised by scanning.service completeSession
    const completed = await ScanSession.findOne({ orderId: order._id, status: 'completed' }).select('_id');
    if (!completed) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot mark scanning done: complete a scan session for this order first'
      );
    }
  },
  async [F.BILLED](order, { viaInvoice }) {
    if (!viaInvoice) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Order is marked billed by generating an invoice, not manually');
    }
  },
  async [F.DISPATCHED](order, { viaDispatch }) {
    if (!viaDispatch && !(order.dispatch && (order.dispatch.courierName || order.dispatch.trackingNumber))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Enter dispatch details (courier / tracking number) before dispatching');
    }
  },
  async [F.PARTIAL_DISPATCHED](order, opts) {
    return guards[F.DISPATCHED](order, opts);
  },
};

/**
 * Transition a warehouse order to a new flow status.
 *
 * @param {string} orderId
 * @param {string} toStatus - target flow status
 * @param {object|null} user - authenticated user (null only with internal.system)
 * @param {object} [payload]
 * @param {string} [payload.remarks]
 * @param {object} [internal] - service-to-service flags, never from request body
 * @param {boolean} [internal.system] - skip permission check (system-initiated)
 * @param {boolean} [internal.viaInvoice] - transition raised by invoice generation
 * @param {boolean} [internal.viaDispatch] - transition raised by the dispatch endpoint
 * @param {import('mongoose').ClientSession} [internal.session]
 * @returns {Promise<import('mongoose').Document>} updated order
 */
export const transitionOrder = async (orderId, toStatus, user, payload = {}, internal = {}) => {
  const query = WarehouseOrder.findById(orderId);
  if (internal.session) query.session(internal.session);
  const order = await query;
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');

  const fromStatus = effectiveFlowStatus(order);
  if (fromStatus === toStatus) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Order is already in status "${toStatus}"`);
  }

  const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Invalid transition: "${fromStatus}" → "${toStatus}". Allowed next: ${allowed.join(', ') || 'none'}`
    );
  }

  if (!internal.system) {
    const requiredRight = TRANSITION_PERMISSIONS[toStatus];
    if (requiredRight && !userHasRight(user, requiredRight)) {
      throw new ApiError(httpStatus.FORBIDDEN, `Your role is not allowed to move orders to "${toStatus}"`);
    }
  }

  const guard = guards[toStatus];
  if (guard) await guard(order, internal);

  order.flowStatus = toStatus;
  order.status = coarseStatusForFlowStatus(toStatus);
  order.flowHistory.push({
    from: fromStatus,
    to: toStatus,
    byUserId: user?._id ?? user?.id ?? null,
    byName: user?.name || user?.email || (internal.system ? 'system' : ''),
    remarks: String(payload.remarks || '').trim(),
    at: new Date(),
  });

  await order.save({ session: internal.session });
  notifyWebsiteFromOrder(order, 'status_update');
  return order;
};

/** Allowed next statuses for an order, filtered by what the user's role may perform. */
export const allowedNextStatuses = (order, user) => {
  const from = effectiveFlowStatus(order);
  const nexts = ALLOWED_TRANSITIONS[from] || [];
  if (!user) return nexts;
  return nexts.filter((to) => {
    const right = TRANSITION_PERMISSIONS[to];
    return !right || userHasRight(user, right);
  });
};

export const getFlowHistory = async (orderId) => {
  const order = await WarehouseOrder.findById(orderId).select('orderNumber flowStatus status flowHistory');
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');
  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    flowStatus: effectiveFlowStatus(order),
    status: order.status,
    history: order.flowHistory || [],
  };
};

export { ALLOWED_TRANSITIONS, TRANSITION_PERMISSIONS };
