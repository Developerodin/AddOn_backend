import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const rackLocationSchema = mongoose.Schema(
  {
    zone: { type: String, trim: true },
    row: { type: String, trim: true },
    column: { type: String, trim: true },
    bin: { type: String, trim: true },
  },
  { _id: false }
);

const pickItemSchema = mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true },
    name: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    productId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Product' },
    pathIndex: { type: Number, default: 0 },
    rackLocation: { type: rackLocationSchema },
    requiredQty: { type: Number, required: true, min: 0 },
    pickedQty: { type: Number, default: 0, min: 0 },
    unit: { type: String, trim: true, default: 'pcs' },
    status: {
      type: String,
      enum: ['pending', 'partial', 'picked', 'verified', 'skipped'],
      default: 'pending',
    },
    linkedOrderIds: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'WhmsOrder' }],
    batchId: { type: String, trim: true },
  },
  { _id: true }
);

const pickListSchema = mongoose.Schema(
  {
    pickBatchId: { type: String, required: true, trim: true, unique: true },
    status: {
      type: String,
      enum: ['generated', 'picking-in-progress', 'picking-done'],
      default: 'generated',
    },
    items: [pickItemSchema],
    assignedTo: { type: String, trim: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

pickListSchema.index({ pickBatchId: 1 });
pickListSchema.index({ status: 1 });
pickListSchema.plugin(toJSON);
pickListSchema.plugin(paginate);

const PickList = mongoose.model('PickList', pickListSchema);
export default PickList;
