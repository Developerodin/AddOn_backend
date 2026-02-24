import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const consolidationBatchSchema = mongoose.Schema(
  {
    batchCode: { type: String, required: true, trim: true, unique: true },
    orderIds: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'WhmsOrder' }],
    orderCount: { type: Number, default: 0 },
    totalItems: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['draft', 'ready', 'dispatched'],
      default: 'draft',
    },
  },
  { timestamps: true }
);

consolidationBatchSchema.index({ batchCode: 1 });
consolidationBatchSchema.index({ status: 1 });
consolidationBatchSchema.plugin(toJSON);
consolidationBatchSchema.plugin(paginate);

const ConsolidationBatch = mongoose.model('ConsolidationBatch', consolidationBatchSchema);
export default ConsolidationBatch;
