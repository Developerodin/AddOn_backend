import mongoose from 'mongoose';
import { OrderStatus } from './enums.js';
import { toJSON, paginate } from '../plugins/index.js';

/**
 * MachineOrderAssignment Model
 * Links a machine (with active needle) to production order items (PO + article per item).
 * Each document = one machine + its active needle + array of (production order, article) assignments.
 * Priority and queue order are set by the client; no server-side auto-assignment.
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
        /** Queue position set by client (optional). */
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
