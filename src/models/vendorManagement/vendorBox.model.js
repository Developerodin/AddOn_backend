import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import Product from '../product.model.js';

const qcDataSchema = mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    username: { type: String, trim: true },
    date: { type: Date },
    remarks: { type: String, trim: true },
    status: { type: String, trim: true },
  },
  { _id: false }
);

const vendorBoxSchema = mongoose.Schema(
  {
    boxId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    vpoNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    vendorPurchaseOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorPurchaseOrder',
      required: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorManagement',
    },
    /** PO line item subdocument _id (VendorPurchaseOrder.poItems) */
    vendorPoItemId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    receivedDate: { type: Date },
    orderDate: { type: Date },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    },
    productName: {
      type: String,
      trim: true,
    },
    lotNumber: {
      type: String,
      trim: true,
    },
    orderQty: {
      type: Number,
      min: 0,
    },
    boxWeight: {
      type: Number,
      min: 0,
    },
    grossWeight: {
      type: Number,
      min: 0,
    },
    barcode: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    numberOfUnits: {
      type: Number,
      min: 0,
    },
    tearweight: {
      type: Number,
      min: 0,
      default: 0,
    },
    qcData: qcDataSchema,
    storageLocation: {
      type: String,
      trim: true,
    },
    storedStatus: {
      type: Boolean,
      default: false,
    },
    /** True once the box has been scanned/accepted on the secondary checking floor. */
    secondaryCheckingAccepted: {
      type: Boolean,
      default: false,
    },
    secondaryCheckingAcceptedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

vendorBoxSchema.pre('save', async function syncVendorBox(next) {
  if (!this.barcode) {
    this.barcode = this.id;
  }
  try {
    if (this.productId) {
      const product = await Product.findById(this.productId).select('name').lean();
      if (product?.name) {
        this.productName = product.name;
      }
    }
  } catch (e) {
    console.error('[VendorBox] product link:', e.message);
  }
  if (!this.productName || !String(this.productName).trim()) {
    return next(new Error('VendorBox requires productName or a valid productId'));
  }
  return next();
});

vendorBoxSchema.plugin(toJSON);
vendorBoxSchema.plugin(paginate);

vendorBoxSchema.index({ vpoNumber: 1, lotNumber: 1 });

const VendorBox = mongoose.model('VendorBox', vendorBoxSchema);

export default VendorBox;
