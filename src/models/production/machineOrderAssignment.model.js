import mongoose from 'mongoose';
import { OrderStatus, YarnIssueStatus } from './enums.js';
import { toJSON, paginate } from '../plugins/index.js';

/**
 * MachineOrderAssignment Model
 * Links a machine (with active needle) to production order items (PO + article per item).
 * Each document = one machine + its active needle + array of (production order, article) assignments.
 * Priority: optional from client; if not passed, auto-assigned as next available (1, 2, 3, ...).
 * Audit: use MachineOrderAssignmentLog.createLogEntry() in your service after update.
 */
const machineOrderAssignmentSchema = new mongoose.Schema(
  {
    /** Machine this assignment belongs to */
    machine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      required: true,
    },
    /** Active needle size for this machine (should match one of machine.needleSizeConfig[].needleSize) */
    activeNeedle: {
      type: String,
      required: true,
      trim: true,
    },
    /**
     * Array of production order items: each item links a production order and one of its articles.
     * Article must belong to the referenced production order.
     */
    productionOrderItems: [
      {
        productionOrder: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'ProductionOrder',
          required: false,
        },
        article: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Article',
          required: false,
        },
        status: {
          type: String,
          enum: Object.values(OrderStatus),
          default: OrderStatus.PENDING,
        },
        /** Yarn issue status for this item; default Pending. */
        yarnIssueStatus: {
          type: String,
          enum: Object.values(YarnIssueStatus),
          default: YarnIssueStatus.PENDING,
        },
        /** Queue position; set by client or auto-assigned (1, 2, 3, ...). Unset when status is Cancelled/On Hold/Completed. */
        priority: {
          type: Number,
          required: false,
          min: 1,
        },
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'machine_order_assignments',
  }
);

/** Statuses for which priority is not applicable; priority is cleared and not assigned. */
const STATUSES_WITH_NO_PRIORITY = [
  OrderStatus.CANCELLED,
  OrderStatus.ON_HOLD,
  OrderStatus.COMPLETED,
];

function hasNoPriorityStatus(item) {
  return item?.status != null && STATUSES_WITH_NO_PRIORITY.includes(String(item.status));
}

/**
 * Clear priority for items whose status is Cancelled, On Hold, or Completed.
 * Uses .set(undefined) so Mongoose persists the unset on save (delete does not always persist on subdocs).
 */
function clearPriorityForTerminalStatuses(items) {
  if (!items?.length) return;
  items.forEach((item) => {
    if (hasNoPriorityStatus(item)) {
      if (typeof item.set === 'function') {
        item.set('priority', undefined);
      } else {
        delete item.priority;
      }
    }
  });
}

/**
 * Auto-assign priority to productionOrderItems that don't have one and are not in a terminal status.
 * Priorities start at 1; new entries get next available (max existing + 1).
 * Items with status Cancelled/On Hold/Completed are left without priority.
 */
function assignMissingPriorities(items) {
  if (!items?.length) return;
  const assignable = items.filter((item) => !hasNoPriorityStatus(item));
  const withPriority = assignable.filter((item) => typeof item.priority === 'number' && item.priority >= 1);
  const maxPriority = withPriority.length ? Math.max(...withPriority.map((i) => i.priority)) : 0;
  let next = maxPriority + 1;
  assignable.forEach((item) => {
    if (typeof item.priority !== 'number' || item.priority < 1) {
      item.priority = next;
      next += 1;
    }
  });
}

/**
 * Remove productionOrderItems with status Completed. Does not overwrite existing priorities
 * so that user-set priorities (e.g. from PATCH /items) are preserved.
 */
export function removeCompletedAndRecompactPriorities(items) {
  if (!items?.length) return items;
  return items.filter((item) => String(item.status) !== OrderStatus.COMPLETED);
}

machineOrderAssignmentSchema.pre('save', function autoRemoveCompletedAndPriorities(next) {
  const items = this.productionOrderItems || [];
  clearPriorityForTerminalStatuses(items);
  this.productionOrderItems = removeCompletedAndRecompactPriorities(items);
  assignMissingPriorities(this.productionOrderItems);
  this.markModified('productionOrderItems');
  next();
});

machineOrderAssignmentSchema.plugin(toJSON);
machineOrderAssignmentSchema.plugin(paginate);

// Indexes for common queries
machineOrderAssignmentSchema.index({ machine: 1 });
machineOrderAssignmentSchema.index({ activeNeedle: 1 });
machineOrderAssignmentSchema.index({ 'productionOrderItems.productionOrder': 1 });
machineOrderAssignmentSchema.index({ 'productionOrderItems.article': 1 });
machineOrderAssignmentSchema.index({ 'productionOrderItems.status': 1 });
machineOrderAssignmentSchema.index({ 'productionOrderItems.priority': 1 });
machineOrderAssignmentSchema.index({ isActive: 1 });

const MachineOrderAssignment = mongoose.model('MachineOrderAssignment', machineOrderAssignmentSchema);

export default MachineOrderAssignment;
