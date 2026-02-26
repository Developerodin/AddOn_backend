import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import Machine from '../../models/machine.model.js';
import MachineOrderAssignment from '../../models/production/machineOrderAssignment.model.js';
import MachineOrderAssignmentLog from '../../models/production/machineOrderAssignmentLog.model.js';
import { LogAction, OrderStatus, YarnIssueStatus, YarnReturnStatus } from '../../models/production/enums.js';

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

/** Number of top-priority items to return per assignment */
const TOP_ITEMS_LIMIT = 2;

/** Item statuses that exclude an order from top-items (once all items are in these, order is hidden). */
const EXCLUDED_ITEM_STATUSES = [OrderStatus.COMPLETED, OrderStatus.ON_HOLD];

/**
 * Get all machine order assignments that have at least one productionOrderItem with
 * status not Completed/On Hold. Returns each assignment with only the top 2 such items by priority.
 * Once an item's status becomes Completed or On Hold, it is excluded; when all items are Completed/On Hold, the order no longer appears.
 * @returns {Promise<Object[]>} Array of assignment objects with productionOrderItems limited to top 2 (active items only)
 */
export const getMachineOrderAssignmentsTopItems = async () => {
  const assignments = await MachineOrderAssignment.find({
    'productionOrderItems.0': { $exists: true },
    productionOrderItems: { $elemMatch: { status: { $nin: EXCLUDED_ITEM_STATUSES } } },
    isActive: true,
  })
    .populate('machine')
    .populate('productionOrderItems.productionOrder')
    .populate('productionOrderItems.article')
    .lean();
  return assignments.map((doc) => {
    const items = (doc.productionOrderItems || []).filter(
      (i) => !EXCLUDED_ITEM_STATUSES.includes(String(i.status))
    );
    const topTwo = [...items]
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .slice(0, TOP_ITEMS_LIMIT);
    return { ...doc, productionOrderItems: topTwo };
  });
};

/**
 * Get all machine order assignments that have at least one productionOrderItem with
 * yarnIssueStatus Completed and status Completed. Returns each assignment with all such items (no priority, no limit).
 * @returns {Promise<Object[]>} Array of assignment objects with productionOrderItems = all completed items only
 */
export const getMachineOrderAssignmentsCompletedItems = async () => {
  const assignments = await MachineOrderAssignment.find({
    'productionOrderItems.0': { $exists: true },
    'productionOrderItems.yarnIssueStatus': YarnIssueStatus.COMPLETED,
    'productionOrderItems.status': OrderStatus.COMPLETED,
    isActive: true,
  })
    .populate('machine')
    .populate('productionOrderItems.productionOrder')
    .populate('productionOrderItems.article')
    .lean();
  return assignments.map((doc) => {
    const items = (doc.productionOrderItems || []).filter(
      (i) =>
        String(i.yarnIssueStatus) === YarnIssueStatus.COMPLETED && String(i.status) === OrderStatus.COMPLETED
    );
    return { ...doc, productionOrderItems: items };
  });
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
        // Same item: update only fields that are sent (status, priority, yarnIssueStatus, yarnReturnStatus)
        const existing = current[existingIdx];
        if (item.status !== undefined && String(existing.status) !== String(item.status)) {
          const newStatusVal = String(item.status);
          if (newStatusVal === OrderStatus.IN_PROGRESS || newStatusVal === OrderStatus.COMPLETED) {
            if (String(existing.yarnIssueStatus) !== YarnIssueStatus.COMPLETED) {
              throw new ApiError(
                httpStatus.BAD_REQUEST,
                'Cannot set item status to In Progress or Completed until yarn issue is Completed. Update yarnIssueStatus to Completed first.'
              );
            }
          }
          existing.status = item.status;
          didChange = true;
        }
        if (item.yarnIssueStatus !== undefined && String(existing.yarnIssueStatus) !== String(item.yarnIssueStatus)) {
          existing.yarnIssueStatus = item.yarnIssueStatus;
          didChange = true;
        }
        if (item.yarnReturnStatus !== undefined && String(existing.yarnReturnStatus) !== String(item.yarnReturnStatus)) {
          existing.yarnReturnStatus = item.yarnReturnStatus;
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

  // Log completed items before save (pre-save will remove them and recompact priorities).
  const completedItems = (assignment.productionOrderItems || []).filter(
    (i) => String(i.status) === OrderStatus.COMPLETED
  );
  if (completedItems.length > 0 && userId) {
    await MachineOrderAssignmentLog.createLogEntry({
      assignmentId: assignment._id,
      userId,
      action: LogAction.ASSIGNMENT_ITEM_COMPLETED_REMOVED,
      changes: completedItems.map((i) => ({
        field: 'productionOrderItems.removed',
        previousValue: {
          productionOrder: i.productionOrder,
          article: i.article,
          priority: i.priority,
        },
        newValue: 'completed_and_removed',
      })),
      remarks: 'Completed item(s) removed; priorities recompacted to 1,2,3...',
    });
  }

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
 * Update status of a single productionOrderItem. Only one item per assignment can be "In Progress"
 * at a time: user must change the current In Progress item to another status before setting a
 * different item to In Progress.
 * @param {ObjectId} assignmentId
 * @param {ObjectId} itemId - _id of the item in productionOrderItems
 * @param {Object} body - { status: OrderStatus }
 * @param {ObjectId} [userId]
 * @returns {Promise<MachineOrderAssignment>}
 */
export const updateProductionOrderItemStatusById = async (assignmentId, itemId, body, userId) => {
  const assignment = await MachineOrderAssignment.findById(assignmentId);
  if (!assignment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine order assignment not found');
  }
  const item = assignment.productionOrderItems?.id(itemId);
  if (!item) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Production order item not found in this assignment');
  }
  const newStatus = body.status;
  if (!newStatus || !Object.values(OrderStatus).includes(String(newStatus))) {
    throw new ApiError(httpStatus.BAD_REQUEST, `status must be one of: ${Object.values(OrderStatus).join(', ')}`);
  }
  const previousStatus = item.status;

  if (String(newStatus) === OrderStatus.IN_PROGRESS || String(newStatus) === OrderStatus.COMPLETED) {
    if (String(item.yarnIssueStatus) !== YarnIssueStatus.COMPLETED) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot set status to In Progress or Completed until yarn issue is Completed. Update yarnIssueStatus to Completed first.'
      );
    }
  }

  if (String(newStatus) === OrderStatus.IN_PROGRESS) {
    const otherInProgress = assignment.productionOrderItems.find(
      (other) => other._id.toString() !== itemId.toString() && String(other.status) === OrderStatus.IN_PROGRESS
    );
    if (otherInProgress) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Another item is already In Progress. Change that item to another status (e.g. Pending or Completed) before setting this item to In Progress.'
      );
    }
  }

  item.status = newStatus;
  if ([OrderStatus.CANCELLED, OrderStatus.ON_HOLD, OrderStatus.COMPLETED].includes(String(newStatus))) {
    item.set('priority', undefined);
  }
  assignment.markModified('productionOrderItems');
  await assignment.save();

  if (userId) {
    const changes = [{ field: 'productionOrderItems.status', previousValue: previousStatus, newValue: newStatus }];
    await MachineOrderAssignmentLog.createLogEntry({
      assignmentId: assignment._id,
      userId,
      action: LogAction.ASSIGNMENT_ITEM_STATUS_CHANGED,
      changes,
      remarks: `Item status updated to ${newStatus}`,
    });
  }

  return MachineOrderAssignment.findById(assignmentId)
    .populate('machine')
    .populate('productionOrderItems.productionOrder')
    .populate('productionOrderItems.article');
};

