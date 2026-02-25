import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const dispatchApprovalSchema = mongoose.Schema(
  {
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'WhmsOrder', required: true },
    channel: { type: String, trim: true },
    requestedBy: { type: String, trim: true },
    pendingApprover: { type: String, enum: ['sales', 'accounts', 'both'], default: 'both' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    requestedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

dispatchApprovalSchema.index({ orderId: 1 });
dispatchApprovalSchema.index({ status: 1 });
dispatchApprovalSchema.plugin(toJSON);
dispatchApprovalSchema.plugin(paginate);

const DispatchApproval = mongoose.model('DispatchApproval', dispatchApprovalSchema);
export default DispatchApproval;
