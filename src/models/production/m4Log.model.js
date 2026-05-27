import mongoose from 'mongoose';
import { M4LogType, ProductionFloor } from './enums.js';
import paginate from '../plugins/paginate.plugin.js';

const M4_SOURCE_FLOORS = [
  ProductionFloor.KNITTING,
  ProductionFloor.CHECKING,
  ProductionFloor.SECONDARY_CHECKING,
  ProductionFloor.FINAL_CHECKING,
];

/**
 * M4 ledger log — tracks M4 entries from floors and outward actions from M4 Management.
 */
const m4LogSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      required: true,
      enum: Object.values(M4LogType),
      index: true,
    },
    articleId: {
      type: String,
      required: true,
      index: true,
    },
    orderId: {
      type: String,
      required: true,
      index: true,
    },
    orderNumber: {
      type: String,
      default: '',
      index: true,
    },
    articleNumber: {
      type: String,
      default: '',
      index: true,
    },
    sourceFloor: {
      type: String,
      enum: [...M4_SOURCE_FLOORS, null],
      default: null,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    previousOnHand: { type: Number, default: 0, min: 0 },
    newOnHand: { type: Number, default: 0, min: 0 },
    previousOutwardTotal: { type: Number, default: 0, min: 0 },
    newOutwardTotal: { type: Number, default: 0, min: 0 },
    availableAfter: { type: Number, default: 0, min: 0 },
    remarks: { type: String, default: '' },
    userId: { type: String, required: true, index: true },
    userName: { type: String, default: '' },
    floorSupervisorId: { type: String, required: true },
    /** Knitting floor: machine on which M4 was recorded */
    machineId: { type: String, default: '', index: true },
    machineCode: { type: String, default: '' },
    machineName: { type: String, default: '' },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'm4_logs',
  }
);

m4LogSchema.index({ articleId: 1, timestamp: -1 });
m4LogSchema.index({ orderId: 1, timestamp: -1 });
m4LogSchema.index({ type: 1, timestamp: -1 });
m4LogSchema.index({ sourceFloor: 1, timestamp: -1 });
m4LogSchema.index({ machineId: 1, timestamp: -1 });

m4LogSchema.plugin(paginate);

/**
 * Create a new M4 ledger log entry.
 * @param {Object} logData
 * @returns {Promise<import('mongoose').Document>}
 */
m4LogSchema.statics.createLogEntry = function createLogEntry(logData) {
  const log = new this({
    id: `M4LOG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ...logData,
    timestamp: logData.timestamp || new Date(),
  });
  return log.save();
};

const M4Log = mongoose.model('M4Log', m4LogSchema);

export default M4Log;
export { M4_SOURCE_FLOORS };
