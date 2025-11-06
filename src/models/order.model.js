import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const customerAddressSchema = mongoose.Schema({
  street: String,
  city: String,
  state: String,
  country: String,
  zipCode: String,
  addressLine1: String,
  addressLine2: String,
}, { _id: false });

const customerSchema = mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  phone: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
  },
  address: {
    type: customerAddressSchema,
    default: {},
  },
}, { _id: false });

const orderItemSchema = mongoose.Schema({
  sku: {
    type: String,
    required: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
}, { _id: false });

const paymentSchema = mongoose.Schema({
  method: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending',
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
}, { _id: false });

const logisticsSchema = mongoose.Schema({
  status: {
    type: String,
    enum: ['pending', 'picked', 'packed', 'shipped', 'delivered', 'cancelled'],
    default: 'pending',
  },
  trackingId: {
    type: String,
    trim: true,
  },
  warehouse: {
    type: String,
    trim: true,
  },
  picker: {
    type: String,
    trim: true,
  },
}, { _id: false });

const orderSchema = mongoose.Schema(
  {
    source: {
      type: String,
      enum: ['Website', 'Amazon', 'Flipkart', 'Blinkit'],
      required: true,
    },
    externalOrderId: {
      type: String,
      required: true,
      trim: true,
    },
    customer: {
      type: customerSchema,
      required: true,
    },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'Order must have at least one item',
      },
    },
    payment: {
      type: paymentSchema,
      required: true,
    },
    logistics: {
      type: logisticsSchema,
      default: () => ({}),
    },
    orderStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'cancelled', 'refunded'],
      default: 'pending',
    },
    timestamps: {
      createdAt: {
        type: Date,
        default: Date.now,
      },
      updatedAt: {
        type: Date,
        default: Date.now,
      },
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Composite unique index to prevent duplicate orders from same source
orderSchema.index({ source: 1, externalOrderId: 1 }, { unique: true });

// Indexes for common queries
orderSchema.index({ source: 1, orderStatus: 1 });
orderSchema.index({ 'customer.email': 1 });
orderSchema.index({ 'logistics.trackingId': 1 });
orderSchema.index({ createdAt: -1 });

// Add plugins
orderSchema.plugin(toJSON);
orderSchema.plugin(paginate);

/**
 * Find order by source and external order ID
 * @param {string} source - Order source
 * @param {string} externalOrderId - External order ID
 * @returns {Promise<Order|null>}
 */
orderSchema.statics.findBySourceAndExternalId = async function (source, externalOrderId) {
  return this.findOne({ source, externalOrderId });
};

/**
 * @typedef Order
 */
const Order = mongoose.model('Order', orderSchema);

export default Order;
