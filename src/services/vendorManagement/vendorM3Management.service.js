import httpStatus from 'http-status';
import VendorM3Log from '../../models/vendorManagement/vendorM3Log.model.js';
import VendorProductionFlow from '../../models/vendorManagement/vendorProductionFlow.model.js';
import VendorPurchaseOrder from '../../models/vendorManagement/vendorPurchaseOrder.model.js';
import { M3LogType } from '../../models/production/enums.js';
import ApiError from '../../utils/ApiError.js';

const VENDOR_M3_FLOOR_KEYS = ['secondaryChecking', 'finalChecking'];

/**
 * Per-floor M3 breakdown for a vendor production flow.
 * @param {Object} flow
 * @returns {Object}
 */
export const computeM3Snapshot = (flow) => {
  const fq = flow?.floorQuantities || {};
  const byFloor = {
    secondaryChecking: fq.secondaryChecking?.m3Quantity || 0,
    finalChecking: fq.finalChecking?.m3Quantity || 0,
  };
  const onHand = Object.values(byFloor).reduce((s, n) => s + n, 0);
  const outwardTotal = flow?.m3Tracking?.outwardTotal || 0;
  const availableForOutward = Math.max(0, onHand - outwardTotal);

  return { byFloor, onHand, outwardTotal, availableForOutward };
};

/**
 * Resolve vendor production flow by Mongo _id.
 * @param {string} flowId
 * @returns {Promise<Object|null>}
 */
const findFlowById = async (flowId) => VendorProductionFlow.findById(flowId);

/**
 * Resolve VPO number for denormalized log fields.
 * @param {Object} flow
 * @returns {Promise<string>}
 */
const resolveVpoNumber = async (flow) => {
  if (!flow?.vendorPurchaseOrder) return '';
  const po = await VendorPurchaseOrder.findById(flow.vendorPurchaseOrder).select('vpoNumber').lean();
  return po?.vpoNumber || '';
};

/**
 * Record a vendor M3 ENTRY log when floor M3 increases.
 * @param {Object} params
 * @returns {Promise<Object|null>}
 */
export const recordVendorM3Entry = async ({
  flow,
  sourceFloor,
  deltaQuantity,
  previousFloorTotal,
  newFloorTotal,
  user,
  remarks = '',
}) => {
  if (!flow || !deltaQuantity || deltaQuantity <= 0) return null;

  const snapshot = computeM3Snapshot(flow);
  const vpoNumber = await resolveVpoNumber(flow);
  const flowIdStr = flow._id?.toString?.() ?? String(flow._id);

  return VendorM3Log.createLogEntry({
    type: M3LogType.ENTRY,
    vendorProductionFlowId: flowIdStr,
    referenceCode: flow.referenceCode || '',
    vpoNumber,
    sourceFloor,
    quantity: deltaQuantity,
    previousOnHand: snapshot.onHand - deltaQuantity,
    newOnHand: snapshot.onHand,
    previousOutwardTotal: snapshot.outwardTotal,
    newOutwardTotal: snapshot.outwardTotal,
    availableAfter: snapshot.availableForOutward,
    remarks:
      remarks ||
      `Vendor M3 entry on ${sourceFloor}: +${deltaQuantity} (floor total ${previousFloorTotal} → ${newFloorTotal})`,
    userId: user?.id || user?.userId || 'system',
    userName: user?.name || user?.userName || '',
    floorSupervisorId: user?.id || user?.floorSupervisorId || 'system',
  });
};

/**
 * Mark vendor M3 quantity as outward (ledger-only; floor quantities unchanged).
 * @param {string} flowId
 * @param {Object} body
 * @param {Object} user
 * @returns {Promise<Object>}
 */
