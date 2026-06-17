import mongoose from 'mongoose';
import { M2EntryStatus, M2LogType } from '../production/enums.js';
import paginate from '../plugins/paginate.plugin.js';

/** Vendor QC floors that can originate M2 ledger entries */
export const VENDOR_M2_SOURCE_FLOORS = ['secondaryChecking', 'finalChecking'];

/**
 * Vendor M2 ledger log — tracks M2 entries from vendor QC floors and resolution actions.
 */
const vendorM2LogSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    entryId: { type: String, index: true },
    type: { type: String, required: true, enum: Object.values(M2LogType), index: true },
    status: {
      type: String,
      enum: [...Object.values(M2EntryStatus), null],
      default: null,
    },
    originalQuantity: { type: Number, default: 0, min: 0 },
    remainingQuantity: { type: Number, default: 0, min: 0 },
    vendorProductionFlowId: { type: String, required: true, index: true },
    referenceCode: { type: String, default: '', index: true },
    vpoNumber: { type: String, default: '', index: true },
    sourceFloor: {
      type: String,
      enum: [...VENDOR_M2_SOURCE_FLOORS, null],
      default: null,
    },
    quantity: { type: Number, required: true, min: 0 },
    cascadeFloors: { type: [String], default: [] },
    remarks: { type: String, default: '' },
    userId: { type: String, required: true, index: true },
    userName: { type: String, default: '' },
    userEmail: { type: String, default: '' },
    floorSupervisorId: { type: String, required: true },
    timestamp: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true, collection: 'vendor_m2_logs' }
);

vendorM2LogSchema.index({ entryId: 1, timestamp: -1 });
vendorM2LogSchema.index({ vendorProductionFlowId: 1, timestamp: -1 });
vendorM2LogSchema.index({ type: 1, status: 1, timestamp: -1 });
vendorM2LogSchema.index({ sourceFloor: 1, timestamp: -1 });

vendorM2LogSchema.plugin(paginate);

/**
 * Create a new vendor M2 ledger log entry.
 * @param {Object} logData
 * @returns {Promise<import('mongoose').Document>}
 */
vendorM2LogSchema.statics.createLogEntry = function createLogEntry(logData) {
  const log = new this({
    id: `VM2LOG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ...logData,
    timestamp: logData.timestamp || new Date(),
  });
  return log.save();
};

const VendorM2Log = mongoose.model('VendorM2Log', vendorM2LogSchema);

export default VendorM2Log;
