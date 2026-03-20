import mongoose from 'mongoose';
import { paginate } from '../plugins/index.js';
import { ContainerStatus, ContainerType } from './enums.js';

/**
 * Containers Master Model
 * Stores containers with name, barcode (_id), and status.
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
    /** Multiple articles in container: { article, quantity } per item */
    activeItems: {
      type: [
        {
          article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
          quantity: { type: Number, required: true, min: 0.0001 },
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
  next();
});

containersMasterSchema.index({ status: 1 });
containersMasterSchema.index({ containerName: 1 });
containersMasterSchema.index({ 'activeItems.article': 1 });
containersMasterSchema.plugin(paginate);

/** Virtual: total quantity across all active items */
containersMasterSchema.virtual('quantity').get(function () {
  return (this.activeItems || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
});

export default mongoose.model('ContainersMaster', containersMasterSchema);
