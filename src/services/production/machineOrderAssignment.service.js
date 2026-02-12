import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import Machine from '../../models/machine.model.js';
import MachineOrderAssignment from '../../models/production/machineOrderAssignment.model.js';
import MachineOrderAssignmentLog from '../../models/production/machineOrderAssignmentLog.model.js';
import { LogAction } from '../../models/production/enums.js';

/**
 * Create a machine order assignment. Logs ASSIGNMENT_CREATED with userId.
 * @param {Object} body
 * @param {ObjectId} [userId] - From req.user._id for audit log
 * @returns {Promise<MachineOrderAssignment>}
 */
export const createMachineOrderAssignment = async (body, userId) => {
  const machine = await Machine.findById(body.machine);
  if (!machine) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Machine not found');
  }
  const assignment = await MachineOrderAssignment.create(body);
  if (userId) {
    await MachineOrderAssignmentLog.createLogEntry({
      assignmentId: assignment._id,
      userId,
      action: LogAction.ASSIGNMENT_CREATED,
      changes: [
        { field: 'machine', previousValue: null, newValue: body.machine },
        { field: 'activeNeedle', previousValue: null, newValue: body.activeNeedle },
        { field: 'productionOrderItems', previousValue: null, newValue: body.productionOrderItems?.length ?? 0 },
      ],
      remarks: 'Assignment created',
    });
  }
  return assignment;
};

/**
 * Query machine order assignments with filter and pagination.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
export const queryMachineOrderAssignments = async (filter, options) => {
  const assignments = await MachineOrderAssignment.paginate(filter, {
    ...options,
    populate: ['machine', 'productionOrderItems.productionOrder', 'productionOrderItems.article'],
    sortBy: options.sortBy || 'createdAt:desc',
  });
  return assignments;
};

/**
 * Get assignment by id.
 * @param {ObjectId} assignmentId
 * @returns {Promise<MachineOrderAssignment|null>}
 */
export const getMachineOrderAssignmentById = async (assignmentId) => {
  return MachineOrderAssignment.findById(assignmentId)
    .populate('machine')
    .populate('productionOrderItems.productionOrder')
    .populate('productionOrderItems.article');
};

/**
 * Update assignment by id. Builds change list and creates audit log with userId.
 * @param {ObjectId} assignmentId
 * @param {Object} updateBody
 * @param {ObjectId} [userId]
 * @returns {Promise<MachineOrderAssignment>}
 */
