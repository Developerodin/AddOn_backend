import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import Supplier from '../yarnManagement/supplier.model.js';
import YarnCatalog from '../yarnManagement/yarnCatalog.model.js';

export const yarnPurchaseOrderStatuses = [
  'submitted_to_supplier',
  'in_transit',
  'goods_partially_received',
  'goods_received',
  'qc_pending',
  'po_rejected',
  'po_accepted',
  'po_accepted_partially',
];

export const lotStatuses = [
  'lot_pending',
  'lot_qc_pending',
  'lot_rejected',
  'lot_accepted',
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
  { _id: true }
);

const receivedLotDetailsSchema = mongoose.Schema(
  {
    lotNumber: {
      type: String,
      required: true,
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
    numberOfBoxes: {
      type: Number,
      min: 0,
    },
    poItems: {
      type: [
        {
          poItem: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
          },
          receivedQuantity: {
            type: Number,
            required: true,
            min: 0,
          },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: lotStatuses,
      default: 'lot_pending',
    },
  },
  { _id: false }
);

const packListDetailsSchema = mongoose.Schema(
  {
    poItems: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
    },
    packingNumber: {
      type: String,
      trim: true,
    },
    courierName: {
      type: String,
      trim: true,
    },
    courierNumber: {
      type: String,
      trim: true,
    },
    vehicleNumber: {
      type: String,
      trim: true,
    },
    challanNumber: {
      type: String,
      trim: true,
    },
    dispatchDate: {
      type: Date,
    },
    estimatedDeliveryDate: {
      type: Date,
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
    numberOfBoxes: {
      type: Number,
      min: 0,
    },
    files: {
      type: [
        {
          url: {
            type: String,
            required: true,
            trim: true,
          },
          key: {
            type: String,
            required: true,
            trim: true,
          },
          originalName: {
            type: String,
            required: true,
            trim: true,
          },
          mimeType: {
            type: String,
            required: true,
            trim: true,
          },
          size: {
            type: Number,
            required: true,
            min: 0,
          },
        },
      ],
      default: [],
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
    receivedLotDetails: {
      type: [receivedLotDetailsSchema],
      default: [],
    },
    packListDetails: {
      type: [packListDetailsSchema],
      default: [],
    },
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

// Auto-update order status based on received quantities
yarnPurchaseOrderSchema.pre('save', async function (next) {
  // Only check status if current status is one of these three
  const statusesToCheck = ['in_transit', 'goods_partially_received', 'goods_received'];
  
  if (!statusesToCheck.includes(this.currentStatus)) {
    return next();
  }

  // Only check if receivedLotDetails or poItems are modified
  if (!this.isModified('receivedLotDetails') && !this.isModified('poItems')) {
    return next();
  }

  // Calculate total received quantity for each PO item
  const poItemReceivedMap = new Map();

  // Initialize map with all PO items
  this.poItems.forEach((item) => {
    poItemReceivedMap.set(item._id.toString(), 0);
  });

  // Sum up received quantities from all receivedLotDetails
  this.receivedLotDetails.forEach((lot) => {
    if (lot.poItems && Array.isArray(lot.poItems)) {
      lot.poItems.forEach((receivedItem) => {
        const poItemId = receivedItem.poItem.toString();
        const currentTotal = poItemReceivedMap.get(poItemId) || 0;
        poItemReceivedMap.set(poItemId, currentTotal + (receivedItem.receivedQuantity || 0));
      });
    }
  });

  // Check each PO item to see if received quantity >= ordered quantity
  let fullyReceivedCount = 0;
  let partiallyReceivedCount = 0;

  this.poItems.forEach((item) => {
    const itemId = item._id.toString();
    const totalReceived = poItemReceivedMap.get(itemId) || 0;
    const orderedQuantity = item.quantity || 0;

    if (totalReceived >= orderedQuantity) {
      fullyReceivedCount++;
    } else if (totalReceived > 0) {
      partiallyReceivedCount++;
    }
  });

  // Update status based on received quantities
  const totalItems = this.poItems.length;
  let newStatus = this.currentStatus;

  if (fullyReceivedCount === totalItems) {
    // All items fully received
    newStatus = 'goods_received';
  } else if (fullyReceivedCount > 0 || partiallyReceivedCount > 0) {
    // Some items received but not all
    newStatus = 'goods_partially_received';
  }
  // If nothing received, keep current status

  // Only update if status changed
  if (newStatus !== this.currentStatus) {
    this.currentStatus = newStatus;
  }

  next();
});

const YarnPurchaseOrder = mongoose.model('YarnPurchaseOrder', yarnPurchaseOrderSchema);

export default YarnPurchaseOrder;


