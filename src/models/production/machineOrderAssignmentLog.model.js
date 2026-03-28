import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

/**
 * MachineOrderAssignmentLog Model
 * Audit log for machine order assignment changes. Call createLogEntry from your
 * service/controller after updating an assignment (userId from token).
 * Query by assignmentId, userId, or date for proper audit trail.
 */
const machineOrderAssignmentLogSchema = new mongoose.Schema(
  {
    /** Assignment this log belongs to */
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MachineOrderAssignment',
      required: true,
      index: true,
    },
    /** User who made the change; omitted when audit is system/order sync (see auditSource). */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      index: true,
    },
    /** How this row was produced — use when userId is missing (optional JWT, cron, order sync). */
    auditSource: {
      type: String,
      enum: ['user', 'system', 'order_sync'],
      default: 'user',
      index: true,
    },
    /** Full assignment document before the change (JSON-safe plain object). */
    snapshotBefore: {
      type: mongoose.Schema.Types.Mixed,
    },
    /** Full assignment document after the change. */
    snapshotAfter: {
      type: mongoose.Schema.Types.Mixed,
    },
    /** Action summary (e.g. OrderStatus / LogAction or free text) */
    action: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    /** Per-field changes for detailed audit */
    changes: [
      {
        field: { type: String, required: true },
        previousValue: { type: mongoose.Schema.Types.Mixed },
        newValue: { type: mongoose.Schema.Types.Mixed },
      },
    ],
    /** Optional short reason or context */
    remarks: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
    collection: 'machine_order_assignment_logs',
  }
);

machineOrderAssignmentLogSchema.plugin(toJSON);
machineOrderAssignmentLogSchema.plugin(paginate);

machineOrderAssignmentLogSchema.index({ assignmentId: 1, createdAt: -1 });
machineOrderAssignmentLogSchema.index({ userId: 1, createdAt: -1 });
machineOrderAssignmentLogSchema.index({ createdAt: -1 });

/**
 * Create an audit log entry. userId optional when JWT missing — auditSource becomes system/order_sync.
 * @param {Object} opts
 * @param {ObjectId} opts.assignmentId - MachineOrderAssignment _id
 * @param {ObjectId} [opts.userId] - User _id when authenticated
 * @param {string} opts.action - e.g. 'Assignment Updated', 'Active Needle Changed'
 * @param {Array<{field: string, previousValue: *, newValue: *}>} [opts.changes] - List of field changes
 * @param {string} [opts.remarks]
 * @param {Object} [opts.snapshotBefore] - Full assignment snapshot before change
 * @param {Object} [opts.snapshotAfter] - Full assignment snapshot after change
 * @param {'user'|'system'|'order_sync'} [opts.auditSource]
 * @returns {Promise<Document>}
 */
machineOrderAssignmentLogSchema.statics.createLogEntry = async function (opts) {
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
  if (!assignmentId || !action) {
    throw new Error('assignmentId and action are required for MachineOrderAssignmentLog');
  }
  const resolvedSource =
    auditSource ?? (userId ? 'user' : 'system');
  const doc = new this({
    assignmentId,
    userId: userId || undefined,
    auditSource: resolvedSource,
    action,
    changes,
    remarks,
    ...(snapshotBefore !== undefined && { snapshotBefore }),
    ...(snapshotAfter !== undefined && { snapshotAfter }),
  });
  return doc.save();
};

const MachineOrderAssignmentLog = mongoose.model('MachineOrderAssignmentLog', machineOrderAssignmentLogSchema);

export default MachineOrderAssignmentLog;
