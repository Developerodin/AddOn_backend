import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

export const WarehouseReturnType = Object.freeze({
  /** Return to origin — undelivered shipment coming back from courier. */
  RTO: 'rto',
  /** Customer return (damage / wrong item / size issue / ...). */
  RTV: 'rtv',
});

export const WarehouseReturnStatus = Object.freeze({
  SCANNING: 'scanning',
  PENDING_APPROVAL: 'pending-approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export const WarehouseReturnReason = Object.freeze({
  DAMAGE: 'damage',
  WRONG_ITEM: 'wrong-item',
  SIZE_ISSUE: 'size-issue',
  DELIVERY_ISSUE: 'delivery-issue',
  COURIER_RTO: 'courier-rto',
  OTHER: 'other',
});

export const ReturnItemCondition = Object.freeze({
  SALEABLE: 'saleable',
  DAMAGED: 'damaged',
  REPAIR: 'repair',
});

export const ReturnItemDecision = Object.freeze({
  RESTOCK: 'restock',
  DAMAGED_STOCK: 'damaged-stock',
  REPAIR: 'repair',
  REJECT: 'reject',
});

const returnItemSchema = mongoose.Schema(
  {
    styleCode: { type: String, required: true, trim: true },
    skuCode: { type: String, trim: true },
    size: { type: String, trim: true, default: '' },
    shade: { type: String, trim: true, default: '' },
    /** Quantity on the original invoice. */
    invoiceQty: { type: Number, required: true, min: 0 },
    /** Quantity scanned back in. */
    scannedQty: { type: Number, default: 0, min: 0 },
    /** Quantity confirmed by supervisor inspection (defaults to scannedQty at submit). */
    verifiedQty: { type: Number, default: 0, min: 0 },
    condition: {
      type: String,
      enum: [...Object.values(ReturnItemCondition), ''],
      default: '',
    },
    decision: {
      type: String,
      enum: [...Object.values(ReturnItemDecision), ''],
      default: '',
    },
    remarks: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const warehouseReturnSchema = mongoose.Schema(
  {
    returnNumber: { type: String, required: true, trim: true, unique: true },
    type: {
      type: String,
      enum: Object.values(WarehouseReturnType),
      required: true,
    },

    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'WarehouseOrder', required: true },
    orderNumber: { type: String, trim: true },
    invoiceId: { type: mongoose.SchemaTypes.ObjectId, ref: 'WhmsInvoice', required: true },
    invoiceNumber: { type: String, trim: true },

    clientType: { type: String, trim: true },
    clientName: { type: String, trim: true },

    reason: {
      type: String,
      enum: Object.values(WarehouseReturnReason),
      required: true,
    },
    remarks: { type: String, trim: true, default: '' },

    status: {
      type: String,
      enum: Object.values(WarehouseReturnStatus),
      default: WarehouseReturnStatus.SCANNING,
    },
    items: { type: [returnItemSchema], default: [] },

    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, trim: true, default: '' },
    inspectedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null },
    inspectedByName: { type: String, trim: true, default: '' },
    approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, trim: true, default: '' },
    approvedAt: { type: Date },
    rejectReason: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

warehouseReturnSchema.index({ orderId: 1 });
warehouseReturnSchema.index({ invoiceId: 1 });
warehouseReturnSchema.index({ type: 1, status: 1, createdAt: -1 });

warehouseReturnSchema.plugin(toJSON);
warehouseReturnSchema.plugin(paginate);

const WarehouseReturn = mongoose.model('WarehouseReturn', warehouseReturnSchema, 'whms_returns');
export default WarehouseReturn;
