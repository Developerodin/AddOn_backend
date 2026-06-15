import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

export const vendorGrnStatuses = ['active', 'superseded', 'voided'];

const grnItemSchema = mongoose.Schema(
  {
    poItem: { type: mongoose.Schema.Types.ObjectId },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String, trim: true },
    vendorCode: { type: String, trim: true },
    expectedQty: { type: Number, default: 0, min: 0 },
    scanAcceptedQty: { type: Number, default: 0, min: 0 },
    verifiedQty: { type: Number, default: 0, min: 0 },
    m1: { type: Number, default: 0, min: 0 },
    m2: { type: Number, default: 0, min: 0 },
    m3: { type: Number, default: 0, min: 0 },
    m4: { type: Number, default: 0, min: 0 },
    varianceQty: { type: Number, default: 0 },
    vendorProductionFlowId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProductionFlow' },
    boxIds: { type: [String], default: [] },
  },
  { _id: false }
);

const grnLotSchema = mongoose.Schema(
  {
    lotNumber: { type: String, required: true, trim: true },
    numberOfBoxes: { type: Number, default: 0, min: 0 },
    totalUnits: { type: Number, default: 0, min: 0 },
    items: { type: [grnItemSchema], default: [] },
  },
  { _id: false }
);

const vendorSnapshotSchema = mongoose.Schema(
  {
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorManagement' },
    vendorName: { type: String, trim: true },
    vendorCode: { type: String, trim: true },
    gstin: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
  },
  { _id: false }
);

const grnTotalsSchema = mongoose.Schema(
  {
    expected: { type: Number, default: 0, min: 0 },
    verified: { type: Number, default: 0, min: 0 },
    variance: { type: Number, default: 0 },
    m1: { type: Number, default: 0, min: 0 },
    m2: { type: Number, default: 0, min: 0 },
    m3: { type: Number, default: 0, min: 0 },
    m4: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const grnCreatedBySchema = mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    username: { type: String, trim: true },
    email: { type: String, trim: true },
  },
  { _id: false }
);

const grnRevisionDiffEntrySchema = mongoose.Schema(
  {
    field: { type: String, trim: true, required: true },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const vendorGrnSchema = mongoose.Schema(
  {
    grnNumber: { type: String, required: true, trim: true, unique: true },
    grnDate: { type: Date, default: Date.now },
    status: { type: String, enum: vendorGrnStatuses, default: 'active' },
    baseGrnNumber: { type: String, trim: true, required: true },
    revisionOf: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorGrn', default: null },
    revisionNo: { type: Number, default: 0, min: 0 },
    revisionReason: { type: String, trim: true },
    revisionDiff: { type: [grnRevisionDiffEntrySchema], default: [] },
    supersededAt: { type: Date, default: null },
    supersededByGrn: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorGrn', default: null },
    vendorPurchaseOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorPurchaseOrder',
      required: true,
      index: true,
    },
    vpoNumber: { type: String, trim: true },
    vpoDate: { type: Date },
    vendor: vendorSnapshotSchema,
    lots: { type: [grnLotSchema], default: [] },
    totals: { type: grnTotalsSchema, default: () => ({}) },
    secondaryCheckingCompletedAt: { type: Date },
    incompleteClassification: { type: Boolean, default: false },
    discrepancyDetails: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    createdBy: grnCreatedBySchema,
  },
  { timestamps: true }
);

vendorGrnSchema.index({ vpoNumber: 1, status: 1 });
vendorGrnSchema.index({ 'lots.lotNumber': 1 });
vendorGrnSchema.index({ 'lots.items.vendorProductionFlowId': 1 });

vendorGrnSchema.plugin(toJSON);
vendorGrnSchema.plugin(paginate);

const VendorGrn = mongoose.model('VendorGrn', vendorGrnSchema);

export default VendorGrn;
