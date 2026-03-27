import MachineOrderAssignmentLog from '../../models/production/machineOrderAssignmentLog.model.js';

/**
 * JSON-safe snapshot of a Mongoose doc or plain object (ObjectIds → strings).
 * @param {import('mongoose').Document|Object|null} doc
 * @returns {Object|null}
 */
export function snapshotAssignment(doc) {
  if (!doc) return null;
  try {
    const plain = doc.toObject ? doc.toObject({ virtuals: false }) : { ...doc };
    return JSON.parse(JSON.stringify(plain));
  } catch {
    return null;
  }
}

/**
 * Persist assignment audit row. Always writes (no silent skip when userId missing).
 * @param {Object} opts
 * @param {import('mongoose').Types.ObjectId} opts.assignmentId
 * @param {import('mongoose').Types.ObjectId} [opts.userId]
 * @param {string} opts.action
 * @param {Array} [opts.changes]
 * @param {string} [opts.remarks]
 * @param {Object|null} [opts.snapshotBefore]
 * @param {Object|null} [opts.snapshotAfter]
 * @param {'user'|'system'|'order_sync'} [opts.auditSource] - default: user if userId set, else system
 */
export async function writeAssignmentAuditLog(opts) {
  const {
    assignmentId,
    userId,
    action,
    changes = [],
    remarks = '',
    snapshotBefore,
    snapshotAfter,
    auditSource,
  } = opts;
  return MachineOrderAssignmentLog.createLogEntry({
    assignmentId,
    userId,
    action,
    changes,
    remarks,
    snapshotBefore,
    snapshotAfter,
    auditSource: auditSource ?? (userId ? 'user' : 'system'),
  });
}

/**
 * Build change rows for one productionOrderItems subdoc when merge PATCH updates fields.
 */
export function pushItemFieldChanges(changes, existing, updates, itemLabel) {
  const label = itemLabel || String(existing._id);
  if (updates.status !== undefined && String(existing.status) !== String(updates.status)) {
    changes.push({
      field: `productionOrderItems[${label}].status`,
      previousValue: existing.status,
      newValue: updates.status,
    });
  }
  if (updates.yarnIssueStatus !== undefined && String(existing.yarnIssueStatus) !== String(updates.yarnIssueStatus)) {
    changes.push({
      field: `productionOrderItems[${label}].yarnIssueStatus`,
      previousValue: existing.yarnIssueStatus,
      newValue: updates.yarnIssueStatus,
    });
  }
  if (updates.yarnReturnStatus !== undefined && String(existing.yarnReturnStatus) !== String(updates.yarnReturnStatus)) {
    changes.push({
      field: `productionOrderItems[${label}].yarnReturnStatus`,
      previousValue: existing.yarnReturnStatus,
      newValue: updates.yarnReturnStatus,
    });
  }
  if (updates.priority !== undefined && Number(existing.priority) !== Number(updates.priority)) {
    changes.push({
      field: `productionOrderItems[${label}].priority`,
      previousValue: existing.priority,
      newValue: updates.priority,
    });
  }
}