/**
 * Update yarn issue status of a single productionOrderItem.
 * @param {ObjectId} assignmentId
 * @param {ObjectId} itemId
 * @param {Object} body - { yarnIssueStatus: YarnIssueStatus }
 * @param {ObjectId} [userId]
 * @returns {Promise<MachineOrderAssignment>}
 */
export const updateProductionOrderItemYarnIssueStatusById = async (assignmentId, itemId, body, userId) => {
  const assignment = await MachineOrderAssignment.findById(assignmentId);
  if (!assignment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine order assignment not found');
  }
  const item = assignment.productionOrderItems?.id(itemId);
  if (!item) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Production order item not found in this assignment');
  }
  const newStatus = body.yarnIssueStatus;
  if (!newStatus || !Object.values(YarnIssueStatus).includes(String(newStatus))) {
    throw new ApiError(httpStatus.BAD_REQUEST, `yarnIssueStatus must be one of: ${Object.values(YarnIssueStatus).join(', ')}`);
  }
  const previous = item.yarnIssueStatus;
  item.yarnIssueStatus = newStatus;
  assignment.markModified('productionOrderItems');
  await assignment.save();
  if (userId) {
    await MachineOrderAssignmentLog.createLogEntry({
      assignmentId: assignment._id,
      userId,
      action: LogAction.ASSIGNMENT_ITEMS_UPDATED,
      changes: [
        { field: 'productionOrderItems.yarnIssueStatus', previousValue: previous, newValue: newStatus },
      ],
      remarks: `Item yarn issue status updated to ${newStatus}`,
    });
  }
  return MachineOrderAssignment.findById(assignmentId)
    .populate('machine')
    .populate('productionOrderItems.productionOrder')
    .populate('productionOrderItems.article');
};

/**
 * Update yarn return status of a single productionOrderItem.
 * @param {ObjectId} assignmentId
 * @param {ObjectId} itemId
 * @param {Object} body - { yarnReturnStatus: YarnReturnStatus }
 * @param {ObjectId} [userId]
 * @returns {Promise<MachineOrderAssignment>}
 */
export const updateProductionOrderItemYarnReturnStatusById = async (assignmentId, itemId, body, userId) => {
  const assignment = await MachineOrderAssignment.findById(assignmentId);
  if (!assignment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine order assignment not found');
  }
  const item = assignment.productionOrderItems?.id(itemId);
  if (!item) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Production order item not found in this assignment');
  }
  const newStatus = body.yarnReturnStatus;
  if (!newStatus || !Object.values(YarnReturnStatus).includes(String(newStatus))) {
    throw new ApiError(httpStatus.BAD_REQUEST, `yarnReturnStatus must be one of: ${Object.values(YarnReturnStatus).join(', ')}`);
  }
  const previous = item.yarnReturnStatus;
  item.yarnReturnStatus = newStatus;
  assignment.markModified('productionOrderItems');
  await assignment.save();
  if (userId) {
    await MachineOrderAssignmentLog.createLogEntry({
      assignmentId: assignment._id,
      userId,
      action: LogAction.ASSIGNMENT_ITEMS_UPDATED,
      changes: [
        { field: 'productionOrderItems.yarnReturnStatus', previousValue: previous, newValue: newStatus },
      ],
      remarks: `Item yarn return status updated to ${newStatus}`,
    });
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
