import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

export const yarnVendorShipmentStatuses = ['open', 'closed', 'voided'];

const actorSchema = mongoose.Schema(
  {
    username: { type: String, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const supplierSnapshotSchema = mongoose.Schema(
  {
    brandName: { type: String, trim: true, default: '' },
    contactPersonName: { type: String, trim: true, default: '' },
    contactNumber: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    gstNo: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const boxLineSchema = mongoose.Schema(
  {
    boxMongoId: { type: mongoose.Schema.Types.ObjectId, ref: 'YarnBox' },
    boxId: { type: String, trim: true, required: true },
    barcode: { type: String, trim: true, required: true },
    poNumber: { type: String, trim: true, default: '' },
    lotNumber: { type: String, trim: true, default: '' },
    yarnCatalogId: { type: mongoose.Schema.Types.ObjectId, ref: 'YarnCatalog' },
    yarnName: { type: String, trim: true, default: '' },
    shadeCode: { type: String, trim: true, default: '' },
    numberOfCones: { type: Number, min: 0, default: 0 },
    boxWeight: { type: Number, min: 0, default: 0 },
    tearweight: { type: Number, min: 0, default: 0 },
    netWeight: { type: Number, min: 0, default: 0 },
    grossWeight: { type: Number, min: 0, default: 0 },
    storageLocationBefore: { type: String, trim: true, default: '' },
    qcStatus: { type: String, trim: true, default: '' },
    receivedAt: { type: Date, default: null },
    receiveNumber: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const receiveSchema = mongoose.Schema(
  {
    receiveNumber: { type: String, trim: true, required: true },
    receivingNote: { type: String, trim: true, default: '' },
    toStorageLocation: { type: String, trim: true, required: true },
    receivedAt: { type: Date, required: true },
    receivedBy: actorSchema,
    boxIds: { type: [String], default: [] },
  },
  { _id: false }
);

const yarnVendorShipmentSchema = mongoose.Schema(
  {
    shipmentNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true,
    },
    supplierSnapshot: {
      type: supplierSnapshotSchema,
      default: () => ({}),
    },
    status: {
      type: String,
      enum: yarnVendorShipmentStatuses,
      default: 'open',
      index: true,
    },
    sendingNote: { type: String, trim: true, default: '' },
    sentAt: { type: Date, required: true },
    sentBy: actorSchema,
    boxLines: { type: [boxLineSchema], default: [] },
    boxCount: { type: Number, min: 0, default: 0 },
    totalNetWeight: { type: Number, min: 0, default: 0 },
    receives: { type: [receiveSchema], default: [] },
    voidedAt: { type: Date, default: null },
    voidedBy: actorSchema,
  },
  { timestamps: true }
);

yarnVendorShipmentSchema.index({ status: 1, sentAt: -1 });
yarnVendorShipmentSchema.index({ supplierId: 1, status: 1, sentAt: -1 });
yarnVendorShipmentSchema.index({ 'boxLines.barcode': 1 });

yarnVendorShipmentSchema.plugin(toJSON);
yarnVendorShipmentSchema.plugin(paginate);

const YarnVendorShipment = mongoose.model('YarnVendorShipment', yarnVendorShipmentSchema);

export default YarnVendorShipment;