export const markM3Outward = async (flowId, body, user = {}) => {
  const { quantity, remarks } = body;

  if (!remarks || !String(remarks).trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Remarks are required for outward');
  }

  const flow = await findFlowById(flowId);
  if (!flow) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
  }

  const snapshot = computeM3Snapshot(flow);
  if (quantity <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Outward quantity must be greater than 0');
  }
  if (quantity > snapshot.availableForOutward) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot outward ${quantity} units. Available: ${snapshot.availableForOutward}`
    );
  }

  if (!flow.m3Tracking) {
    flow.m3Tracking = { outwardTotal: 0 };
  }
  const previousOutwardTotal = flow.m3Tracking.outwardTotal || 0;
  const newOutwardTotal = previousOutwardTotal + quantity;
  flow.m3Tracking.outwardTotal = newOutwardTotal;
  await flow.save();

  const vpoNumber = await resolveVpoNumber(flow);
  const flowIdStr = flow._id.toString();
  const availableAfter = Math.max(0, snapshot.onHand - newOutwardTotal);

  const log = await VendorM3Log.createLogEntry({
    type: M3LogType.OUTWARD,
    vendorProductionFlowId: flowIdStr,
    referenceCode: flow.referenceCode || '',
    vpoNumber,
    sourceFloor: null,
    quantity,
    previousOnHand: snapshot.onHand,
    newOnHand: snapshot.onHand,
    previousOutwardTotal,
    newOutwardTotal,
    availableAfter,
    remarks: String(remarks).trim(),
    userId: user?.id || 'system',
    userName: user?.name || '',
    floorSupervisorId: user?.id || 'system',
  });

  return {
    flow: {
      _id: flow._id,
      referenceCode: flow.referenceCode,
      vpoNumber,
      m3Snapshot: computeM3Snapshot(flow),
    },
    log,
  };
};

/**
 * Build Mongo filter for vendor flows with M3 activity.
 * @param {Object} filter
 * @returns {Object}
 */
const buildFlowM3Filter = (filter = {}) => {
  const mongoFilter = {
    $or: [
      { 'floorQuantities.secondaryChecking.m3Quantity': { $gt: 0 } },
      { 'floorQuantities.finalChecking.m3Quantity': { $gt: 0 } },
      { 'm3Tracking.outwardTotal': { $gt: 0 } },
    ],
  };

  if (filter.vendor) {
    mongoFilter.vendor = filter.vendor;
  }
  if (filter.vendorPurchaseOrder) {
    mongoFilter.vendorPurchaseOrder = filter.vendorPurchaseOrder;
  }

  if (filter.search) {
    const q = filter.search.trim();
    mongoFilter.$and = [
      ...(mongoFilter.$and || []),
      {
        $or: [{ referenceCode: { $regex: q, $options: 'i' } }],
      },
    ];
  }

  return mongoFilter;
};

/**
 * Paginated list of vendor flows with M3 snapshot data.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getM3Flows = async (filter = {}, options = {}) => {
  const mongoFilter = buildFlowM3Filter(filter);
  const page = options.page || 1;
  const limit = options.limit || 50;
  const skip = (page - 1) * limit;

  const [flows, totalResults] = await Promise.all([
    VendorProductionFlow.find(mongoFilter)
      .sort(options.sortBy ? options.sortBy.replace(':', ' ') : { updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    VendorProductionFlow.countDocuments(mongoFilter),
  ]);

  const poIds = [...new Set(flows.map((f) => f.vendorPurchaseOrder?.toString()).filter(Boolean))];
  const pos = await VendorPurchaseOrder.find({ _id: { $in: poIds } }).select('vpoNumber').lean();
  const poMap = Object.fromEntries(pos.map((p) => [p._id.toString(), p]));

  const results = flows.map((flow) => {
    const snapshot = computeM3Snapshot(flow);
    const po = poMap[flow.vendorPurchaseOrder?.toString()] || {};
    return {
      _id: flow._id,
      referenceCode: flow.referenceCode,
      vpoNumber: po.vpoNumber || '',
      vendor: flow.vendor,
      vendorPurchaseOrder: flow.vendorPurchaseOrder,
      currentFloorKey: flow.currentFloorKey,
      m3Snapshot: snapshot,
    };
  });

  return {
    results,
    page,
    limit,
    totalPages: Math.ceil(totalResults / limit) || 1,
    totalResults,
  };
};

/**
 * Paginated vendor M3 ledger logs with filters.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getM3Logs = async (filter = {}, options = {}) => {
  const logFilter = {};

  if (filter.vendorProductionFlowId) logFilter.vendorProductionFlowId = filter.vendorProductionFlowId;
  if (filter.type) logFilter.type = filter.type;
  if (filter.sourceFloor) logFilter.sourceFloor = filter.sourceFloor;
  if (filter.vpoNumber) logFilter.vpoNumber = filter.vpoNumber;
  if (filter.dateFrom || filter.dateTo) {
    logFilter.timestamp = {};
    if (filter.dateFrom) logFilter.timestamp.$gte = new Date(filter.dateFrom);
    if (filter.dateTo) logFilter.timestamp.$lte = new Date(filter.dateTo);
  }
  if (filter.search) {
    const q = filter.search.trim();
    logFilter.$or = [
      { vpoNumber: { $regex: q, $options: 'i' } },
      { referenceCode: { $regex: q, $options: 'i' } },
      { remarks: { $regex: q, $options: 'i' } },
      { userName: { $regex: q, $options: 'i' } },
    ];
  }

  return VendorM3Log.paginate(logFilter, {
    ...options,
    sortBy: options.sortBy || 'timestamp:desc',
  });
};

/**
 * Aggregate KPI stats for vendor M3 Management dashboard.
 * @returns {Promise<Object>}
 */
export const getM3Statistics = async () => {
  const flows = await VendorProductionFlow.find(buildFlowM3Filter()).lean();
  let totalOnHand = 0;
  let totalOutwarded = 0;
  let totalAvailable = 0;

  for (const flow of flows) {
    const snap = computeM3Snapshot(flow);
    totalOnHand += snap.onHand;
    totalOutwarded += snap.outwardTotal;
    totalAvailable += snap.availableForOutward;
  }

  return {
    flowCount: flows.length,
    totalOnHand,
    totalOutwarded,
    totalAvailable,
  };
};

export { VENDOR_M3_FLOOR_KEYS };
