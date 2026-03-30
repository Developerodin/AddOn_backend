import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import Product from '../product.model.js';
import VendorManagement from './vendorManagement.model.js';

/** Aligned with yarn PO flow; adjust enums as business rules evolve */
export const vendorPurchaseOrderStatuses = [
  'submitted_to_vendor',
  'in_transit',
  'goods_partially_received',
  'goods_received',
  'qc_pending',
  'po_rejected',
  'po_accepted',
  'po_accepted_partially',
];

export const vendorLotStatuses = ['lot_pending', 'lot_qc_pending', 'lot_rejected', 'lot_accepted'];

const statusLogSchema = mongoose.Schema(
  {
    statusCode: { type: String, enum: vendorPurchaseOrderStatuses, required: true },
    updatedBy: {
      username: { type: String, required: true, trim: true },
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    },
    updatedAt: { type: Date, default: Date.now },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const poItemSchema = mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    productName: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    rate: {
      type: Number,
      required: true,
      min: 0,
    },
    gstRate: {
      type: Number,
      min: 0,
    },
    estimatedDeliveryDate: {
      type: Date,
    },
    /** Free-text line fields; set by client (not synced from Product / ProductAttribute) */
    type: {
      type: String,
      trim: true,
    },
    color: {
      type: String,
      trim: true,
    },
    pattern: {
      type: String,
      trim: true,
    },
  },
  { _id: true }
);

const receivedLotDetailsSchema = mongoose.Schema(
  {
    lotNumber: { type: String, required: true, trim: true },
    numberOfBoxes: { type: Number, min: 0 },
    totalUnits: { type: Number, min: 0 },
    poItems: {
      type: [
        {
          poItem: { type: mongoose.Schema.Types.ObjectId, required: true },
          receivedQuantity: { type: Number, required: true, min: 0 },
          receivedBoxes: { type: Number, min: 0, default: 0 },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: vendorLotStatuses,
      default: 'lot_pending',
    },
  },
  { _id: false }
);

const packListDetailsSchema = mongoose.Schema(
  {
    poItems: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    packingNumber: { type: String, trim: true },
    courierName: { type: String, trim: true },
    courierNumber: { type: String, trim: true },
    vehicleNumber: { type: String, trim: true },
    challanNumber: { type: String, trim: true },
    dispatchDate: { type: Date },
    estimatedDeliveryDate: { type: Date },
    notes: { type: String, trim: true },
    numberOfBoxes: { type: Number, min: 0 },
    totalUnits: { type: Number, min: 0 },
    files: {
      type: [
        {
          url: { type: String, required: true, trim: true },
          key: { type: String, required: true, trim: true },
          originalName: { type: String, required: true, trim: true },
          mimeType: { type: String, required: true, trim: true },
          size: { type: Number, required: true, min: 0 },
        },
      ],
      default: [],
    },
  },
  { _id: false }
);

const supplierSnapshotSchema = mongoose.Schema(
  {
    vendorName: { type: String, trim: true },
    vendorCode: { type: String, trim: true },
  },
  { _id: false }
);

const vendorPurchaseOrderSchema = mongoose.Schema(
  {
    vpoNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorManagement',
      required: true,
    },
    /** Denormalized; filled from VendorManagement in pre('validate') if missing */
    vendorName: {
      type: String,
      trim: true,
    },
    vendorSnapshot: supplierSnapshotSchema,
    poItems: {
      type: [poItemSchema],
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: 'At least one PO item is required',
      },
    },
    notes: { type: String, trim: true },
    subTotal: { type: Number, required: true, min: 0 },
    gst: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    goodsReceivedDate: { type: Date },
    creditDays: { type: Number, min: 0 },
    estimatedOrderDeliveryDate: { type: Date },
    currentStatus: {
      type: String,
      enum: vendorPurchaseOrderStatuses,
      default: 'submitted_to_vendor',
    },
    statusLogs: { type: [statusLogSchema], default: [] },
    receivedLotDetails: { type: [receivedLotDetailsSchema], default: [] },
    packListDetails: { type: [packListDetailsSchema], default: [] },
  },
  {
    timestamps: { createdAt: 'createDate', updatedAt: 'lastUpdateDate' },
  }
);

vendorPurchaseOrderSchema.plugin(toJSON);
vendorPurchaseOrderSchema.plugin(paginate);

/** Runs before required-field validation so vendorName is present when client omits it */
vendorPurchaseOrderSchema.pre('validate', async function syncVendorNameBeforeValidate(next) {
  if (!this.vendor) return next();
  try {
    const vm = await VendorManagement.findById(this.vendor).select('header.vendorName header.vendorCode').lean();
    if (!vm?.header) return next();
    if (!this.vendorName || !String(this.vendorName).trim()) {
      this.vendorName = vm.header.vendorName || this.vendorName;
    }
    this.vendorSnapshot = {
      vendorName: vm.header.vendorName,
      vendorCode: vm.header.vendorCode,
    };
  } catch (err) {
    return next(err);
  }
  return next();
});

vendorPurchaseOrderSchema.pre('save', async function syncVendorPurchaseOrder(next) {
  if (this.isModified('vendor') || !this.vendorName) {
    const vm = await VendorManagement.findById(this.vendor).select('header.vendorName header.vendorCode').lean();
    if (vm?.header) {
      this.vendorName = vm.header.vendorName || this.vendorName;
      this.vendorSnapshot = {
        vendorName: vm.header.vendorName,
        vendorCode: vm.header.vendorCode,
      };
    }
  }

  if (this.isModified('poItems')) {
    const productCache = new Map();
    const loadProduct = async (productId) => {
      const key = String(productId);
      if (productCache.has(key)) return productCache.get(key);
      const p = await Product.findById(productId).select('name').lean();
      productCache.set(key, p);
      return p;
    };

    await Promise.all(
      this.poItems.map(async (item) => {
        if (!item.productId) return;
        const product = await loadProduct(item.productId);
        if (product?.name) {
          // Mongoose subdocument: sync denormalized name from Product
          // eslint-disable-next-line no-param-reassign -- intentional subdoc field update
          item.productName = product.name;
        }
      })
    );
  }

  next();
});

const VendorPurchaseOrder = mongoose.model('VendorPurchaseOrder', vendorPurchaseOrderSchema);

export default VendorPurchaseOrder;
