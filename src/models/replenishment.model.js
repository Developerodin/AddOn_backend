import mongoose from 'mongoose';
import toJSON from './plugins/toJSON.plugin.js';
import paginate from './plugins/paginate.plugin.js';

const replenishmentSchema = mongoose.Schema(
  {
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    month: {
      type: String, // 'YYYY-MM'
      required: true,
    },
    forecastQty: {
      type: Number,
      required: true,
    },
    currentStock: {
      type: Number,
      required: true,
    },
    safetyBuffer: {
      type: Number,
      required: true,
    },
    replenishmentQty: {
      type: Number,
      required: true,
    },
    method: {
      type: String,
      enum: ['moving_average', 'weighted_average', 'seasonal_adjustment'],
      default: 'moving_average',
    },
  },
  { timestamps: true }
);

replenishmentSchema.plugin(toJSON);
replenishmentSchema.plugin(paginate);

const Replenishment = mongoose.model('Replenishment', replenishmentSchema);

export default Replenishment; 