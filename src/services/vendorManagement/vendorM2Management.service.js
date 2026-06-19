import httpStatus from 'http-status';
import VendorM2Log from '../../models/vendorManagement/vendorM2Log.model.js';
import VendorProductionFlow from '../../models/vendorManagement/vendorProductionFlow.model.js';
import VendorPurchaseOrder from '../../models/vendorManagement/vendorPurchaseOrder.model.js';
import { M2EntryStatus, M2LogType } from '../../models/production/enums.js';
import ApiError from '../../utils/ApiError.js';
import { recordVendorM3Entry } from './vendorM3Management.service.js';
import { recordVendorM4Entry } from './vendorM4Management.service.js';
import {
  applyVendorCascadeMergeIncrement,
  assessVendorM2MergeEligibility,
  bumpVendorFinalCheckingTransferredDataForM2Merge,
  getVendorCascadeFloorsForM2Merge,
  recalcVendorQcFloorRemaining,
} from '../../utils/vendorM2Cascade.util.js';

const VENDOR_M2_QC_FLOORS = ['secondaryChecking', 'finalChecking'];

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
 * Build user audit fields from request user.
 * @param {Object} user
 * @returns {Object}
 */
const userAuditFields = (user = {}) => ({
  userId: user?.id || user?.userId || user?._id?.toString?.() || 'system',
  userName: user?.name || user?.userName || '',
  userEmail: user?.email || user?.userEmail || '',
  floorSupervisorId: user?.id || user?.floorSupervisorId || 'system',
});

/**
 * Per-flow M2 open qty from ledger ENTRY rows.
 * @param {string} flowIdStr
 * @returns {Promise<number>}
 */
export const computeOpenVendorM2Quantity = async (flowIdStr) => {
  const entries = await VendorM2Log.find({
    vendorProductionFlowId: flowIdStr,
    type: M2LogType.ENTRY,
    status: { $in: [M2EntryStatus.OPEN, M2EntryStatus.PARTIAL] },
  }).lean();
  return entries.reduce((s, e) => s + (e.remainingQuantity || 0), 0);
};

/**
 * Record a vendor M2 ENTRY when QC floor M2 increases.
 * @param {Object} params
 * @returns {Promise<Object|null>}
 */
