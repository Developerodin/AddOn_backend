import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

export const PickListBatchType = Object.freeze({
  SINGLE: 'single',
  COMBINED: 'combined',
});

export const PickListBatchStatus = Object.freeze({
  PICKING: 'picking',
  SENT_TO_SCANNING: 'sent-to-scanning',
  CANCELLED: 'cancelled',
});

const PICK_LIST_BATCH_TYPES = Object.values(PickListBatchType);
const PICK_LIST_BATCH_STATUSES = Object.values(PickListBatchStatus);
const PICK_ITEM_STATUSES = ['pending', 'partial', 'picked'];

const batchAllocationSchema = mongoose.Schema(
  {
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'WarehouseOrder', required: true },
    pickListId: { type: mongoose.SchemaTypes.ObjectId, ref: 'PickList', required: true },
    orderNumber: { type: String, trim: true, default: '' },
    requiredQty: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const barcodePrintLabelSchema = mongoose.Schema(
  {
    styleCode: { type: String, trim: true, default: '' },
    skuCode: { type: String, trim: true, default: '' },
    size: { type: String, trim: true, default: '' },
    shade: { type: String, trim: true, default: '' },
    quantity: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const barcodePrintHistorySchema = mongoose.Schema(
  {
    styleCode: { type: String, trim: true, default: '' },
    quantity: { type: Number, required: true, min: 1 },
    mode: { type: String, enum: ['all', 'custom'], required: true },
    labels: { type: [barcodePrintLabelSchema], default: [] },
    printedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null },
    printedByName: { type: String, trim: true, default: '' },
    printedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const batchItemSchema = mongoose.Schema(
  {
    itemKey: { type: String, required: true, trim: true },
    styleCode: { type: String, required: true, trim: true },
    skuCode: { type: String, required: true, trim: true },
    styleCodeId: { type: mongoose.SchemaTypes.ObjectId, ref: 'StyleCode', default: null },
    size: { type: String, trim: true, default: '' },
    shade: { type: String, trim: true, default: '' },
    requiredQty: { type: Number, required: true, min: 0 },
    pickedQty: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: PICK_ITEM_STATUSES, default: 'pending' },
    allocations: { type: [batchAllocationSchema], default: [] },
  },
  { _id: false }
);

const pickListBatchSchema = mongoose.Schema(
  {
    batchNumber: { type: String, required: true, trim: true, unique: true },
    type: { type: String, enum: PICK_LIST_BATCH_TYPES, required: true },
    orderIds: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'WarehouseOrder', required: true }],
    orderNumbers: [{ type: String, trim: true }],
    status: {
      type: String,
      enum: PICK_LIST_BATCH_STATUSES,
      default: PickListBatchStatus.PICKING,
    },
    pickerName: { type: String, trim: true, default: '' },
    items: { type: [batchItemSchema], default: [] },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, trim: true, default: '' },
    sentToScanningAt: { type: Date, default: null },
    barcodePrintHistory: { type: [barcodePrintHistorySchema], default: [] },
  },
  { timestamps: true }
);

pickListBatchSchema.index({ status: 1, createdAt: -1 });
pickListBatchSchema.index({ orderIds: 1 });
pickListBatchSchema.index({ batchNumber: 1 });

pickListBatchSchema.plugin(toJSON);
pickListBatchSchema.plugin(paginate);

const PickListBatch = mongoose.model('PickListBatch', pickListBatchSchema, 'whms_pick_list_batches');

PickListBatch.syncIndexes().catch(() => {});

export default PickListBatch;
