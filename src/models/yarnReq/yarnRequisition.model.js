import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import YarnCatalog from '../yarnManagement/yarnCatalog.model.js';

const yarnRequisitionSchema = mongoose.Schema(
  {
    yarnName: {
      type: String,
      required: true,
      trim: true,
    },
    yarnCatalogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnCatalog',
      required: true,
    },
    minQty: {
      type: Number,
      required: true,
      min: 0,
    },
    availableQty: {
      type: Number,
      required: true,
      min: 0,
    },
    blockedQty: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    alertStatus: {
      type: String,
      enum: [null, 'below_minimum', 'overbooked'],
      default: null,
    },
    poSent: {
      type: Boolean,
      default: false,
    },
    /** When true, this requisition is queued for yarn PO drafting (shown on Draft POs / new PO preload). */
    draftForPo: {
      type: Boolean,
      default: false,
    },
    /** User-chosen supplier for drafting (manual per-row). */
    preferredSupplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
    },
    /** Snapshot of supplier name at selection time for list/search without populate. */
    preferredSupplierName: {
      type: String,
      trim: true,
    },
    /** Soft-dismiss: hides from workflows; inventory upsert skips this row for updates. */
    dismissed: {
      type: Boolean,
      default: false,
    },
    dismissedAt: {
      type: Date,
    },
    /** Set when a PO submitted to supplier includes this staged line—client “Order placed”. */
    linkedPurchaseOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnPurchaseOrder',
    },
    /** Lines merged onto an existing draft PO for this supplier (dequeued from global queue). */
    attachedDraftPoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnPurchaseOrder',
    },
  },
  {
    timestamps: { createdAt: 'created', updatedAt: 'lastUpdated' },
  }
);

yarnRequisitionSchema.plugin(toJSON);
yarnRequisitionSchema.plugin(paginate);

yarnRequisitionSchema.index({ poSent: 1, alertStatus: 1, lastUpdated: -1 });
yarnRequisitionSchema.index({ poSent: 1, draftForPo: 1, created: -1 });
yarnRequisitionSchema.index({ preferredSupplierId: 1, dismissed: 1 });
yarnRequisitionSchema.index({ dismissed: 1, created: -1 });
yarnRequisitionSchema.index({ linkedPurchaseOrderId: 1 });
yarnRequisitionSchema.index({ attachedDraftPoId: 1 });
yarnRequisitionSchema.index({ created: -1 });

yarnRequisitionSchema.pre('save', async function (next) {
  if (this.isModified('yarnCatalogId')) {
    const yarn = await YarnCatalog.findById(this.yarnCatalogId);
    if (yarn) {
      this.yarnName = yarn.yarnName || this.yarnName;
    }
  }
  next();
});

const YarnRequisition = mongoose.model('YarnRequisition', yarnRequisitionSchema);

export default YarnRequisition;


