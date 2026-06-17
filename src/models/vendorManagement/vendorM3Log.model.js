import mongoose from 'mongoose';
import { M3LogType } from '../production/enums.js';
import paginate from '../plugins/paginate.plugin.js';

/** Vendor QC floors that can originate M3 ledger entries */
export const VENDOR_M3_SOURCE_FLOORS = ['secondaryChecking', 'finalChecking'];

/**
 * Vendor M3 ledger log — tracks M3 entries from vendor QC floors and outward actions.
 */
const vendorM3LogSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    type: { type: String, required: true, enum: Object.values(M3LogType), index: true },
    vendorProductionFlowId: { type: String, required: true, index: true },
    referenceCode: { type: String, default: '', index: true },
    vpoNumber: { type: String, default: '', index: true },
    sourceFloor: {
      type: String,
      enum: [...VENDOR_M3_SOURCE_FLOORS, null],
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
  { timestamps: true, collection: 'vendor_m3_logs' }
);

vendorM3LogSchema.index({ vendorProductionFlowId: 1, timestamp: -1 });
vendorM3LogSchema.index({ type: 1, timestamp: -1 });
vendorM3LogSchema.index({ sourceFloor: 1, timestamp: -1 });

vendorM3LogSchema.plugin(paginate);

/**
 * Create a new vendor M3 ledger log entry.
 * @param {Object} logData
 * @returns {Promise<import('mongoose').Document>}
 */
vendorM3LogSchema.statics.createLogEntry = function createLogEntry(logData) {
  const log = new this({
    id: `VM3LOG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ...logData,
    timestamp: logData.timestamp || new Date(),
  });
  return log.save();
};

const VendorM3Log = mongoose.model('VendorM3Log', vendorM3LogSchema);

export default VendorM3Log;
