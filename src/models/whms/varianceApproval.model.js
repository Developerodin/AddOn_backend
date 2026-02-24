import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const varianceApprovalSchema = mongoose.Schema(
  {
    reference: { type: mongoose.SchemaTypes.ObjectId, required: true }, // order id or GRN id
    type: { type: String, enum: ['order', 'grn'], required: true },
    variance: { type: String, trim: true },
    requestedBy: { type: String, trim: true },
    date: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

varianceApprovalSchema.index({ type: 1, status: 1 });
varianceApprovalSchema.plugin(toJSON);
varianceApprovalSchema.plugin(paginate);

const VarianceApproval = mongoose.model('VarianceApproval', varianceApprovalSchema);
export default VarianceApproval;
