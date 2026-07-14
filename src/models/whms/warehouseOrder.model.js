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

/**
 * Granular fulfilment pipeline stage. The coarse `status` is derived from this
 * (see {@link coarseStatusForFlowStatus}) so legacy filters/labels keep working.
 */
export const WarehouseOrderFlowStatus = Object.freeze({
  ORDER_CREATED: 'order-created',
  PICKING: 'picking',
  PICKING_DONE: 'picking-done',
  BARCODE_IN_PROGRESS: 'barcode-in-progress',
  PACKING_DONE: 'packing-done',
  SENT_TO_SCANNING: 'sent-to-scanning',
  SCANNING_IN_PROGRESS: 'scanning-in-progress',
  SCANNING_DONE: 'scanning-done',
  SENT_TO_BILLING: 'sent-to-billing',
  BILLED: 'billed',
  READY_TO_DISPATCH: 'ready-to-dispatch',
  DISPATCHED: 'dispatched',
  PARTIAL_DISPATCHED: 'partial-dispatched',
  READY_FOR_PICKUP: 'ready-for-pickup',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
});

const WAREHOUSE_ORDER_FLOW_STATUSES = Object.values(WarehouseOrderFlowStatus);

/** Map a granular flow status to the coarse legacy `status` bucket. */
export const coarseStatusForFlowStatus = (flowStatus) => {
  switch (flowStatus) {
    case WarehouseOrderFlowStatus.ORDER_CREATED:
      return WarehouseOrderStatus.PENDING;
    case WarehouseOrderFlowStatus.PICKING:
    case WarehouseOrderFlowStatus.PICKING_DONE:
    case WarehouseOrderFlowStatus.BARCODE_IN_PROGRESS:
      return WarehouseOrderStatus.IN_PROGRESS;
    case WarehouseOrderFlowStatus.PACKING_DONE:
    case WarehouseOrderFlowStatus.SENT_TO_SCANNING:
    case WarehouseOrderFlowStatus.SCANNING_IN_PROGRESS:
    case WarehouseOrderFlowStatus.SCANNING_DONE:
    case WarehouseOrderFlowStatus.SENT_TO_BILLING:
    case WarehouseOrderFlowStatus.BILLED:
    case WarehouseOrderFlowStatus.READY_TO_DISPATCH:
      return WarehouseOrderStatus.PACKED;
    case WarehouseOrderFlowStatus.DISPATCHED:
    case WarehouseOrderFlowStatus.PARTIAL_DISPATCHED:
    case WarehouseOrderFlowStatus.READY_FOR_PICKUP:
    case WarehouseOrderFlowStatus.DELIVERED:
      return WarehouseOrderStatus.DISPATCHED;
    case WarehouseOrderFlowStatus.CANCELLED:
      return WarehouseOrderStatus.CANCELLED;
    default:
      return WarehouseOrderStatus.PENDING;
  }
};

/** Map a coarse legacy `status` to its nearest flow status (bulk import / backfill). */
export const flowStatusForCoarseStatus = (status) => {
  switch (status) {
    case WarehouseOrderStatus.DRAFT:
    case WarehouseOrderStatus.PENDING:
      return WarehouseOrderFlowStatus.ORDER_CREATED;
    case WarehouseOrderStatus.IN_PROGRESS:
      return WarehouseOrderFlowStatus.PICKING;
    case WarehouseOrderStatus.PACKED:
      return WarehouseOrderFlowStatus.PACKING_DONE;
    case WarehouseOrderStatus.DISPATCHED:
      return WarehouseOrderFlowStatus.DISPATCHED;
    case WarehouseOrderStatus.CANCELLED:
      return WarehouseOrderFlowStatus.CANCELLED;
    default:
      return WarehouseOrderFlowStatus.ORDER_CREATED;
  }
};

const flowHistoryEntrySchema = mongoose.Schema(
  {
    from: { type: String, trim: true },
    to: { type: String, trim: true, required: true },
    byUserId: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null },
    byName: { type: String, trim: true, default: '' },
    remarks: { type: String, trim: true, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const dispatchDetailsSchema = mongoose.Schema(
  {
    courierName: { type: String, trim: true },
    /** Tracking number / AWB. */
    trackingNumber: { type: String, trim: true },
    vehicleDetails: { type: String, trim: true },
    dispatchDate: { type: Date },
    boxCount: { type: Number, min: 0 },
    shippingRemarks: { type: String, trim: true },
    /** How the shipment left: dispatched | partial-dispatched | ready-for-pickup. */
    dispatchType: { type: String, trim: true },
    deliveredDate: { type: Date },
  },
  { _id: false }
);

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
    /** Optional external / customer reference (e.g. Addon order number). */
    addonOrderId: { type: String, trim: true },
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

    flowStatus: {
      type: String,
      enum: WAREHOUSE_ORDER_FLOW_STATUSES,
      default: WarehouseOrderFlowStatus.ORDER_CREATED,
    },
    flowHistory: { type: [flowHistoryEntrySchema], default: [] },

    dispatch: { type: dispatchDetailsSchema, default: undefined },
    invoiceId: { type: mongoose.SchemaTypes.ObjectId, ref: 'WhmsInvoice', default: null },

    /** Active pick-list batch while order is in combined/single batch picking flow. */
    activeBatchId: { type: mongoose.SchemaTypes.ObjectId, ref: 'PickListBatch', default: null },

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
warehouseOrderSchema.index({ flowStatus: 1, createdAt: -1 });
warehouseOrderSchema.index({ clientType: 1, clientId: 1, createdAt: -1 });
warehouseOrderSchema.index({ addonOrderId: 1 }, { unique: true, sparse: true });

warehouseOrderSchema.plugin(toJSON);
warehouseOrderSchema.plugin(paginate);

const WarehouseOrder = mongoose.model('WarehouseOrder', warehouseOrderSchema);
export default WarehouseOrder;
