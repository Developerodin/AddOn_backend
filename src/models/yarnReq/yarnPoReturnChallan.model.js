import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

export const yarnPoReturnChallanStatuses = ['active'];

const challanSupplierSchema = mongoose.Schema(
  {
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
    name: { type: String, trim: true },
    contactPersonName: { type: String, trim: true },
    contactNumber: { type: String, trim: true },
    email: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    country: { type: String, trim: true },
    gstNo: { type: String, trim: true },
  },
  { _id: false }
);

const challanConsigneeSchema = mongoose.Schema(
  {
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
    name: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    country: { type: String, trim: true },
    contactNumber: { type: String, trim: true },
    contactPersonName: { type: String, trim: true },
    email: { type: String, trim: true },
    stateCode: { type: String, trim: true },
    gstNo: { type: String, trim: true },
  },
  { _id: false }
);

const challanLineSchema = mongoose.Schema(
  {
    lineType: { type: String, enum: ['cone', 'box'], default: 'cone' },
    barcode: { type: String, trim: true, required: true },
    coneId: { type: mongoose.Schema.Types.ObjectId, ref: 'YarnCone' },
    boxId: { type: String, trim: true },
    lotNumber: { type: String, trim: true, default: '' },
    yarnCatalogId: { type: mongoose.Schema.Types.ObjectId, ref: 'YarnCatalog' },
    yarnName: { type: String, trim: true, default: '' },
    hsnCode: { type: String, trim: true },
    coneWeight: { type: Number, min: 0, default: 0 },
    tearWeight: { type: Number, min: 0, default: 0 },
    netWeight: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const challanTotalsSchema = mongoose.Schema(
  {
    boxCount: { type: Number, default: 0, min: 0 },
    coneCount: { type: Number, default: 0, min: 0 },
    totalNetWeight: { type: Number, default: 0, min: 0 },
    totalGrossWeight: { type: Number, default: 0, min: 0 },
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

const yarnPoReturnChallanSchema = mongoose.Schema(
  {
    challanNumber: { type: String, required: true, trim: true, unique: true },
    challanDate: { type: Date, default: Date.now },
    status: { type: String, enum: yarnPoReturnChallanStatuses, default: 'active' },
    vendorReturnId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnPoVendorReturn',
      required: true,
      unique: true,
    },
    purchaseOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnPurchaseOrder',
      required: true,
    },
    poNumber: { type: String, required: true, trim: true },
    poDate: { type: Date },
    supplier: challanSupplierSchema,
    consignee: challanConsigneeSchema,
    lines: { type: [challanLineSchema], default: [] },
    totals: challanTotalsSchema,
    cancellationIntent: { type: String, enum: ['partial', 'full_po'], required: true },
    remark: { type: String, trim: true, default: '' },
    transport: { type: challanTransportSchema, default: () => ({}) },
    completedAt: { type: Date },
    createdBy: challanCreatedBySchema,
    isLegacy: { type: Boolean, default: false },
  },
  { timestamps: true }
);

yarnPoReturnChallanSchema.index({ challanNumber: 1 });
yarnPoReturnChallanSchema.index({ poNumber: 1 });
yarnPoReturnChallanSchema.index({ purchaseOrder: 1, status: 1 });
yarnPoReturnChallanSchema.index({ challanDate: -1 });
yarnPoReturnChallanSchema.index({ createdAt: -1 });
yarnPoReturnChallanSchema.index({ status: 1 });
yarnPoReturnChallanSchema.index({ 'supplier.name': 1 });
yarnPoReturnChallanSchema.index({ 'consignee.name': 1 });

yarnPoReturnChallanSchema.plugin(toJSON);
yarnPoReturnChallanSchema.plugin(paginate);

const YarnPoReturnChallan = mongoose.model('YarnPoReturnChallan', yarnPoReturnChallanSchema);

export default YarnPoReturnChallan;
