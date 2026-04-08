import mongoose from 'mongoose';
import { paginate } from '../plugins/index.js';
import { ContainerStatus, ContainerType } from './enums.js';

/**
 * Containers Master Model
 * Stores containers with name, barcode (_id), and status.
 *
 * **Vendor vs production:** There is no top-level “mode” field. Each `activeItems[]` row
 * references either `article` (factory) or `vendorProductionFlow` (vendor) — see pre-save
 * validation. Use {@link contentDomain} virtual for a single string when building UI/filters.
 */
const containersMasterSchema = new mongoose.Schema(
  {
    /** Display name for the container */
    containerName: {
      type: String,
      trim: true,
      default: '',
    },
    /** Barcode: stores _id (MongoDB id) for scan lookup; set automatically on create */
    barcode: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
    },
    /** Container status */
    status: {
      type: String,
      required: true,
      enum: Object.values(ContainerStatus),
      default: ContainerStatus.ACTIVE,
      index: true,
    },
    /** Active floor identifier (all items in container go to this floor when accepted) */
    activeFloor: {
      type: String,
      trim: true,
      default: '',
    },
    /**
     * Each row: exactly one of `article` (factory) or `vendorProductionFlow` (vendor pipeline).
     * Optional `transferItems` (styleCode / brand / transferred) when staging branding → final checking.
     */
    activeItems: {
      type: [
        {
          article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: false },
          vendorProductionFlow: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'VendorProductionFlow',
            required: false,
          },
          quantity: { type: Number, required: true, min: 0.0001 },
          transferItems: {
            type: [
              {
                transferred: { type: Number, default: 0, min: 0 },
                styleCode: { type: String, default: '', trim: true },
                brand: { type: String, default: '', trim: true },
              },
            ],
            default: undefined,
          },
        },
      ],
      default: [],
    },
    /** Type: bag (1–300), bigContainer (301–500), container (501+) */
    type: {
      type: String,
      enum: Object.values(ContainerType),
      default: ContainerType.CONTAINER,
      index: true,
    },
    /** Tear weight in grams (for bags); default 0 */
    tearWeight: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    collection: 'containers_masters',
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.activeArticle;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

containersMasterSchema.pre('save', function (next) {
  if (this.isNew && !this.barcode) {
    this.barcode = this._id ? this._id.toString() : null;
  }
  if (this.barcode === '' || this.barcode === null) this.barcode = this._id?.toString();
  const items = this.activeItems || [];
  for (let i = 0; i < items.length; i += 1) {
    const row = items[i];
    const hasA = !!row.article;
    const hasV = !!row.vendorProductionFlow;
    if (hasA === hasV) {
      return next(
        new Error('Each activeItems row must have exactly one of article or vendorProductionFlow')
      );
    }
  }
  next();
});

containersMasterSchema.index({ status: 1 });
containersMasterSchema.index({ containerName: 1 });
containersMasterSchema.index({ 'activeItems.article': 1 });
containersMasterSchema.index({ 'activeItems.vendorProductionFlow': 1 });
containersMasterSchema.plugin(paginate);

/** Virtual: total quantity across all active items */
containersMasterSchema.virtual('quantity').get(function () {
  return (this.activeItems || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
});

/**
 * What this container is currently staging: derived from `activeItems` refs (not persisted).
 * `mixed` = both article and vendor rows (unusual; avoid operationally).
 */
containersMasterSchema.virtual('contentDomain').get(function () {
  const items = this.activeItems || [];
  if (items.length === 0) return 'empty';
  let hasArticle = false;
  let hasVendor = false;
  for (const item of items) {
    if (item?.article) hasArticle = true;
    if (item?.vendorProductionFlow) hasVendor = true;
  }
  if (hasArticle && hasVendor) return 'mixed';
  if (hasVendor) return 'vendor';
  if (hasArticle) return 'production';
  return 'empty';
});

export default mongoose.model('ContainersMaster', containersMasterSchema);
