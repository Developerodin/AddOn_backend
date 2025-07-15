import mongoose from 'mongoose';
import toJSON from './plugins/toJSON.plugin.js';
import paginate from './plugins/paginate.plugin.js';

const forecastSchema = mongoose.Schema(
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
    actualQty: {
      type: Number,
      default: null,
    },
    accuracy: {
      type: Number,
      default: null, // percentage
    },
    method: {
      type: String,
      enum: ['moving_average', 'weighted_average', 'seasonal_adjustment'],
      default: 'moving_average',
    },
  },
  { timestamps: true }
);

forecastSchema.plugin(toJSON);
forecastSchema.plugin(paginate);

const Forecast = mongoose.model('Forecast', forecastSchema);

export default Forecast; 