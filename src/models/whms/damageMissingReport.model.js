import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const damageMissingReportSchema = mongoose.Schema(
  {
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'WhmsOrder', required: true },
    orderNumber: { type: String, trim: true },
    sku: { type: String, required: true, trim: true },
    itemName: { type: String, trim: true },
    type: { type: String, enum: ['damage', 'missing'], required: true },
    quantity: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true },
    reportedBy: { type: String, trim: true },
    reportedAt: { type: Date, default: Date.now },
    images: [String],
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

damageMissingReportSchema.index({ orderId: 1 });
damageMissingReportSchema.index({ reportedAt: -1 });
damageMissingReportSchema.plugin(toJSON);
damageMissingReportSchema.plugin(paginate);

const DamageMissingReport = mongoose.model('DamageMissingReport', damageMissingReportSchema);
export default DamageMissingReport;
