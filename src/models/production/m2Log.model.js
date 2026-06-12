import mongoose from 'mongoose';
import { M2EntryStatus, M2LogType, ProductionFloor } from './enums.js';
import paginate from '../plugins/paginate.plugin.js';

const M2_SOURCE_FLOORS = [
  ProductionFloor.CHECKING,
  ProductionFloor.SECONDARY_CHECKING,
  ProductionFloor.FINAL_CHECKING,
];

/**
 * M2 ledger log — tracks M2 entries from QC floors and resolution actions.
 */
const m2LogSchema = new mongoose.Schema(
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
    articleId: { type: String, required: true, index: true },
    orderId: { type: String, required: true, index: true },
    orderNumber: { type: String, default: '', index: true },
    articleNumber: { type: String, default: '', index: true },
    sourceFloor: {
      type: String,
      enum: [...M2_SOURCE_FLOORS, null],
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
  { timestamps: true, collection: 'm2_logs' }
);

m2LogSchema.index({ entryId: 1, timestamp: -1 });
m2LogSchema.index({ articleId: 1, timestamp: -1 });
m2LogSchema.index({ orderId: 1, timestamp: -1 });
m2LogSchema.index({ type: 1, status: 1, timestamp: -1 });
m2LogSchema.index({ sourceFloor: 1, timestamp: -1 });

m2LogSchema.plugin(paginate);

/**
 * Create a new M2 ledger log entry.
 * @param {Object} logData
 * @returns {Promise<import('mongoose').Document>}
 */
m2LogSchema.statics.createLogEntry = function createLogEntry(logData) {
  const log = new this({
    id: `M2LOG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ...logData,
    timestamp: logData.timestamp || new Date(),
  });
  return log.save();
};

const M2Log = mongoose.model('M2Log', m2LogSchema);

export default M2Log;
export { M2_SOURCE_FLOORS };
