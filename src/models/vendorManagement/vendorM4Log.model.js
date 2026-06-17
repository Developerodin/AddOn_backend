import mongoose from 'mongoose';
import { M4LogType } from '../production/enums.js';
import paginate from '../plugins/paginate.plugin.js';

/** Vendor QC floors that can originate M4 ledger entries (final checking only) */
export const VENDOR_M4_SOURCE_FLOORS = ['finalChecking'];

/**
 * Vendor M4 ledger log — tracks M4 entries from final checking and outward actions.
 */
const vendorM4LogSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    type: { type: String, required: true, enum: Object.values(M4LogType), index: true },
    vendorProductionFlowId: { type: String, required: true, index: true },
    referenceCode: { type: String, default: '', index: true },
    vpoNumber: { type: String, default: '', index: true },
    sourceFloor: {
      type: String,
      enum: [...VENDOR_M4_SOURCE_FLOORS, null],
      default: null,
    },
    quantity: { type: Number, required: true, min: 0 },
    previousOnHand: { type: Number, default: 0, min: 0 },
    newOnHand: { type: Number, default: 0, min: 0 },
    previousOutwardTotal: { type: Number, default: 0, min: 0 },
    newOutwardTotal: { type: Number, default: 0, min: 0 },
    availableAfter: { type: Number, default: 0, min: 0 },
    remarks: { type: String, default: '' },
    userId: { type: String, required: true, index: true },
    userName: { type: String, default: '' },
    floorSupervisorId: { type: String, required: true },
    timestamp: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true, collection: 'vendor_m4_logs' }
);

vendorM4LogSchema.index({ vendorProductionFlowId: 1, timestamp: -1 });
vendorM4LogSchema.index({ type: 1, timestamp: -1 });
vendorM4LogSchema.index({ sourceFloor: 1, timestamp: -1 });

vendorM4LogSchema.plugin(paginate);

/**
 * Create a new vendor M4 ledger log entry.
 * @param {Object} logData
 * @returns {Promise<import('mongoose').Document>}
 */
vendorM4LogSchema.statics.createLogEntry = function createLogEntry(logData) {
  const log = new this({
    id: `VM4LOG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ...logData,
    timestamp: logData.timestamp || new Date(),
  });
  return log.save();
};

const VendorM4Log = mongoose.model('VendorM4Log', vendorM4LogSchema);

export default VendorM4Log;