export const recordVendorM2Entry = async ({
  flow,
  sourceFloor,
  deltaQuantity,
  previousFloorTotal,
  newFloorTotal,
  user,
  remarks = '',
}) => {
  if (!flow || !deltaQuantity || deltaQuantity <= 0) return null;

  const vpoNumber = await resolveVpoNumber(flow);
  const flowIdStr = flow._id?.toString?.() ?? String(flow._id);
  const entryId = `VM2ENTRY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const audit = userAuditFields(user);

  return VendorM2Log.createLogEntry({
    type: M2LogType.ENTRY,
    entryId,
    status: M2EntryStatus.OPEN,
    originalQuantity: deltaQuantity,
    remainingQuantity: deltaQuantity,
    vendorProductionFlowId: flowIdStr,
    referenceCode: flow.referenceCode || '',
    vpoNumber,
    sourceFloor,
    quantity: deltaQuantity,
    remarks:
      remarks ||
      `Vendor M2 entry on ${sourceFloor}: +${deltaQuantity} (floor total ${previousFloorTotal} → ${newFloorTotal})`,
    ...audit,
  });
};

/**
 * Find vendor M2 ENTRY log by entryId.
 * @param {string} entryId
 * @returns {Promise<Object|null>}
 */
const findVendorM2EntryById = async (entryId) =>
  VendorM2Log.findOne({ entryId, type: M2LogType.ENTRY });

/**
 * Merge vendor M2 entry qty to M1 across cascade floors.
 * @param {string} entryId
 * @param {Object} body
 * @param {Object} user
 * @returns {Promise<Object>}
 */
export const markM2MergeToM1 = async (entryId, body, user = {}) => {
  const { quantity, remarks } = body;

  if (!remarks || !String(remarks).trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Remarks are required for merge');
  }
  if (!quantity || quantity <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Merge quantity must be greater than 0');
  }

  const entry = await findVendorM2EntryById(entryId);
  if (!entry) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor M2 entry not found');
  }
  if (![M2EntryStatus.OPEN, M2EntryStatus.PARTIAL].includes(entry.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor M2 entry is already resolved');
  }
  if (quantity > entry.remainingQuantity) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot merge ${quantity}. Remaining: ${entry.remainingQuantity}`
    );
  }

  const flow = await findFlowById(entry.vendorProductionFlowId);
  if (!flow) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
  }

  const mergeEligibility = assessVendorM2MergeEligibility(flow);
  if (!mergeEligibility.eligible) {
    throw new ApiError(httpStatus.BAD_REQUEST, mergeEligibility.reason);
  }

  const cascadeFloors = getVendorCascadeFloorsForM2Merge(entry.sourceFloor);
  const vpoNumber = await resolveVpoNumber(flow);
  const audit = userAuditFields(user);
  const trimmedRemarks = String(remarks).trim();

  for (const floorKey of cascadeFloors) {
    applyVendorCascadeMergeIncrement(flow, floorKey, quantity, entry.sourceFloor);
  }

  if (cascadeFloors.includes('finalChecking')) {
    bumpVendorFinalCheckingTransferredDataForM2Merge(flow, quantity);
  }

  const newRemaining = Math.max(0, entry.remainingQuantity - quantity);
  entry.remainingQuantity = newRemaining;
  entry.status = newRemaining === 0 ? M2EntryStatus.RESOLVED : M2EntryStatus.PARTIAL;
  await entry.save();

  const resolutionLog = await VendorM2Log.createLogEntry({
    type: M2LogType.MERGE_TO_M1,
    entryId,
    vendorProductionFlowId: entry.vendorProductionFlowId,
    referenceCode: entry.referenceCode,
    vpoNumber,
    sourceFloor: entry.sourceFloor,
    quantity,
    cascadeFloors,
    remarks: trimmedRemarks,
    ...audit,
  });

  await flow.save();

  return { entry, resolutionLog, cascadeFloors, vendorProductionFlowId: entry.vendorProductionFlowId };
};

/**
 * Transfer vendor M2 entry qty to M3 on source floor only.
 * @param {string} entryId
 * @param {Object} body
 * @param {Object} user
 * @returns {Promise<Object>}
 */
export const markM2TransferToM3 = async (entryId, body, user = {}) =>
  markM2TransferToDefectCategory(entryId, body, user, 'M3');

/**
 * Transfer vendor M2 entry qty to M4 on source floor only.
 * @param {string} entryId
 * @param {Object} body
 * @param {Object} user
 * @returns {Promise<Object>}
 */
export const markM2TransferToM4 = async (entryId, body, user = {}) =>
  markM2TransferToDefectCategory(entryId, body, user, 'M4');

/**
 * Transfer vendor M2 remaining qty to M3 or M4 on source QC floor.
 * @param {string} entryId
 * @param {Object} body
 * @param {Object} user
 * @param {'M3'|'M4'} category
 * @returns {Promise<Object>}
 */
