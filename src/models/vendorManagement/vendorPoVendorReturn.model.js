import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';

export const vendorPoReturnStatuses = ['pending_session', 'completed', 'cancelled'];
export const vendorPoReturnCancellationIntents = ['partial', 'full_vpo'];

const boxLineSchema = mongoose.Schema(
  {
    boxId: { type: String, trim: true, required: true },
    barcode: { type: String, trim: true, required: true },
    lotNumber: { type: String, trim: true, default: '' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String, trim: true, default: '' },
    vendorCode: { type: String, trim: true, default: '' },
    numberOfUnits: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const m4LineSchema = mongoose.Schema(
  {
    vendorProductionFlowId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProductionFlow', required: true },
    lotNumber: { type: String, trim: true, default: '' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String, trim: true, default: '' },
    vendorCode: { type: String, trim: true, default: '' },
    m4Quantity: { type: Number, min: 0, required: true },
  },
  { _id: false }
);

const pendingM4LineSchema = mongoose.Schema(
  {
    vendorProductionFlowId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProductionFlow', required: true },
    lotNumber: { type: String, trim: true, default: '' },
    m4Quantity: { type: Number, min: 1, required: true },
  },
  { _id: false }
);

const pendingArticleQtyLineSchema = mongoose.Schema(
  {
    vendorProductionFlowId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProductionFlow', required: true },
    lotNumber: { type: String, trim: true, default: '' },
    quantity: { type: Number, min: 1, required: true },
  },
  { _id: false }
);

const articleQtyLineSchema = mongoose.Schema(
  {
    vendorProductionFlowId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProductionFlow', required: true },
    lotNumber: { type: String, trim: true, default: '' },
    vendorPoItemId: { type: mongoose.Schema.Types.ObjectId },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String, trim: true, default: '' },
    vendorCode: { type: String, trim: true, default: '' },
    quantity: { type: Number, min: 1, required: true },
  },
  { _id: false }
);

const actorSchema = mongoose.Schema(
  {
    username: { type: String, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const vendorPoVendorReturnSchema = mongoose.Schema(
  {
    vpoNumber: { type: String, required: true, trim: true, index: true },
    vendorPurchaseOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorPurchaseOrder',
      required: true,
    },
    status: {
      type: String,
      enum: vendorPoReturnStatuses,
      default: 'pending_session',
      index: true,
    },
    cancellationIntent: {
      type: String,
      enum: vendorPoReturnCancellationIntents,
      required: true,
    },
    remark: { type: String, trim: true, default: '' },
    pendingBarcodes: { type: [String], default: [] },
    pendingM4Lines: { type: [pendingM4LineSchema], default: [] },
    pendingArticleQtyLines: { type: [pendingArticleQtyLineSchema], default: [] },
    boxLines: { type: [boxLineSchema], default: [] },
    m4Lines: { type: [m4LineSchema], default: [] },
    articleQtyLines: { type: [articleQtyLineSchema], default: [] },
    totalUnits: { type: Number, min: 0, default: 0 },
    boxCount: { type: Number, min: 0, default: 0 },
    m4UnitCount: { type: Number, min: 0, default: 0 },
    articleQtyCount: { type: Number, min: 0, default: 0 },
    createdBy: actorSchema,
    completedAt: { type: Date, default: null },
    completedBy: actorSchema,
    idempotencyKey: { type: String, trim: true },
  },
  { timestamps: true }
);

vendorPoVendorReturnSchema.plugin(toJSON);
vendorPoVendorReturnSchema.index({ vpoNumber: 1, status: 1, createdAt: -1 });
vendorPoVendorReturnSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } },
  }
);

const VendorPoVendorReturn = mongoose.model('VendorPoVendorReturn', vendorPoVendorReturnSchema);

export default VendorPoVendorReturn;
