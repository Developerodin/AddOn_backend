import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const customerAddressSchema = mongoose.Schema(
  {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String,
    addressLine1: String,
    addressLine2: String,
  },
  { _id: false }
);

const customerSchema = mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: customerAddressSchema, default: {} },
  },
  { _id: false }
);

const orderItemSchema = mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, min: 0 },
    totalPrice: { type: Number, min: 0 },
    productId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Product' },
    stockAvailable: { type: Number, min: 0 },
    stockQuantity: { type: Number, min: 0 },
  },
  { _id: false }
);

const trackingSchema = mongoose.Schema(
  {
    courierName: { type: String, trim: true },
    trackingNumber: { type: String, trim: true },
    dispatchDate: { type: Date },
    vehicleAwb: { type: String, trim: true },
    remarks: { type: String, trim: true },
  },
  { _id: false }
);

const packingInstructionsSchema = mongoose.Schema(
  {
    fragile: { type: Boolean, default: false },
    packagingType: { type: String, trim: true },
    specialHandling: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const whmsOrderSchema = mongoose.Schema(
  {
    orderNumber: { type: String, trim: true, unique: true, sparse: true },
    date: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'packed', 'dispatched', 'cancelled'],
      default: 'pending',
    },
    channel: {
      type: String,
      enum: ['online', 'retail', 'wholesale', 'marketplace', 'direct'],
      default: 'online',
    },
    customer: { type: customerSchema, required: true },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: { validator: (v) => Array.isArray(v) && v.length > 0, message: 'Order must have at least one item' },
    },
    packingInstructions: { type: packingInstructionsSchema },
    dispatchMode: {
      type: String,
      enum: ['standard', 'express', 'overnight', 'pickup'],
      default: 'standard',
    },
    totalValue: { type: Number, min: 0 },
    totalQuantity: { type: Number, min: 0 },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    estimatedDispatchDate: { type: Date },
    actualDispatchDate: { type: Date },
    stockBlockStatus: {
      type: String,
      enum: ['available', 'tentative-block', 'pick-block'],
      default: 'tentative-block',
    },
    lifecycleStatus: {
      type: String,
      enum: [
        'order-received',
        'picking-done',
        'ready-for-barcode',
        'ready-for-scanning',
        'scanning-done',
        'billing-done-dispatch-pending',
        'dispatched',
      ],
      default: 'order-received',
    },
    tracking: { type: trackingSchema },
    source: { type: String, trim: true },
    payment: { type: mongoose.Schema.Types.Mixed },
    logistics: { type: mongoose.Schema.Types.Mixed },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

whmsOrderSchema.index({ orderNumber: 1 });
whmsOrderSchema.index({ status: 1, channel: 1 });
whmsOrderSchema.index({ createdAt: -1 });
whmsOrderSchema.index({ 'customer.email': 1 });

whmsOrderSchema.plugin(toJSON);
whmsOrderSchema.plugin(paginate);

const WhmsOrder = mongoose.model('WhmsOrder', whmsOrderSchema);
export default WhmsOrder;