export const updateMachineOrderAssignmentById = async (assignmentId, updateBody, userId) => {
  const assignment = await MachineOrderAssignment.findById(assignmentId);
  if (!assignment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine order assignment not found');
  }
  const previous = assignment.toObject();
  const changes = [];

  /** Dedupe key for productionOrderItems: same (productionOrder, article) = same queue entry */
  const itemKey = (i) => `${(i.productionOrder && i.productionOrder.toString?.()) || i.productionOrder}_${(i.article && i.article.toString?.()) || i.article}`;

  // Append items when addProductionOrderItems is sent; do not replace array in that case.
  const toAssign = { ...updateBody };
  if (toAssign.addProductionOrderItems != null) {
    const toAdd = Array.isArray(toAssign.addProductionOrderItems) ? toAssign.addProductionOrderItems : [];
    assignment.productionOrderItems.push(...toAdd);
    assignment.markModified('productionOrderItems');
    changes.push({
      field: 'productionOrderItems',
      previousValue: previous.productionOrderItems?.length ?? 0,
      newValue: assignment.productionOrderItems.length,
    });
    delete toAssign.addProductionOrderItems;
    delete toAssign.productionOrderItems;
  } else if (toAssign.productionOrderItems !== undefined && Array.isArray(toAssign.productionOrderItems)) {
    // Merge: existing items get only their changed fields updated; new items are appended.
    const current = assignment.productionOrderItems || [];
    const keyToIndex = new Map();
    current.forEach((c, idx) => {
      keyToIndex.set(itemKey(c), idx);
    });
    let didChange = false;
    for (const item of toAssign.productionOrderItems) {
      const k = itemKey(item);
      const existingIdx = keyToIndex.get(k);
      if (existingIdx !== undefined) {
        // Same item: update only fields that are sent (status, priority)
        const existing = current[existingIdx];
        if (item.status !== undefined && String(existing.status) !== String(item.status)) {
          existing.status = item.status;
          didChange = true;
        }
        if (item.priority !== undefined && Number(existing.priority) !== Number(item.priority)) {
          existing.priority = item.priority;
          didChange = true;
        }
      } else {
        current.push(item);
        keyToIndex.set(k, current.length - 1);
        didChange = true;
      }
    }
    if (didChange) {
      assignment.productionOrderItems = current;
      assignment.markModified('productionOrderItems');
      changes.push({
        field: 'productionOrderItems',
        previousValue: previous.productionOrderItems?.length ?? 0,
        newValue: assignment.productionOrderItems.length,
      });
    }
    delete toAssign.productionOrderItems;
  }

  if (toAssign.machine !== undefined && toAssign.machine !== previous.machine?.toString()) {
    changes.push({ field: 'machine', previousValue: previous.machine, newValue: toAssign.machine });
  }
  if (toAssign.activeNeedle !== undefined && toAssign.activeNeedle !== previous.activeNeedle) {
    changes.push({
      field: 'activeNeedle',
      previousValue: previous.activeNeedle,
      newValue: toAssign.activeNeedle,
    });
  }
  if (toAssign.productionOrderItems !== undefined) {
    changes.push({
      field: 'productionOrderItems',
      previousValue: previous.productionOrderItems?.length ?? 0,
      newValue: toAssign.productionOrderItems.length,
    });
  }
  if (toAssign.isActive !== undefined && toAssign.isActive !== previous.isActive) {
    changes.push({ field: 'isActive', previousValue: previous.isActive, newValue: toAssign.isActive });
  }

  Object.assign(assignment, toAssign);
  await assignment.save();

  if (userId && changes.length > 0) {
    const action =
      changes.some((c) => c.field === 'activeNeedle') && changes.length === 1
        ? LogAction.ASSIGNMENT_ACTIVE_NEEDLE_CHANGED
        : changes.some((c) => c.field === 'productionOrderItems')
          ? LogAction.ASSIGNMENT_ITEMS_UPDATED
          : LogAction.ASSIGNMENT_UPDATED;
    await MachineOrderAssignmentLog.createLogEntry({
      assignmentId: assignment._id,
      userId,
      action,
      changes,
      remarks: updateBody.remarks || '',
    });
  }
  return assignment;
};

/**
 * Update priority of a single productionOrderItem by its subdocument _id.
 * @param {ObjectId} assignmentId
 * @param {ObjectId} itemId - _id of the item in productionOrderItems
 * @param {Object} body - { priority: number }
 * @param {ObjectId} [userId]
 * @returns {Promise<MachineOrderAssignment>}
 */
export const updateProductionOrderItemPriorityById = async (assignmentId, itemId, body, userId) => {
  const assignment = await MachineOrderAssignment.findById(assignmentId);
  if (!assignment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine order assignment not found');
  }
  const item = assignment.productionOrderItems?.id(itemId);
  if (!item) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Production order item not found in this assignment');
  }
  const previousPriority = item.priority;
  if (body.priority !== undefined && body.priority !== previousPriority) {
    item.priority = body.priority;
    assignment.markModified('productionOrderItems');
    await assignment.save();
    if (userId) {
      await MachineOrderAssignmentLog.createLogEntry({
        assignmentId: assignment._id,
        userId,
        action: LogAction.ASSIGNMENT_ITEMS_UPDATED,
        changes: [
          {
            field: 'productionOrderItems.priority',
            previousValue: previousPriority,
            newValue: body.priority,
          },
        ],
        remarks: 'Item priority updated',
      });
    }
  }
  return MachineOrderAssignment.findById(assignmentId)
    .populate('machine')
    .populate('productionOrderItems.productionOrder')
    .populate('productionOrderItems.article');
};

/**
 * Update priorities of multiple productionOrderItems in one request.
 * @param {ObjectId} assignmentId
 * @param {Array<{ itemId: ObjectId, priority: number }>} items
 * @param {ObjectId} [userId]
 * @returns {Promise<MachineOrderAssignment>}
 */
