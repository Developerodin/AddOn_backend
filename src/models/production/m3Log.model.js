import mongoose from 'mongoose';
import { M3LogType, ProductionFloor } from './enums.js';
import paginate from '../plugins/paginate.plugin.js';

const M3_SOURCE_FLOORS = [
  ProductionFloor.CHECKING,
  ProductionFloor.SECONDARY_CHECKING,
  ProductionFloor.FINAL_CHECKING,
];

/**
 * M3 ledger log — tracks M3 entries from checking floors and outward actions.
 */
const m3LogSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    type: { type: String, required: true, enum: Object.values(M3LogType), index: true },
    articleId: { type: String, required: true, index: true },
    orderId: { type: String, required: true, index: true },
    orderNumber: { type: String, default: '', index: true },
    articleNumber: { type: String, default: '', index: true },
    sourceFloor: {
      type: String,
      enum: [...M3_SOURCE_FLOORS, null],
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
  { timestamps: true, collection: 'm3_logs' }
);

m3LogSchema.index({ articleId: 1, timestamp: -1 });
m3LogSchema.index({ orderId: 1, timestamp: -1 });
m3LogSchema.index({ type: 1, timestamp: -1 });
m3LogSchema.index({ sourceFloor: 1, timestamp: -1 });

m3LogSchema.plugin(paginate);

/**
 * Create a new M3 ledger log entry.
 * @param {Object} logData
 * @returns {Promise<import('mongoose').Document>}
 */
m3LogSchema.statics.createLogEntry = function createLogEntry(logData) {
  const log = new this({
    id: `M3LOG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ...logData,
    timestamp: logData.timestamp || new Date(),
  });
  return log.save();
};

const M3Log = mongoose.model('M3Log', m3LogSchema);

export default M3Log;
export { M3_SOURCE_FLOORS };
