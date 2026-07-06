import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

export const ScanSessionStatus = Object.freeze({
  OPEN: 'open',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

export const ScanItemStatus = Object.freeze({
  PENDING: 'pending',
  SHORT: 'short',
  MATCHED: 'matched',
  EXCESS: 'excess',
});

const scanItemSchema = mongoose.Schema(
  {
    pickListId: { type: mongoose.SchemaTypes.ObjectId, ref: 'PickList', default: null },
    skuCode: { type: String, trim: true },
    styleCode: { type: String, required: true, trim: true },
    size: { type: String, trim: true, default: '' },
    shade: { type: String, trim: true, default: '' },
    /** Quantity expected = picked quantity confirmed by the Barcode Team. */
    expectedQty: { type: Number, required: true, min: 0 },
    scannedQty: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: Object.values(ScanItemStatus),
      default: ScanItemStatus.PENDING,
    },
  },
  { _id: true }
);

const scanSessionSchema = mongoose.Schema(
  {
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'WarehouseOrder', required: true },
    orderNumber: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(ScanSessionStatus),
      default: ScanSessionStatus.OPEN,
    },
    items: { type: [scanItemSchema], default: [] },

    startedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null },
    startedByName: { type: String, trim: true, default: '' },
    completedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null },
    completedByName: { type: String, trim: true, default: '' },
    completedAt: { type: Date },

    /** Set when a supervisor completes despite mismatches. */
    mismatchOverride: { type: Boolean, default: false },
    overrideRemarks: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

scanSessionSchema.index({ orderId: 1, status: 1 });
scanSessionSchema.index({ status: 1, createdAt: -1 });

scanSessionSchema.plugin(toJSON);
scanSessionSchema.plugin(paginate);

const ScanSession = mongoose.model('ScanSession', scanSessionSchema, 'whms_scan_sessions');
export default ScanSession;
