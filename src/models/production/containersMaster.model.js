import mongoose from 'mongoose';
import { paginate } from '../plugins/index.js';
import { ContainerStatus } from './enums.js';

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
    /** Currently active article (name or id) */
    activeArticle: {
      type: String,
      trim: true,
      default: '',
    },
    /** Active floor identifier */
    activeFloor: {
      type: String,
      trim: true,
      default: '',
    },
    
  },
  {
    timestamps: true,
    collection: 'containers_masters',
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
containersMasterSchema.plugin(paginate);

export default mongoose.model('ContainersMaster', containersMasterSchema);
