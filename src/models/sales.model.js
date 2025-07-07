import mongoose from 'mongoose';
import toJSON from './plugins/toJSON.plugin.js';
import paginate from './plugins/paginate.plugin.js';

const salesSchema = mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    plant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
    },
    materialCode: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    mrp: {
      type: Number,
      required: true,
      min: 0,
    },
    discount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    gsv: {
      type: Number,
      required: true,
      min: 0,
    },
    nsv: {
      type: Number,
      required: true,
      min: 0,
    },
    totalTax: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  { timestamps: true }
);

// Add plugins for converting MongoDB document to JSON and pagination support
salesSchema.plugin(toJSON);
salesSchema.plugin(paginate);

/**
 * Check if sales record exists for given plant, material and date
 * @param {ObjectId} plant - The plant/store ID
 * @param {ObjectId} materialCode - The material/product ID
 * @param {Date} date - The sales date
 * @param {ObjectId} [excludeSalesId] - The id of the sales record to be excluded
 * @returns {Promise<boolean>}
 */
salesSchema.statics.isSalesRecordExists = async function (plant, materialCode, date, excludeSalesId) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  const sales = await this.findOne({
    plant,
    materialCode,
    date: { $gte: startOfDay, $lte: endOfDay },
    _id: { $ne: excludeSalesId }
  });
  return !!sales;
};

/**
 * @typedef Sales
 */
const Sales = mongoose.model('Sales', salesSchema);

export default Sales; 