import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import Machine from '../../models/machine.model.js';
import MachineOrderAssignment, { isItemFullyCompleted } from '../../models/production/machineOrderAssignment.model.js';
import MachineOrderAssignmentLog from '../../models/production/machineOrderAssignmentLog.model.js';
import { LogAction, OrderStatus, YarnIssueStatus, YarnReturnStatus } from '../../models/production/enums.js';
import {
  snapshotAssignment,
  writeAssignmentAuditLog,
  pushItemFieldChanges,
} from './machineOrderAssignmentAudit.helper.js';

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
  await writeAssignmentAuditLog({
    assignmentId: assignment._id,
    userId,
    action: LogAction.ASSIGNMENT_CREATED,
    changes: [
      { field: 'machine', previousValue: null, newValue: body.machine },
      { field: 'activeNeedle', previousValue: null, newValue: body.activeNeedle },
      { field: 'productionOrderItems', previousValue: null, newValue: body.productionOrderItems?.length ?? 0 },
    ],
    remarks: 'Assignment created',
    snapshotBefore: null,
    snapshotAfter: snapshotAssignment(assignment),
    auditSource: userId ? 'user' : 'system',
  });
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
 * Remove (productionOrder, article) pairs from all assignments except the given one.
 * Ensures an item exists on only one machine when moved.
 * @param {ObjectId} excludeAssignmentId - Assignment to keep items in
 * @param {Array<{productionOrder: ObjectId, article: ObjectId}>} items
 * @returns {Promise<number>} Number of assignments modified
 */
const removeItemsFromOtherAssignments = async (excludeAssignmentId, items) => {
  if (!items?.length) return 0;
  let modifiedCount = 0;
  for (const item of items) {
    const poId = item.productionOrder?.toString?.() || item.productionOrder;
    const artId = item.article?.toString?.() || item.article;
    if (!poId || !artId) continue;
    const result = await MachineOrderAssignment.updateMany(
      {
        _id: { $ne: excludeAssignmentId },
        productionOrderItems: { $elemMatch: { productionOrder: poId, article: artId } },
      },
      { $pull: { productionOrderItems: { productionOrder: poId, article: artId } } }
    );
    modifiedCount += result.modifiedCount ?? 0;
  }
  return modifiedCount;
};

