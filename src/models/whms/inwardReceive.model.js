import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

/** QC / gate status for an inward receive line. */
export const InwardReceiveStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  ON_HOLD: 'onhold',
};

/**
 * Production warehouse inward receive line — links an article + order to received qty, style, brand,
 * and an optional snapshot of order context in orderData.
 */
const inwardReceiveSchema = mongoose.Schema(
  {
    articleId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Article',
      required: true,
      index: true,
    },
    orderId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ProductionOrder',
      required: true,
      index: true,
    },
    articleNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    QuantityFromFactory: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Physical qty confirmed in WHMS (auto-created as 0 until user updates). */
    receivedQuantity: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    styleCode: {
      type: String,
      trim: true,
      default: '',
    },
    brand: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: Object.values(InwardReceiveStatus),
      default: InwardReceiveStatus.PENDING,
      index: true,
    },
    /** Snapshot / denormalized production order payload at receive time (flexible shape). */
    orderData: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    /** Optional explicit business receive moment (defaults to createdAt if unset). */
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    /** Container scan accept (production) — ties line to container. */
    receivedInContainerId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ContainersMaster',
      default: null,
      index: true,
    },
    /** `floorQuantities.warehouse.receivedData` subdoc _id at creation (audit / dedupe). */
    warehouseReceivedLineId: {
      type: mongoose.SchemaTypes.ObjectId,
      default: null,
      index: true,
    },
    /**
     * Portion of `receivedQuantity` already added to WarehouseInventory (accepted qty only).
     * Keeps inventory in sync when qty or status changes.
     */
    warehouseInventoryCreditedQty: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

inwardReceiveSchema.index({ orderId: 1, createdAt: -1 });
inwardReceiveSchema.index({ articleId: 1, createdAt: -1 });
inwardReceiveSchema.index({ status: 1, createdAt: -1 });

inwardReceiveSchema.plugin(toJSON);
inwardReceiveSchema.plugin(paginate);

const InwardReceive = mongoose.model('InwardReceive', inwardReceiveSchema);
export default InwardReceive;
