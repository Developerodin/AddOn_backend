import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';
import WarehouseClient, { WarehouseClientType } from './warehouseClient.model.js';
import StyleCode from '../styleCode.model.js';
import StyleCodePairs from '../styleCodePairs.model.js';

export const WarehouseOrderClientType = WarehouseClientType;
export const WarehouseOrderItemKind = Object.freeze({
  SINGLE_PAIR: 'singlePair',
  MULTI_PAIR: 'multiPair',
});

/** Lifecycle for warehouse orders (API values; UI can label e.g. Pending, In-Progress). */
export const WarehouseOrderStatus = Object.freeze({
  DRAFT: 'draft',
  PENDING: 'pending',
  IN_PROGRESS: 'in-progress',
  PACKED: 'packed',
  DISPATCHED: 'dispatched',
  CANCELLED: 'cancelled',
});

const WAREHOUSE_ORDER_STATUSES = Object.values(WarehouseOrderStatus);

const lineItemFields = {
  pack: { type: String, trim: true },
  colour: { type: String, trim: true },
  type: { type: String, trim: true },
  pattern: { type: String, trim: true },
  quantity: { type: Number, required: true, min: 1 },
};

const warehouseOrderSinglePairItemSchema = mongoose.Schema(
  {
    styleCodeId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: StyleCode.modelName,
      required: true,
    },
    styleCode: { type: String, trim: true },
    ...lineItemFields,
  },
  { _id: false }
);

const warehouseOrderMultiPairItemSchema = mongoose.Schema(
  {
    styleCodeMultiPairId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: StyleCodePairs.modelName,
      required: true,
    },
    styleCode: { type: String, trim: true },
    ...lineItemFields,
  },
  { _id: false }
);

const warehouseOrderSchema = mongoose.Schema(
  {
    orderNumber: { type: String, trim: true, unique: true, sparse: true },
    date: { type: Date, default: Date.now },

    clientType: {
      type: String,
      enum: Object.values(WarehouseOrderClientType),
      required: true,
    },
    clientId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: WarehouseClient.modelName,
      required: true,
    },
    clientName: { type: String, trim: true },

    styleCodeSinglePair: { type: [warehouseOrderSinglePairItemSchema], default: [] },
    styleCodeMultiPair: { type: [warehouseOrderMultiPairItemSchema], default: [] },

    status: {
      type: String,
      enum: WAREHOUSE_ORDER_STATUSES,
      default: WarehouseOrderStatus.PENDING,
    },

    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

warehouseOrderSchema.path('styleCodeSinglePair').validate({
  validator: function validator(v) {
    const singleCount = Array.isArray(v) ? v.length : 0;
    const multiCount = Array.isArray(this.styleCodeMultiPair) ? this.styleCodeMultiPair.length : 0;
    return singleCount + multiCount > 0;
  },
  message: 'Warehouse order must have at least one item',
});

warehouseOrderSchema.path('styleCodeMultiPair').validate({
  validator: function validator(v) {
    const multiCount = Array.isArray(v) ? v.length : 0;
    const singleCount = Array.isArray(this.styleCodeSinglePair) ? this.styleCodeSinglePair.length : 0;
    return singleCount + multiCount > 0;
  },
  message: 'Warehouse order must have at least one item',
});

warehouseOrderSchema.index({ orderNumber: 1 });
warehouseOrderSchema.index({ date: -1 });
warehouseOrderSchema.index({ status: 1, createdAt: -1 });
warehouseOrderSchema.index({ clientType: 1, clientId: 1, createdAt: -1 });

warehouseOrderSchema.plugin(toJSON);
warehouseOrderSchema.plugin(paginate);

const WarehouseOrder = mongoose.model('WarehouseOrder', warehouseOrderSchema);
export default WarehouseOrder;
