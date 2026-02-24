import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const factoryRequirementSchema = mongoose.Schema(
  {
    styleCode: { type: String, trim: true },
    itemName: { type: String, trim: true },
    shortage: { type: Number, default: 0 },
    requestedQty: { type: Number, default: 0 },
    sentAt: { type: Date, default: Date.now },
    sentBy: { type: String, trim: true },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

factoryRequirementSchema.index({ styleCode: 1 });
factoryRequirementSchema.plugin(toJSON);
factoryRequirementSchema.plugin(paginate);

const FactoryRequirement = mongoose.model('FactoryRequirement', factoryRequirementSchema);
export default FactoryRequirement;