export const updateProductionOrderItemPrioritiesById = async (assignmentId, items, userId) => {
  const assignment = await MachineOrderAssignment.findById(assignmentId);
  if (!assignment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine order assignment not found');
  }
  const changes = [];
  let didChange = false;
  for (const { itemId, priority } of items) {
    const item = assignment.productionOrderItems?.id(itemId);
    if (!item) {
      throw new ApiError(httpStatus.NOT_FOUND, `Production order item ${itemId} not found in this assignment`);
    }
    if (Number(item.priority) !== Number(priority)) {
      changes.push({
        field: `productionOrderItems.priority(${itemId})`,
        previousValue: item.priority,
        newValue: priority,
      });
      item.priority = priority;
      didChange = true;
    }
  }
  if (didChange) {
    assignment.markModified('productionOrderItems');
    await assignment.save();
    if (userId && changes.length > 0) {
      await MachineOrderAssignmentLog.createLogEntry({
        assignmentId: assignment._id,
        userId,
        action: LogAction.ASSIGNMENT_ITEMS_UPDATED,
        changes,
        remarks: 'Item priorities updated',
      });
    }
  }
  return MachineOrderAssignment.findById(assignmentId)
    .populate('machine')
    .populate('productionOrderItems.productionOrder')
    .populate('productionOrderItems.article');
};

/**
 * Reset assignment queue: set productionOrderItems to empty array.
 * @param {ObjectId} assignmentId
 * @param {ObjectId} [userId]
 * @returns {Promise<MachineOrderAssignment>}
 */
export const resetMachineOrderAssignmentById = async (assignmentId, userId) => {
  return updateMachineOrderAssignmentById(assignmentId, { productionOrderItems: [] }, userId);
};

/**
 * Remove all productionOrderItems that reference a given production order.
 * Call this when a production order is deleted so machine queues stay in sync.
 * @param {ObjectId} orderId - Deleted production order id
 * @returns {Promise<{ modifiedCount: number }>}
 */
export const removeProductionOrderFromAssignments = async (orderId) => {
  const result = await MachineOrderAssignment.updateMany(
    { 'productionOrderItems.productionOrder': orderId },
    { $pull: { productionOrderItems: { productionOrder: orderId } } }
  );
  return { modifiedCount: result.modifiedCount ?? 0 };
};

/**
 * Delete assignment by id. Optionally log deactivation with userId.
 * @param {ObjectId} assignmentId
 * @param {ObjectId} [userId]
 */
export const deleteMachineOrderAssignmentById = async (assignmentId, userId) => {
  const assignment = await MachineOrderAssignment.findById(assignmentId);
  if (!assignment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine order assignment not found');
  }
  await MachineOrderAssignment.deleteOne({ _id: assignmentId });
  if (userId) {
    await MachineOrderAssignmentLog.createLogEntry({
      assignmentId,
      userId,
      action: LogAction.ASSIGNMENT_DEACTIVATED,
      changes: [{ field: 'deleted', previousValue: false, newValue: true }],
      remarks: 'Assignment deleted',
    });
  }
};

/**
 * Get logs for an assignment. Filter by dateFrom, dateTo, action; paginate.
 * @param {ObjectId} assignmentId
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
export const getAssignmentLogs = async (assignmentId, filter, options) => {
  const logFilter = { assignmentId };
  if (filter.dateFrom || filter.dateTo) {
    logFilter.createdAt = {};
    if (filter.dateFrom) logFilter.createdAt.$gte = new Date(filter.dateFrom);
    if (filter.dateTo) logFilter.createdAt.$lte = new Date(filter.dateTo);
  }
  if (filter.action) logFilter.action = filter.action;

  const result = await MachineOrderAssignmentLog.paginate(logFilter, {
    ...options,
    sortBy: options.sortBy || 'createdAt:desc',
    populate: 'userId',
  });
  return result;
};

/**
 * Get logs for a user (all assignments they changed). Filter by date, action, assignmentId.
 * @param {ObjectId} userId
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
export const getAssignmentLogsByUser = async (userId, filter, options) => {
  const logFilter = { userId };
  if (filter.assignmentId) logFilter.assignmentId = filter.assignmentId;
  if (filter.dateFrom || filter.dateTo) {
    logFilter.createdAt = {};
    if (filter.dateFrom) logFilter.createdAt.$gte = new Date(filter.dateFrom);
    if (filter.dateTo) logFilter.createdAt.$lte = new Date(filter.dateTo);
  }
  if (filter.action) logFilter.action = filter.action;

  const result = await MachineOrderAssignmentLog.paginate(logFilter, {
    ...options,
    sortBy: options.sortBy || 'createdAt:desc',
    populate: ['assignmentId', 'userId'],
  });
  return result;
};
