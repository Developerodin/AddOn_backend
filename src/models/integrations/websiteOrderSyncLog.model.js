import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const websiteOrderSyncLogSchema = mongoose.Schema(
  {
    addonOrderId: { type: String, trim: true, required: true, index: true },
    opencartOrderId: { type: Number, default: null },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    status: {
      type: String,
      enum: ['created', 'already_synced', 'draft', 'failed', 'cancelled', 'cannot_cancel', 'sent', 'pending'],
      required: true,
    },
    warehouseOrderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'WarehouseOrder', default: null },
    warehouseClientId: { type: mongoose.SchemaTypes.ObjectId, ref: 'WarehouseClient', default: null },
    clientCreated: { type: Boolean, default: false },
    requestPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    error: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

websiteOrderSyncLogSchema.index({ createdAt: -1 });
websiteOrderSyncLogSchema.plugin(toJSON);
websiteOrderSyncLogSchema.plugin(paginate);

const WebsiteOrderSyncLog = mongoose.model('WebsiteOrderSyncLog', websiteOrderSyncLogSchema);

export default WebsiteOrderSyncLog;
