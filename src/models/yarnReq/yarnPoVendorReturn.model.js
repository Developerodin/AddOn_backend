import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';

export const yarnPoVendorReturnStatuses = ['pending_session', 'completed', 'cancelled'];

export const vendorReturnCancellationIntents = ['partial', 'full_po'];

const coneLineSchema = mongoose.Schema(
  {
    barcode: { type: String, trim: true, required: true },
    coneId: { type: mongoose.Schema.Types.ObjectId, ref: 'YarnCone', required: true },
    boxId: { type: String, trim: true },
    lotNumber: { type: String, trim: true, default: '' },
    yarnCatalogId: { type: mongoose.Schema.Types.ObjectId, ref: 'YarnCatalog' },
    coneWeight: { type: Number, min: 0 },
    tearWeight: { type: Number, min: 0 },
    netWeight: { type: Number, min: 0 },
    coneStorageIdBefore: { type: String, trim: true },
  },
  { _id: false }
);

const createdBySchema = mongoose.Schema(
  {
    username: { type: String, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const yarnPoVendorReturnSchema = mongoose.Schema(
  {
    poNumber: { type: String, required: true, trim: true, index: true },
    purchaseOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnPurchaseOrder',
    },
    status: {
      type: String,
      enum: yarnPoVendorReturnStatuses,
      default: 'pending_session',
      index: true,
    },
    cancellationIntent: {
      type: String,
      enum: vendorReturnCancellationIntents,
      required: true,
    },
    remark: { type: String, trim: true, default: '' },
    /** Barcodes staged before finalize (deduped). */
    pendingBarcodes: { type: [String], default: [] },
    /** Populated on finalize for audit. */
    lines: { type: [coneLineSchema], default: [] },
    totalNetWeight: { type: Number, min: 0, default: 0 },
    coneCount: { type: Number, min: 0, default: 0 },
    createdBy: createdBySchema,
    completedAt: { type: Date, default: null },
    completedBy: createdBySchema,
    /** Set only when finalize sends a key; never null (unique index would reject multiple nulls). */
    idempotencyKey: { type: String, trim: true },
  },
  { timestamps: true }
);

yarnPoVendorReturnSchema.plugin(toJSON);
yarnPoVendorReturnSchema.index({ poNumber: 1, status: 1, createdAt: -1 });
/** Unique only for non-empty keys — omit field on most docs so sessions do not collide. */
yarnPoVendorReturnSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } },
  }
);

const YarnPoVendorReturn = mongoose.model('YarnPoVendorReturn', yarnPoVendorReturnSchema);

export default YarnPoVendorReturn;
