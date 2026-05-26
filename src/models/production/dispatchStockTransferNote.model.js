import mongoose from 'mongoose';
import { paginate, toJSON } from '../plugins/index.js';

/** @enum {string} */
export const DispatchStnStatus = {
  ACTIVE: 'active',
  VOID: 'void',
};

const allocationSchema = new mongoose.Schema(
  {
    articleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Article',
      required: true,
    },
    brand: { type: String, default: '', trim: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const lineSchema = new mongoose.Schema(
  {
    articleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Article',
      required: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductionOrder',
      required: true,
    },
    articleNumber: { type: String, default: '', trim: true },
    sapArticleNo: { type: String, default: '', trim: true },
    articleName: { type: String, default: '', trim: true },
    brand: { type: String, default: '', trim: true },
    qtyInPairs: { type: Number, required: true, min: 1 },
    containerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ContainersMaster' }],
    containerBarcodes: [{ type: String, trim: true }],
  },
  { _id: false }
);

/**
 * Persisted Stock Transfer Note created from Dispatch floor print flow.
 */
const dispatchStockTransferNoteSchema = new mongoose.Schema(
  {
    stnSerial: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    stnDate: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    categoryLabel: { type: String, default: '', trim: true },
    fromUnit: { type: String, default: 'Unit B7-GF', trim: true },
    toUnit: { type: String, default: 'Unit B8-2F', trim: true },
    totalQty: { type: Number, required: true, min: 0 },
    totalBoxes: { type: Number, required: true, min: 0, default: 0 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    status: {
      type: String,
      enum: Object.values(DispatchStnStatus),
      default: DispatchStnStatus.ACTIVE,
      index: true,
    },
    lines: { type: [lineSchema], default: [] },
    allocations: { type: [allocationSchema], default: [] },
  },
  {
    timestamps: true,
    collection: 'dispatch_stock_transfer_notes',
  }
);

dispatchStockTransferNoteSchema.plugin(toJSON);
dispatchStockTransferNoteSchema.plugin(paginate);

dispatchStockTransferNoteSchema.index({ stnDate: -1 });
dispatchStockTransferNoteSchema.index({ categoryLabel: 1 });
dispatchStockTransferNoteSchema.index({ 'allocations.articleId': 1 });

/**
 * Atomic counter for global 6-digit STN serials.
 */
const dispatchStnCounterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'dispatch_stn' },
    seq: { type: Number, required: true, default: 0, min: 0 },
  },
  { collection: 'dispatch_stn_counters' }
);

/**
 * Returns next padded 6-digit STN serial (e.g. `000042`).
 * @returns {Promise<string>}
 */
dispatchStnCounterSchema.statics.getNextSerial = async function getNextSerial() {
  const doc = await this.findOneAndUpdate(
    { key: 'dispatch_stn' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return String(doc.seq).padStart(6, '0');
};

const DispatchStockTransferNote = mongoose.model(
  'DispatchStockTransferNote',
  dispatchStockTransferNoteSchema
);
const DispatchStnCounter = mongoose.model('DispatchStnCounter', dispatchStnCounterSchema);

export { DispatchStnCounter };
export default DispatchStockTransferNote;
