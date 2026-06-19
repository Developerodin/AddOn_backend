import mongoose from 'mongoose';
import { paginate, toJSON } from '../plugins/index.js';

/** @enum {string} */
export const VendorDispatchStnStatus = {
  ACTIVE: 'active',
  VOID: 'void',
};

const allocationSchema = new mongoose.Schema(
  {
    vendorProductionFlowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorProductionFlow',
      required: true,
    },
    brand: { type: String, default: '', trim: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const lineSchema = new mongoose.Schema(
  {
    vendorProductionFlowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorProductionFlow',
      required: true,
    },
    vendorPurchaseOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorPurchaseOrder',
      required: false,
    },
    vpoNumber: { type: String, default: '', trim: true },
    vendorName: { type: String, default: '', trim: true },
    /** Displayed identifier — vendor code (falls back to factory code when vendor code is absent). */
    articleNumber: { type: String, default: '', trim: true },
    /** Catalog key retained for name/brand resolution (Product.factoryCode). */
    factoryCode: { type: String, default: '', trim: true },
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
 * Persisted Stock Transfer Note for vendor dispatch → warehouse print flow.
 */
const vendorDispatchStockTransferNoteSchema = new mongoose.Schema(
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
      enum: Object.values(VendorDispatchStnStatus),
      default: VendorDispatchStnStatus.ACTIVE,
      index: true,
    },
    lines: { type: [lineSchema], default: [] },
    allocations: { type: [allocationSchema], default: [] },
  },
  {
    timestamps: true,
    collection: 'vendor_dispatch_stock_transfer_notes',
  }
);

vendorDispatchStockTransferNoteSchema.plugin(toJSON);
vendorDispatchStockTransferNoteSchema.plugin(paginate);

vendorDispatchStockTransferNoteSchema.index({ stnDate: -1 });
vendorDispatchStockTransferNoteSchema.index({ categoryLabel: 1 });
vendorDispatchStockTransferNoteSchema.index({ 'allocations.vendorProductionFlowId': 1 });

/**
 * Atomic counter for vendor STN serials (V + 6-digit sequence).
 */
const vendorDispatchStnCounterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'vendor_dispatch_stn' },
    seq: { type: Number, required: true, default: 0, min: 0 },
  },
  { collection: 'vendor_dispatch_stn_counters' }
);

/**
 * Returns next vendor STN serial with V prefix and 6-digit sequence (e.g. `V000001`).
 * @returns {Promise<string>}
 */
vendorDispatchStnCounterSchema.statics.getNextSerial = async function getNextSerial() {
  const doc = await this.findOneAndUpdate(
    { key: 'vendor_dispatch_stn' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return `V${String(doc.seq).padStart(6, '0')}`;
};

const VendorDispatchStockTransferNote = mongoose.model(
  'VendorDispatchStockTransferNote',
  vendorDispatchStockTransferNoteSchema
);
const VendorDispatchStnCounter = mongoose.model('VendorDispatchStnCounter', vendorDispatchStnCounterSchema);

export { VendorDispatchStnCounter };
export default VendorDispatchStockTransferNote;