/**
 * Update assignment by id. Builds change list and creates audit log with userId.
 * When adding items (via addProductionOrderItems or merge), removes those items from other machine assignments.
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
  const snapshotBeforeUpdate = snapshotAssignment(assignment);
  const changes = [];

  /** Dedupe key for productionOrderItems: same (productionOrder, article) = same queue entry */
  const itemKey = (i) => `${(i.productionOrder && i.productionOrder.toString?.()) || i.productionOrder}_${(i.article && i.article.toString?.()) || i.article}`;

  // Append items when addProductionOrderItems is sent; do not replace array in that case.
  const toAssign = { ...updateBody };
  if (toAssign.addProductionOrderItems != null) {
    const toAdd = Array.isArray(toAssign.addProductionOrderItems) ? toAssign.addProductionOrderItems : [];
    await removeItemsFromOtherAssignments(assignmentId, toAdd);
    for (const row of toAdd) {
      changes.push({
        field: 'productionOrderItems.added',
        previousValue: null,
        newValue: snapshotAssignment(row),
      });
    }
    assignment.productionOrderItems.push(...toAdd);
    assignment.markModified('productionOrderItems');
    delete toAssign.addProductionOrderItems;
    delete toAssign.productionOrderItems;
  } else if (toAssign.productionOrderItems !== undefined && Array.isArray(toAssign.productionOrderItems)) {
    // Merge: existing items get only their changed fields updated; new items are appended.
    const current = assignment.productionOrderItems || [];
    const keyToIndex = new Map();
    current.forEach((c, idx) => {
      keyToIndex.set(itemKey(c), idx);
    });
    const newlyAddedItems = [];
    let didChange = false;
    for (const item of toAssign.productionOrderItems) {
      const k = itemKey(item);
      const existingIdx = keyToIndex.get(k);
      if (existingIdx !== undefined) {
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
        }
        pushItemFieldChanges(changes, existing, item, String(existing._id));
        if (item.status !== undefined && String(existing.status) !== String(item.status)) {
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
        newlyAddedItems.push(item);
        changes.push({
          field: 'productionOrderItems.added',
          previousValue: null,
          newValue: { ...snapshotAssignment(item), queueKey: k },
        });
        current.push(item);
        keyToIndex.set(k, current.length - 1);
        didChange = true;
      }
    }
    if (newlyAddedItems.length > 0) {
      await removeItemsFromOtherAssignments(assignmentId, newlyAddedItems);
    }
    if (didChange) {
      assignment.productionOrderItems = current;
      assignment.markModified('productionOrderItems');
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
  if (toAssign.isActive !== undefined && toAssign.isActive !== previous.isActive) {
    changes.push({ field: 'isActive', previousValue: previous.isActive, newValue: toAssign.isActive });
  }

  Object.assign(assignment, toAssign);

  // Pre-save removes rows when order + yarn issue + yarn return are all Completed — log removal with full item snapshot.
  const itemsPendingFullRemoval = (assignment.productionOrderItems || []).filter(isItemFullyCompleted);
  for (const i of itemsPendingFullRemoval) {
    changes.push({
      field: 'productionOrderItems.removed',
      previousValue: snapshotAssignment(i),
      newValue: {
        reason: 'fully_completed',
        status: OrderStatus.COMPLETED,
        yarnIssueStatus: YarnIssueStatus.COMPLETED,
        yarnReturnStatus: YarnReturnStatus.COMPLETED,
        removedAt: new Date().toISOString(),
      },
    });
  }

  await assignment.save();

  const fresh = await MachineOrderAssignment.findById(assignmentId);
  const snapshotAfterUpdate = snapshotAssignment(fresh);

  if (changes.length > 0) {
    const itemFieldPrefixes = (c) =>
      typeof c.field === 'string' &&
      (c.field.startsWith('productionOrderItems[') ||
        c.field.startsWith('productionOrderItems.added') ||
        c.field === 'productionOrderItems.removed');
    const onlyActiveNeedle =
      changes.length === 1 && changes[0].field === 'activeNeedle';
    const onlyCompletedRemovals =
      changes.length > 0 &&
      changes.every((c) => c.field === 'productionOrderItems.removed' && c.newValue?.reason === 'fully_completed');
    let action = LogAction.ASSIGNMENT_UPDATED;
    if (onlyActiveNeedle) {
      action = LogAction.ASSIGNMENT_ACTIVE_NEEDLE_CHANGED;
    } else if (onlyCompletedRemovals) {
      action = LogAction.ASSIGNMENT_ITEM_COMPLETED_REMOVED;
    } else if (changes.some(itemFieldPrefixes)) {
      action = LogAction.ASSIGNMENT_ITEMS_UPDATED;
    }
    await writeAssignmentAuditLog({
      assignmentId: assignment._id,
      userId,
      action,
      changes,
      remarks: updateBody.remarks || '',
      snapshotBefore: snapshotBeforeUpdate,
      snapshotAfter: snapshotAfterUpdate,
      auditSource: userId ? 'user' : 'system',
    });
  }
  return fresh || assignment;
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
  const snapshotBefore = snapshotAssignment(assignment);
  const previousPriority = item.priority;
  if (body.priority !== undefined && body.priority !== previousPriority) {
    item.priority = body.priority;
    assignment.markModified('productionOrderItems');
    await assignment.save();
    const fresh = await MachineOrderAssignment.findById(assignmentId);
    await writeAssignmentAuditLog({
      assignmentId: assignment._id,
      userId,
      action: LogAction.ASSIGNMENT_ITEMS_UPDATED,
      changes: [
        {
          field: `productionOrderItems[${itemId}].priority`,
          previousValue: previousPriority,
          newValue: body.priority,
        },
      ],
      remarks: 'Item priority updated',
      snapshotBefore,
      snapshotAfter: snapshotAssignment(fresh),
      auditSource: userId ? 'user' : 'system',
    });
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
 * @param {Object} body - { status: OrderStatus [, yarnIssueStatus: YarnIssueStatus ] } - yarnIssueStatus applied first when both sent
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
  const snapshotBefore = snapshotAssignment(assignment);
  const itemBefore = snapshotAssignment(item);
  const newStatus = body.status;
  if (!newStatus || !Object.values(OrderStatus).includes(String(newStatus))) {
    throw new ApiError(httpStatus.BAD_REQUEST, `status must be one of: ${Object.values(OrderStatus).join(', ')}`);
  }
  const previousStatus = item.status;
  const previousYarnIssueStatus = item.yarnIssueStatus;

  // Allow yarnIssueStatus in same request - apply it first so status validation passes
  if (body.yarnIssueStatus !== undefined && String(item.yarnIssueStatus) !== String(body.yarnIssueStatus)) {
    item.yarnIssueStatus = body.yarnIssueStatus;
  }

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

  const fresh = await MachineOrderAssignment.findById(assignmentId);
  const removedByPreSave = fresh && !fresh.productionOrderItems?.id(itemId);
  const changes = [
    { field: `productionOrderItems[${itemId}].status`, previousValue: previousStatus, newValue: newStatus },
  ];
  if (body.yarnIssueStatus !== undefined && String(previousYarnIssueStatus) !== String(body.yarnIssueStatus)) {
    changes.push({
      field: `productionOrderItems[${itemId}].yarnIssueStatus`,
      previousValue: previousYarnIssueStatus,
      newValue: body.yarnIssueStatus,
    });
  }
  if (removedByPreSave) {
    changes.push({
      field: 'productionOrderItems.removed',
      previousValue: itemBefore,
      newValue: {
        reason: 'fully_completed',
        note: 'Removed by pre-save after all three statuses reached Completed',
        removedAt: new Date().toISOString(),
      },
    });
  }
  const action = removedByPreSave ? LogAction.ASSIGNMENT_ITEM_COMPLETED_REMOVED : LogAction.ASSIGNMENT_ITEM_STATUS_CHANGED;
  await writeAssignmentAuditLog({
    assignmentId: assignment._id,
    userId,
    action,
    changes,
    remarks: removedByPreSave
      ? 'Item fully completed and removed from machine queue'
      : `Item status updated to ${newStatus}`,
    snapshotBefore,
    snapshotAfter: snapshotAssignment(fresh),
    auditSource: userId ? 'user' : 'system',
  });

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
  const snapshotBefore = snapshotAssignment(assignment);
  const itemBefore = snapshotAssignment(item);
  const newStatus = body.yarnIssueStatus;
  if (!newStatus || !Object.values(YarnIssueStatus).includes(String(newStatus))) {
    throw new ApiError(httpStatus.BAD_REQUEST, `yarnIssueStatus must be one of: ${Object.values(YarnIssueStatus).join(', ')}`);
  }
  const previous = item.yarnIssueStatus;
  item.yarnIssueStatus = newStatus;
  assignment.markModified('productionOrderItems');
  await assignment.save();
  const fresh = await MachineOrderAssignment.findById(assignmentId);
  const removedByPreSave = fresh && !fresh.productionOrderItems?.id(itemId);
  const changes = [
    { field: `productionOrderItems[${itemId}].yarnIssueStatus`, previousValue: previous, newValue: newStatus },
  ];
  if (removedByPreSave) {
    changes.push({
      field: 'productionOrderItems.removed',
      previousValue: itemBefore,
      newValue: {
        reason: 'fully_completed',
        removedAt: new Date().toISOString(),
      },
    });
  }
  await writeAssignmentAuditLog({
    assignmentId: assignment._id,
    userId,
    action: removedByPreSave ? LogAction.ASSIGNMENT_ITEM_COMPLETED_REMOVED : LogAction.ASSIGNMENT_ITEMS_UPDATED,
    changes,
    remarks: `Item yarn issue status updated to ${newStatus}`,
    snapshotBefore,
    snapshotAfter: snapshotAssignment(fresh),
    auditSource: userId ? 'user' : 'system',
  });
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
  const snapshotBefore = snapshotAssignment(assignment);
  const itemBefore = snapshotAssignment(item);
  const newStatus = body.yarnReturnStatus;
  if (!newStatus || !Object.values(YarnReturnStatus).includes(String(newStatus))) {
    throw new ApiError(httpStatus.BAD_REQUEST, `yarnReturnStatus must be one of: ${Object.values(YarnReturnStatus).join(', ')}`);
  }
  const previous = item.yarnReturnStatus;
  item.yarnReturnStatus = newStatus;
  assignment.markModified('productionOrderItems');
  await assignment.save();
  const fresh = await MachineOrderAssignment.findById(assignmentId);
  const removedByPreSave = fresh && !fresh.productionOrderItems?.id(itemId);
  const changes = [
    { field: `productionOrderItems[${itemId}].yarnReturnStatus`, previousValue: previous, newValue: newStatus },
  ];
  if (removedByPreSave) {
    changes.push({
      field: 'productionOrderItems.removed',
      previousValue: itemBefore,
      newValue: {
        reason: 'fully_completed',
        removedAt: new Date().toISOString(),
      },
    });
  }
  await writeAssignmentAuditLog({
    assignmentId: assignment._id,
    userId,
    action: removedByPreSave ? LogAction.ASSIGNMENT_ITEM_COMPLETED_REMOVED : LogAction.ASSIGNMENT_ITEMS_UPDATED,
    changes,
    remarks: `Item yarn return status updated to ${newStatus}`,
    snapshotBefore,
    snapshotAfter: snapshotAssignment(fresh),
    auditSource: userId ? 'user' : 'system',
  });
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
  const snapshotBefore = snapshotAssignment(assignment);
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
    const fresh = await MachineOrderAssignment.findById(assignmentId);
    if (changes.length > 0) {
      await writeAssignmentAuditLog({
        assignmentId: assignment._id,
        userId,
        action: LogAction.ASSIGNMENT_ITEMS_UPDATED,
        changes,
        remarks: 'Item priorities updated',
        snapshotBefore,
        snapshotAfter: snapshotAssignment(fresh),
        auditSource: userId ? 'user' : 'system',
      });
    }
  }
  return MachineOrderAssignment.findById(assignmentId)
    .populate('machine')
    .populate('productionOrderItems.productionOrder')
    .populate('productionOrderItems.article');
};

/**
 * Delete a single productionOrderItem from the assignment by its subdocument _id.
 * @param {ObjectId} assignmentId
 * @param {ObjectId} itemId - _id of the item in productionOrderItems
 * @param {ObjectId} [userId]
 * @returns {Promise<MachineOrderAssignment>}
 */
export const deleteProductionOrderItemById = async (assignmentId, itemId, userId) => {
  const assignment = await MachineOrderAssignment.findById(assignmentId);
  if (!assignment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine order assignment not found');
  }
  const item = assignment.productionOrderItems?.id(itemId);
  if (!item) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Production order item not found in this assignment');
  }
  const snapshotBefore = snapshotAssignment(assignment);
  const removedItem = snapshotAssignment(item);
  assignment.productionOrderItems.pull(itemId);
  assignment.markModified('productionOrderItems');
  await assignment.save();
  const fresh = await MachineOrderAssignment.findById(assignmentId);
  await writeAssignmentAuditLog({
    assignmentId: assignment._id,
    userId,
    action: LogAction.ASSIGNMENT_ITEMS_UPDATED,
    changes: [
      {
        field: 'productionOrderItems.removed',
        previousValue: removedItem,
        newValue: { reason: 'manual_delete', deletedAt: new Date().toISOString() },
      },
    ],
    remarks: 'Production order item removed from assignment',
    snapshotBefore,
    snapshotAfter: snapshotAssignment(fresh),
    auditSource: userId ? 'user' : 'system',
  });
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
  const assignment = await MachineOrderAssignment.findById(assignmentId);
  if (!assignment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine order assignment not found');
  }
  const snapshotBefore = snapshotAssignment(assignment);
  const prevLen = assignment.productionOrderItems?.length ?? 0;
  assignment.productionOrderItems = [];
  assignment.markModified('productionOrderItems');
  await assignment.save();
  const fresh = await MachineOrderAssignment.findById(assignmentId);
  await writeAssignmentAuditLog({
    assignmentId,
    userId,
    action: LogAction.ASSIGNMENT_ITEMS_UPDATED,
    changes: [
      {
        field: 'productionOrderItems',
        previousValue: prevLen,
        newValue: 0,
        detail: 'queue_cleared',
      },
    ],
    remarks: 'Machine assignment queue reset',
    snapshotBefore,
    snapshotAfter: snapshotAssignment(fresh),
    auditSource: userId ? 'user' : 'system',
  });
  return fresh;
};

