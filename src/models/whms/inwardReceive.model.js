import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

/** QC / gate status for an inward receive line. */
export const InwardReceiveStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  ON_HOLD: 'onhold',
};

/** Origin of the inward line — factory production vs vendor dispatch. */
export const InwardReceiveSource = {
  PRODUCTION: 'production',
  VENDOR: 'vendor',
};

/**
 * WHMS inward receive line: production (Article + ProductionOrder + warehouse receive) or
 * vendor (VendorProductionFlow dispatch container accept). Same accept → inventory reconciliation.
 */
const inwardReceiveSchema = mongoose.Schema(
  {
    inwardSource: {
      type: String,
      enum: Object.values(InwardReceiveSource),
      default: InwardReceiveSource.PRODUCTION,
      index: true,
    },
    articleId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Article',
      default: null,
      index: true,
    },
    orderId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ProductionOrder',
      default: null,
      index: true,
    },
    /** Vendor flow when inwardSource is vendor (dispatch container accept). */
    vendorProductionFlowId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'VendorProductionFlow',
      default: null,
      index: true,
    },
    vendorPurchaseOrderId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'VendorPurchaseOrder',
      default: null,
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
    /** Snapshot: production order, vendor PO, container, etc. */
    orderData: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    /** Optional explicit business receive moment (defaults to createdAt if unset). */
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    /** Container scan accept — ties line to container. */
    receivedInContainerId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ContainersMaster',
      default: null,
      index: true,
    },
    /** `floorQuantities.warehouse.receivedData` subdoc _id (production; audit / dedupe). */
    warehouseReceivedLineId: {
      type: mongoose.SchemaTypes.ObjectId,
      default: null,
      index: true,
    },
    /** `floorQuantities.dispatch.receivedData` subdoc _id (vendor; audit / dedupe). */
    vendorDispatchReceivedLineId: {
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

inwardReceiveSchema.pre('validate', function inwardReceiveValidateSource(next) {
  const src = this.inwardSource || InwardReceiveSource.PRODUCTION;
  if (src === InwardReceiveSource.VENDOR) {
    if (!this.vendorProductionFlowId) {
      this.invalidate('vendorProductionFlowId', 'required for vendor inward');
      return next();
    }
    if (!String(this.articleNumber || '').trim()) {
      this.invalidate('articleNumber', 'required');
      return next();
    }
  } else {
    if (!this.articleId) {
      this.invalidate('articleId', 'required for production inward');
      return next();
    }
    if (!this.orderId) {
      this.invalidate('orderId', 'required for production inward');
      return next();
    }
  }
  next();
});

inwardReceiveSchema.index({ orderId: 1, createdAt: -1 });
inwardReceiveSchema.index({ articleId: 1, createdAt: -1 });
inwardReceiveSchema.index({ vendorProductionFlowId: 1, createdAt: -1 });
inwardReceiveSchema.index({ status: 1, createdAt: -1 });

inwardReceiveSchema.plugin(toJSON);
inwardReceiveSchema.plugin(paginate);

const InwardReceive = mongoose.model('InwardReceive', inwardReceiveSchema);
export default InwardReceive;
