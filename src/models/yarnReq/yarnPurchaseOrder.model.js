import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import Supplier from '../yarnManagement/supplier.model.js';
import YarnCatalog from '../yarnManagement/yarnCatalog.model.js';

export const yarnPurchaseOrderStatuses = [
  'submitted_to_supplier',
  'in_transit',
  'goods_received',
  'qc_pending',
  'po_rejected',
  'po_accepted',
];

const statusLogSchema = mongoose.Schema(
  {
    statusCode: {
      type: String,
      enum: yarnPurchaseOrderStatuses,
      required: true,
    },
    updatedBy: {
      username: {
        type: String,
        required: true,
        trim: true,
      },
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const poItemSchema = mongoose.Schema(
  {
    yarnName: {
      type: String,
      required: true,
      trim: true,
    },
    yarn: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnCatalog',
      required: true,
    },
    sizeCount: {
      type: String,
      required: true,
      trim: true,
    },
    shadeCode: {
      type: String,
      trim: true,
    },
    rate: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    estimatedDeliveryDate: {
      type: Date,
    },
    gstRate: {
      type: Number,
      min: 0,
    },
  },
  { _id: false }
);

const packListDetailsSchema = mongoose.Schema(
  {
    packingNumber: {
      type: String,
      trim: true,
    },
    courierName: {
      type: String,
      trim: true,
    },
    dispatchDate: {
      type: Date,
    },
    estimatedDeliveryDate: {
      type: Date,
    },
    lotNumber: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    numberOfCones: {
      type: Number,
      min: 0,
    },
    totalWeight: {
      type: Number,
      min: 0,
    },
  },
  { _id: false }
);

const receivedBySchema = mongoose.Schema(
  {
    username: {
      type: String,
      trim: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    receivedAt: {
      type: Date,
    },
  },
  { _id: false }
);

const yarnPurchaseOrderSchema = mongoose.Schema(
  {
    poNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    supplierName: {
      type: String,
      required: true,
      trim: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
    },
    poItems: {
      type: [poItemSchema],
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: 'At least one PO item is required',
      },
    },
    notes: {
      type: String,
      trim: true,
    },
    subTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    gst: {
      type: Number,
      required: true,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    goodsReceivedDate: {
      type: Date,
    },
    currentStatus: {
      type: String,
      enum: yarnPurchaseOrderStatuses,
      default: 'submitted_to_supplier',
    },
    statusLogs: {
      type: [statusLogSchema],
      default: [],
    },
    packListDetails: packListDetailsSchema,
    receivedBy: receivedBySchema,
  },
  {
    timestamps: { createdAt: 'createDate', updatedAt: 'lastUpdateDate' },
  }
);

yarnPurchaseOrderSchema.plugin(toJSON);
yarnPurchaseOrderSchema.plugin(paginate);

yarnPurchaseOrderSchema.pre('save', async function (next) {
  if (this.isModified('supplier') || !this.supplierName) {
    const supplier = await Supplier.findById(this.supplier);
    if (supplier) {
      this.supplierName = supplier.brandName || this.supplierName;
    }
  }

  if (this.isModified('poItems')) {
    for (const item of this.poItems) {
      if (item.yarn) {
        const yarn = await YarnCatalog.findById(item.yarn);
        if (yarn) {
          item.yarnName = yarn.yarnName || item.yarnName;
        }
      }
    }
  }

  next();
});

const YarnPurchaseOrder = mongoose.model('YarnPurchaseOrder', yarnPurchaseOrderSchema);

export default YarnPurchaseOrder;


