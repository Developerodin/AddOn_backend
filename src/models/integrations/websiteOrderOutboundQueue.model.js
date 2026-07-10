import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const websiteOrderOutboundQueueSchema = mongoose.Schema(
  {
    warehouseOrderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'WarehouseOrder', required: true, index: true },
    addonOrderId: { type: String, trim: true, required: true, index: true },
    event: { type: String, enum: ['status_update', 'tracking_update', 'cancel'], required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    syncToken: { type: String, trim: true, index: true },
    status: { type: String, enum: ['pending', 'sent', 'failed', 'dead'], default: 'pending', index: true },
    attempts: { type: Number, default: 0, min: 0 },
    lastError: { type: String, trim: true, default: '' },
    nextRetryAt: { type: Date, default: null },
  },
  { timestamps: true }
);

websiteOrderOutboundQueueSchema.index({ status: 1, nextRetryAt: 1 });

websiteOrderOutboundQueueSchema.plugin(toJSON);
websiteOrderOutboundQueueSchema.plugin(paginate);

const WebsiteOrderOutboundQueue = mongoose.model('WebsiteOrderOutboundQueue', websiteOrderOutboundQueueSchema);

export default WebsiteOrderOutboundQueue;
