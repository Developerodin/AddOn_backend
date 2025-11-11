import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

const itemSchema = mongoose.Schema(
  {
    yarn: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnType',
      required: true,
    },
    yarnsubtype: {
      type: String,
      trim: true,
    },
    
    quantityPurchase: {
      type: Number,
      required: true,
      min: 0,
    },
    purchaseRate: {
      type: Number,
      required: true,
      min: 0,
    },
    batchLotNo: {
      type: String,
      trim: true,
    },
    totalCost: {
      type: Number,
      required: true,
      min: 0,
    },
    weight: {
      type: Number,
      min: 0,
    },
    status: {
      type: String,
      enum: ['accepted', 'rejected', 'hold', 'pending'],
      default: 'pending',
    },
    statusRemark: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const yarnOrderSchema = mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true,
    },
    orderNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
    },
    grnNumber: {
      type: String,
      trim: true,
    },
    deliveryDate: {
      type: Date,
      required: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
    },
    items: {
      type: [itemSchema],
      default: [],
    },
    remark: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Add plugins for converting MongoDB document to JSON and pagination support
yarnOrderSchema.plugin(toJSON);
yarnOrderSchema.plugin(paginate);

/**
 * Check if order number is taken
 * @param {string} orderNumber - The order number
 * @param {ObjectId} [excludeYarnOrderId] - The id of the yarn order to be excluded
 * @returns {Promise<boolean>}
 */
yarnOrderSchema.statics.isOrderNumberTaken = async function (orderNumber, excludeYarnOrderId) {
  const yarnOrder = await this.findOne({ orderNumber, _id: { $ne: excludeYarnOrderId } });
  return !!yarnOrder;
};

/**
 * @typedef YarnOrder
 */
const YarnOrder = mongoose.model('YarnOrder', yarnOrderSchema);

export default YarnOrder;

