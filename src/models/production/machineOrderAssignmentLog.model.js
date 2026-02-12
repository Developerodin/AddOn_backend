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
    /** User who made the change (from token / request) */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
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
 * Create an audit log entry. Call from service/controller after save with userId from token.
 * @param {Object} opts
 * @param {ObjectId} opts.assignmentId - MachineOrderAssignment _id
 * @param {ObjectId} opts.userId - User _id (from req.user or token)
 * @param {string} opts.action - e.g. 'Assignment Updated', 'Active Needle Changed'
 * @param {Array<{field: string, previousValue: *, newValue: *}>} [opts.changes] - List of field changes
 * @param {string} [opts.remarks]
 * @returns {Promise<Document>}
 */
machineOrderAssignmentLogSchema.statics.createLogEntry = async function (opts) {
  const { assignmentId, userId, action, changes = [], remarks = '' } = opts;
  if (!assignmentId || !userId || !action) {
    throw new Error('assignmentId, userId, and action are required for MachineOrderAssignmentLog');
  }
  const doc = new this({
    assignmentId,
    userId,
    action,
    changes,
    remarks,
  });
  return doc.save();
};

const MachineOrderAssignmentLog = mongoose.model('MachineOrderAssignmentLog', machineOrderAssignmentLogSchema);

export default MachineOrderAssignmentLog;
