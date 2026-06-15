import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

export const vendorPoReturnChallanStatuses = ['active'];

const partySchema = mongoose.Schema(
  {
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorManagement' },
    name: { type: String, trim: true },
    vendorCode: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    gstin: { type: String, trim: true },
    contactNumber: { type: String, trim: true },
    email: { type: String, trim: true },
  },
  { _id: false }
);

const challanLineSchema = mongoose.Schema(
  {
    lineType: { type: String, enum: ['box', 'm4', 'article'], required: true },
    barcode: { type: String, trim: true, default: '' },
    boxId: { type: String, trim: true, default: '' },
    lotNumber: { type: String, trim: true, default: '' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String, trim: true, default: '' },
    vendorCode: { type: String, trim: true, default: '' },
    numberOfUnits: { type: Number, min: 0, default: 0 },
    m4Quantity: { type: Number, min: 0, default: 0 },
    articleQuantity: { type: Number, min: 0, default: 0 },
    vendorProductionFlowId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProductionFlow' },
  },
  { _id: false }
);

const challanTotalsSchema = mongoose.Schema(
  {
    boxCount: { type: Number, default: 0, min: 0 },
    totalUnits: { type: Number, default: 0, min: 0 },
    m4UnitCount: { type: Number, default: 0, min: 0 },
    articleQtyCount: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const challanTransportSchema = mongoose.Schema(
  {
    vehicleNo: { type: String, trim: true, default: '' },
    driverName: { type: String, trim: true, default: '' },
    dispatchDate: { type: Date, default: null },
    transportNotes: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const challanCreatedBySchema = mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    username: { type: String, trim: true },
    email: { type: String, trim: true },
  },
  { _id: false }
);

const vendorPoReturnChallanSchema = mongoose.Schema(
  {
    challanNumber: { type: String, required: true, trim: true, unique: true },
    challanDate: { type: Date, default: Date.now },
    status: { type: String, enum: vendorPoReturnChallanStatuses, default: 'active' },
    vendorReturnId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorPoVendorReturn',
      unique: true,
    },
    vendorPurchaseOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorPurchaseOrder',
      required: true,
      index: true,
    },
    vpoNumber: { type: String, trim: true, required: true },
    vpoDate: { type: Date },
    /** Addon Holdings — sender of returned goods */
    consignor: partySchema,
    /** Garment vendor — receiver */
    vendor: partySchema,
    lines: { type: [challanLineSchema], default: [] },
    totals: { type: challanTotalsSchema, default: () => ({}) },
    cancellationIntent: { type: String, trim: true },
    remark: { type: String, trim: true, default: '' },
    transport: { type: challanTransportSchema, default: () => ({}) },
    completedAt: { type: Date },
    createdBy: challanCreatedBySchema,
  },
  { timestamps: true }
);

vendorPoReturnChallanSchema.index({ vpoNumber: 1, createdAt: -1 });
vendorPoReturnChallanSchema.plugin(toJSON);
vendorPoReturnChallanSchema.plugin(paginate);

const VendorPoReturnChallan = mongoose.model('VendorPoReturnChallan', vendorPoReturnChallanSchema);

export default VendorPoReturnChallan;