/**
 * Remove all productionOrderItems that reference a given production order.
 * Call this when a production order is deleted so machine queues stay in sync.
 * @param {ObjectId} orderId - Deleted production order id
 * @param {ObjectId} [userId] - When set, auditSource=user; otherwise order_sync
 * @returns {Promise<{ modifiedCount: number }>}
 */
export const removeProductionOrderFromAssignments = async (orderId, userId) => {
  const orderObjectId = orderId?.toString?.() || orderId;
  const assignments = await MachineOrderAssignment.find({
    'productionOrderItems.productionOrder': orderObjectId,
  });
  let modifiedCount = 0;
  for (const assignment of assignments) {
    const snapshotBefore = snapshotAssignment(assignment);
    const removed = (assignment.productionOrderItems || []).filter(
      (i) => String(i.productionOrder) === String(orderObjectId)
    );
    if (removed.length === 0) continue;
    const result = await MachineOrderAssignment.updateOne(
      { _id: assignment._id },
      { $pull: { productionOrderItems: { productionOrder: orderObjectId } } }
    );
    modifiedCount += result.modifiedCount ?? 0;
    const after = await MachineOrderAssignment.findById(assignment._id);
    await writeAssignmentAuditLog({
      assignmentId: assignment._id,
      userId,
      action: LogAction.ASSIGNMENT_SYNC_ORDER_REMOVED_FROM_QUEUE,
      changes: removed.map((row) => ({
        field: 'productionOrderItems.removed',
        previousValue: snapshotAssignment(row),
        newValue: { reason: 'production_order_deleted_or_sync', orderId: String(orderObjectId) },
      })),
      remarks: 'Production order removed from machine queue (order deleted or sync)',
      snapshotBefore,
      snapshotAfter: snapshotAssignment(after),
      auditSource: userId ? 'user' : 'order_sync',
    });
  }
  return { modifiedCount };
};

