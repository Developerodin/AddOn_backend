import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

export const PickListStatus = Object.freeze({
  PENDING: 'pending',
  PARTIAL: 'partial',
  PICKED: 'picked',
});

const PICK_LIST_STATUSES = Object.values(PickListStatus);

const pickListSchema = mongoose.Schema(
  {
    orderId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'WarehouseOrder',
      required: true,
    },
    orderNumber: { type: String, trim: true },

    size: { type: String, trim: true },
    steCodeNew: { type: String, trim: true },
    shade: { type: String, trim: true },
    nih: { type: String, trim: true },

    skuCode: { type: String, required: true, trim: true },
    styleCode: { type: String, required: true, trim: true },

    asst: { type: String, trim: true },
    sapStock: { type: Number },

    quantity: { type: Number, required: true, min: 0 },
    pickupQuantity: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: PICK_LIST_STATUSES,
      default: PickListStatus.PENDING,
    },
  },
  { timestamps: true }
);

pickListSchema.index({ orderId: 1 });
pickListSchema.index({ skuCode: 1 });
pickListSchema.index({ status: 1, createdAt: -1 });

pickListSchema.plugin(toJSON);
pickListSchema.plugin(paginate);

const PickList = mongoose.model('PickList', pickListSchema);

PickList.syncIndexes().catch(() => {});

export default PickList;
