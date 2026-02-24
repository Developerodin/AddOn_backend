import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const packItemSchema = mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true },
    name: { type: String, trim: true },
    productId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Product' },
    pickedQty: { type: Number, default: 0, min: 0 },
    packedQty: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'partial', 'packed', 'verified', 'damaged', 'missing'],
      default: 'pending',
    },
    itemBarcode: { type: String, trim: true },
  },
  { _id: true }
);

const packOrderSchema = mongoose.Schema(
  {
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'WhmsOrder', required: true },
    orderNumber: { type: String, trim: true },
    customerName: { type: String, trim: true },
    status: {
      type: String,
      enum: ['ready', 'packing', 'packed', 'dispatch-ready'],
      default: 'ready',
    },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    items: [packItemSchema],
  },
  { _id: true }
);

const packCartonSchema = mongoose.Schema(
  {
    cartonBarcode: { type: String, trim: true },
  },
  { _id: true, timestamps: true }
);

const packBatchSchema = mongoose.Schema(
  {
    batchCode: { type: String, required: true, trim: true, unique: true },
    orderIds: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'WhmsOrder' }],
    status: {
      type: String,
      enum: ['ready', 'packing', 'packed', 'dispatch-ready'],
      default: 'ready',
    },
    orders: [packOrderSchema],
    cartons: [packCartonSchema],
  },
  { timestamps: true }
);

packBatchSchema.index({ batchCode: 1 });
packBatchSchema.index({ status: 1 });
packBatchSchema.plugin(toJSON);
packBatchSchema.plugin(paginate);

const PackBatch = mongoose.model('PackBatch', packBatchSchema);
export default PackBatch;