/**
 * Remove productionOrderItems that reference a specific (productionOrder, article) pair.
 * Call this when an article is removed from a production order so machine queues stay in sync.
 * @param {ObjectId} orderId - Production order id
 * @param {ObjectId} articleId - Article id removed from the order
 * @param {ObjectId} [userId]
 * @returns {Promise<{ modifiedCount: number }>}
 */
export const removeArticleFromAssignments = async (orderId, articleId, userId) => {
  const poId = orderId?.toString?.() || orderId;
  const artId = articleId?.toString?.() || articleId;
  if (!poId || !artId) return { modifiedCount: 0 };
  const assignments = await MachineOrderAssignment.find({
    productionOrderItems: { $elemMatch: { productionOrder: poId, article: artId } },
  });
  let modifiedCount = 0;
  for (const assignment of assignments) {
    const snapshotBefore = snapshotAssignment(assignment);
    const row = (assignment.productionOrderItems || []).find(
      (i) => String(i.productionOrder) === String(poId) && String(i.article) === String(artId)
    );
    const result = await MachineOrderAssignment.updateOne(
      { _id: assignment._id },
      { $pull: { productionOrderItems: { productionOrder: poId, article: artId } } }
    );
    modifiedCount += result.modifiedCount ?? 0;
    const after = await MachineOrderAssignment.findById(assignment._id);
    await writeAssignmentAuditLog({
      assignmentId: assignment._id,
      userId,
      action: LogAction.ASSIGNMENT_SYNC_ARTICLE_REMOVED_FROM_QUEUE,
      changes: [
        {
          field: 'productionOrderItems.removed',
          previousValue: row ? snapshotAssignment(row) : null,
          newValue: {
            reason: 'article_removed_from_production_order',
            orderId: String(poId),
            articleId: String(artId),
          },
        },
      ],
      remarks: 'Article removed from machine queue (article dropped from order)',
      snapshotBefore,
      snapshotAfter: snapshotAssignment(after),
      auditSource: userId ? 'user' : 'order_sync',
    });
  }
  return { modifiedCount };
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
  const snapshotBefore = snapshotAssignment(assignment);
  await MachineOrderAssignment.deleteOne({ _id: assignmentId });
  await writeAssignmentAuditLog({
    assignmentId,
    userId,
    action: LogAction.ASSIGNMENT_DEACTIVATED,
    changes: [{ field: 'deleted', previousValue: false, newValue: true }],
    remarks: 'Assignment deleted',
    snapshotBefore,
    snapshotAfter: null,
    auditSource: userId ? 'user' : 'system',
  });
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
