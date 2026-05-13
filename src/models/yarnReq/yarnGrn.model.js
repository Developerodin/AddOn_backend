import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

export const yarnGrnStatuses = ['active', 'superseded', 'voided'];

/**
 * Snapshot of a single line item exactly as printed on the GRN.
 * Stored verbatim so future edits to the parent PO never mutate historical GRNs.
 */
const grnItemSchema = mongoose.Schema(
  {
    poItem: { type: mongoose.Schema.Types.ObjectId },
    yarnName: { type: String, trim: true },
    yarnCatalogId: { type: mongoose.Schema.Types.ObjectId, ref: 'YarnCatalog' },
    sizeCount: { type: String, trim: true },
    shadeCode: { type: String, trim: true },
    pantoneName: { type: String, trim: true },
    quantity: { type: Number, default: 0, min: 0 },
    rate: { type: Number, default: 0, min: 0 },
    amount: { type: Number, default: 0, min: 0 },
    gstRate: { type: Number, default: 0, min: 0 },
    unit: { type: String, trim: true, default: 'KGS' },
  },
  { _id: false }
);

const grnLotPoItemSchema = mongoose.Schema(
  {
    poItem: { type: mongoose.Schema.Types.ObjectId },
    receivedQuantity: { type: Number, default: 0, min: 0 },
    yarnName: { type: String, trim: true },
    sizeCount: { type: String, trim: true },
    shadeCode: { type: String, trim: true },
    rate: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const grnLotSchema = mongoose.Schema(
  {
    lotNumber: { type: String, required: true, trim: true },
    numberOfCones: { type: Number, default: 0, min: 0 },
    /** Gross weight (kg); mirrors PO receivedLotDetails.totalWeight */
    totalWeight: { type: Number, default: 0, min: 0 },
    /** Net weight (kg); mirrors PO receivedLotDetails.netWeight */
    netWeight: { type: Number, default: 0, min: 0 },
    numberOfBoxes: { type: Number, default: 0, min: 0 },
    poItems: { type: [grnLotPoItemSchema], default: [] },
    voided: { type: Boolean, default: false },
  },
  { _id: false }
);

const grnSupplierSchema = mongoose.Schema(
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

const grnConsigneeSchema = mongoose.Schema(
  {
    name: { type: String, trim: true },
    address: { type: String, trim: true },
    stateCode: { type: String, trim: true },
    gstNo: { type: String, trim: true },
  },
  { _id: false }
);

const grnTotalsSchema = mongoose.Schema(
  {
    subTotal: { type: Number, default: 0, min: 0 },
    sgst: { type: Number, default: 0, min: 0 },
    cgst: { type: Number, default: 0, min: 0 },
    igst: { type: Number, default: 0, min: 0 },
    gst: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, default: 0, min: 0 },
    totalQty: { type: Number, default: 0, min: 0 },
    taxLabel: { type: String, trim: true, default: '' },
    amountInWords: { type: String, trim: true, default: '' },
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

const yarnGrnSchema = mongoose.Schema(
  {
    grnNumber: { type: String, required: true, trim: true, unique: true },
    grnDate: { type: Date, default: Date.now },

    status: { type: String, enum: yarnGrnStatuses, default: 'active' },

    // Revision metadata
    baseGrnNumber: { type: String, trim: true, required: true },
    revisionOf: { type: mongoose.Schema.Types.ObjectId, ref: 'YarnGrn', default: null },
    revisionNo: { type: Number, default: 0, min: 0 },
    revisionReason: { type: String, trim: true },
    revisionDiff: { type: [grnRevisionDiffEntrySchema], default: [] },
    supersededAt: { type: Date },
    supersededByGrn: { type: mongoose.Schema.Types.ObjectId, ref: 'YarnGrn', default: null },

    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'YarnPurchaseOrder', required: true },
    poNumber: { type: String, required: true, trim: true },
    poDate: { type: Date },

    supplier: grnSupplierSchema,
    consignee: grnConsigneeSchema,

    lots: { type: [grnLotSchema], default: [] },
    items: { type: [grnItemSchema], default: [] },
    totals: grnTotalsSchema,

    vendorInvoiceNo: { type: String, trim: true },
    vendorInvoiceDate: { type: Date },
    discrepancyDetails: { type: String, trim: true },
    notes: { type: String, trim: true },

    isLegacy: { type: Boolean, default: false },

    createdBy: grnCreatedBySchema,
  },
  { timestamps: true }
);

yarnGrnSchema.index({ grnNumber: 1 });
yarnGrnSchema.index({ baseGrnNumber: 1, revisionNo: -1 });
yarnGrnSchema.index({ poNumber: 1 });
yarnGrnSchema.index({ purchaseOrder: 1, status: 1 });
yarnGrnSchema.index({ 'lots.lotNumber': 1 });
yarnGrnSchema.index({ grnDate: -1 });
yarnGrnSchema.index({ createdAt: -1 });
yarnGrnSchema.index({ status: 1 });

yarnGrnSchema.plugin(toJSON);
yarnGrnSchema.plugin(paginate);

const YarnGrn = mongoose.model('YarnGrn', yarnGrnSchema);

export default YarnGrn;
