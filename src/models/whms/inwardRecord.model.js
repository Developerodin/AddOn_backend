import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const inwardItemSchema = mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true },
    name: { type: String, trim: true },
    productId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Product' },
    orderedQty: { type: Number, required: true, min: 0 },
    receivedQty: { type: Number, default: 0, min: 0 },
    acceptedQty: { type: Number, default: 0, min: 0 },
    rejectedQty: { type: Number, default: 0, min: 0 },
    unit: { type: String, trim: true, default: 'pcs' },
  },
  { _id: true }
);

const inwardRecordSchema = mongoose.Schema(
  {
    grnNumber: { type: String, required: true, trim: true, unique: true },
    reference: { type: String, trim: true },
    date: { type: Date, default: Date.now },
    supplier: { type: String, trim: true },
    status: {
      type: String,
      enum: ['pending', 'partial', 'received', 'qc-pending', 'completed'],
      default: 'pending',
    },
    items: [inwardItemSchema],
    totalItems: { type: Number, default: 0 },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

inwardRecordSchema.index({ grnNumber: 1 });
inwardRecordSchema.index({ status: 1, date: -1 });

inwardRecordSchema.plugin(toJSON);
inwardRecordSchema.plugin(paginate);

const InwardRecord = mongoose.model('InwardRecord', inwardRecordSchema);
export default InwardRecord;