async function markM2TransferToDefectCategory(entryId, body, user, category) {
  const { quantity, remarks } = body;

  if (!remarks || !String(remarks).trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Remarks are required');
  }
  if (!quantity || quantity <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Quantity must be greater than 0');
  }

  const entry = await findVendorM2EntryById(entryId);
  if (!entry) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor M2 entry not found');
  }
  if (![M2EntryStatus.OPEN, M2EntryStatus.PARTIAL].includes(entry.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor M2 entry is already resolved');
  }
  if (quantity > entry.remainingQuantity) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot transfer ${quantity}. Remaining: ${entry.remainingQuantity}`
    );
  }

  const flow = await findFlowById(entry.vendorProductionFlowId);
  if (!flow) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
  }

  const floorKey = entry.sourceFloor;
  const fd = flow.floorQuantities?.[floorKey];
  if (!fd) {
    throw new ApiError(httpStatus.BAD_REQUEST, `No floor data for ${entry.sourceFloor}`);
  }

  const prevM2 = fd.m2Quantity || 0;
  fd.m2Quantity = Math.max(0, prevM2 - quantity);

  if (category === 'M3') {
    const prevCat = fd.m3Quantity || 0;
    fd.m3Quantity = prevCat + quantity;
    recalcVendorQcFloorRemaining(fd, floorKey);
    await recordVendorM3Entry({
      flow,
      sourceFloor: floorKey,
      deltaQuantity: quantity,
      previousFloorTotal: prevCat,
      newFloorTotal: fd.m3Quantity,
      user,
      remarks: String(remarks).trim(),
    });
  } else {
    if (floorKey === 'secondaryChecking') {
      const prevVm4 = fd.vm4Quantity ?? fd.m4Quantity ?? 0;
      fd.vm4Quantity = prevVm4 + quantity;
    } else {
      const prevM4 = fd.m4Quantity || 0;
      fd.m4Quantity = prevM4 + quantity;
      await recordVendorM4Entry({
        flow,
        sourceFloor: floorKey,
        deltaQuantity: quantity,
        previousFloorTotal: prevM4,
        newFloorTotal: fd.m4Quantity,
        user,
        remarks: String(remarks).trim(),
      });
    }
    recalcVendorQcFloorRemaining(fd, floorKey);
  }

  flow.markModified(`floorQuantities.${floorKey}`);

  const newRemaining = Math.max(0, entry.remainingQuantity - quantity);
  entry.remainingQuantity = newRemaining;
  entry.status = newRemaining === 0 ? M2EntryStatus.RESOLVED : M2EntryStatus.PARTIAL;
  await entry.save();

  const vpoNumber = await resolveVpoNumber(flow);
  const audit = userAuditFields(user);
  const trimmedRemarks = String(remarks).trim();
  const logType = category === 'M3' ? M2LogType.TRANSFER_TO_M3 : M2LogType.TRANSFER_TO_M4;

  const resolutionLog = await VendorM2Log.createLogEntry({
    type: logType,
    entryId,
    vendorProductionFlowId: entry.vendorProductionFlowId,
    referenceCode: entry.referenceCode,
    vpoNumber,
    sourceFloor: entry.sourceFloor,
    quantity,
    remarks: trimmedRemarks,
    ...audit,
  });

  await flow.save();

  return { entry, resolutionLog };
}

/**
 * Paginated open vendor M2 entries for management screen.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getM2Entries = async (filter = {}, options = {}) => {
  const logFilter = { type: M2LogType.ENTRY };

  if (filter.status) {
    logFilter.status = filter.status;
  } else if (filter.includeResolved !== 'true') {
    logFilter.status = { $in: [M2EntryStatus.OPEN, M2EntryStatus.PARTIAL] };
  }

  if (filter.vendorProductionFlowId) logFilter.vendorProductionFlowId = filter.vendorProductionFlowId;
  if (filter.sourceFloor) logFilter.sourceFloor = filter.sourceFloor;
  if (filter.vpoNumber) logFilter.vpoNumber = filter.vpoNumber;

  if (filter.search) {
    const q = filter.search.trim();
    logFilter.$or = [
      { vpoNumber: { $regex: q, $options: 'i' } },
      { referenceCode: { $regex: q, $options: 'i' } },
      { entryId: { $regex: q, $options: 'i' } },
      { userName: { $regex: q, $options: 'i' } },
      { userEmail: { $regex: q, $options: 'i' } },
    ];
  }

  const paginated = await VendorM2Log.paginate(logFilter, {
    ...options,
    sortBy: options.sortBy || 'timestamp:desc',
  });

  const flowIds = [...new Set(paginated.results.map((row) => row.vendorProductionFlowId).filter(Boolean))];
  const flows = flowIds.length
    ? await VendorProductionFlow.find({ _id: { $in: flowIds } }).populate('product', 'name vendorCode factoryCode')
    : [];
  const flowById = new Map(flows.map((f) => [f._id.toString(), f]));

  const enrichedResults = paginated.results.map((row) => {
    const plain = row.toObject ? row.toObject() : { ...row };
    const flow = flowById.get(row.vendorProductionFlowId);
    if (!flow || !row.sourceFloor) {
      return {
        ...plain,
        productName: flow?.product?.name || '',
        productVendorCode: flow?.product?.vendorCode || '',
        canMergeToM1: false,
        mergeBlockedReason: 'Flow or source floor not found',
      };
    }
    const assessment = assessVendorM2MergeEligibility(flow);
    return {
      ...plain,
      productName: flow.product?.name || '',
      productVendorCode: flow.product?.vendorCode || '',
      canMergeToM1: assessment.eligible,
      mergeBlockedReason: assessment.reason,
    };
  });

  return { ...paginated, results: enrichedResults };
};

/**
 * Paginated vendor M2 ledger logs.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getM2Logs = async (filter = {}, options = {}) => {
  const logFilter = {};
  if (filter.vendorProductionFlowId) logFilter.vendorProductionFlowId = filter.vendorProductionFlowId;
  if (filter.type) logFilter.type = filter.type;
  if (filter.sourceFloor) logFilter.sourceFloor = filter.sourceFloor;
  if (filter.entryId) logFilter.entryId = filter.entryId;
  if (filter.vpoNumber) logFilter.vpoNumber = filter.vpoNumber;
  if (filter.dateFrom || filter.dateTo) {
    logFilter.timestamp = {};
    if (filter.dateFrom) logFilter.timestamp.$gte = new Date(filter.dateFrom);
    if (filter.dateTo) {
      const end = new Date(filter.dateTo);
      end.setHours(23, 59, 59, 999);
      logFilter.timestamp.$lte = end;
    }
  }
  if (filter.search) {
    const q = filter.search.trim();
    logFilter.$or = [
      { vpoNumber: { $regex: q, $options: 'i' } },
      { referenceCode: { $regex: q, $options: 'i' } },
      { remarks: { $regex: q, $options: 'i' } },
      { entryId: { $regex: q, $options: 'i' } },
    ];
  }
  return VendorM2Log.paginate(logFilter, {
    ...options,
    sortBy: options.sortBy || 'timestamp:desc',
  });
};

/**
 * KPI stats for vendor M2 Management dashboard.
 * @returns {Promise<Object>}
 */
export const getM2Statistics = async () => {
  const [openEntries, partialEntries, resolvedCount, totalOpenQty] = await Promise.all([
    VendorM2Log.countDocuments({ type: M2LogType.ENTRY, status: M2EntryStatus.OPEN }),
    VendorM2Log.countDocuments({ type: M2LogType.ENTRY, status: M2EntryStatus.PARTIAL }),
    VendorM2Log.countDocuments({ type: M2LogType.ENTRY, status: M2EntryStatus.RESOLVED }),
    VendorM2Log.aggregate([
      {
        $match: {
          type: M2LogType.ENTRY,
          status: { $in: [M2EntryStatus.OPEN, M2EntryStatus.PARTIAL] },
        },
      },
      { $group: { _id: null, total: { $sum: '$remainingQuantity' } } },
    ]),
  ]);

  return {
    openEntryCount: openEntries,
    partialEntryCount: partialEntries,
    resolvedEntryCount: resolvedCount,
    totalOpenQuantity: totalOpenQty[0]?.total || 0,
  };
};

export { VENDOR_M2_QC_FLOORS };
