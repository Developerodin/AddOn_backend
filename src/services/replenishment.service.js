import Replenishment from '../models/replenishment.model.js';
import Forecast from '../models/forecast.model.js';
import Product from '../models/product.model.js';
import Store from '../models/store.model.js';

// Calculate safety buffer
export const calcSafetyBuffer = (forecastQty, variability = 'standard') => {
  if (variability === 'high') return Math.ceil(forecastQty * 0.25);
  if (variability === 'seasonal') return Math.ceil(forecastQty * 0.35);
  return Math.ceil(forecastQty * 0.12);
};

// Calculate replenishment quantity
export const calcReplenishmentQty = ({ forecastQty, currentStock, safetyBuffer }) => {
  let replenishment = Math.max(0, Math.round(forecastQty - currentStock + safetyBuffer));
  if (replenishment < 5) replenishment = 5;
  if (replenishment > forecastQty * 2) replenishment = Math.round(forecastQty * 2);
  return replenishment;
};

// Generate and save replenishment for a store/product/month
export const generateReplenishment = async ({ storeId, productId, month, currentStock, variability = 'standard', method = 'moving_average' }) => {
  const forecast = await Forecast.findOne({ store: storeId, product: productId, month });
  if (!forecast) throw new Error('Forecast not found');
  const safetyBuffer = calcSafetyBuffer(forecast.forecastQty, variability);
  const replenishmentQty = calcReplenishmentQty({ forecastQty: forecast.forecastQty, currentStock, safetyBuffer });
  const replenishment = await Replenishment.findOneAndUpdate(
    { store: storeId, product: productId, month },
    { forecastQty: forecast.forecastQty, currentStock, safetyBuffer, replenishmentQty, method },
    { upsert: true, new: true }
  ).populate('store product');
  return replenishment;
};

// Get replenishments (with filters)
export const getReplenishments = async (filter = {}, options = {}) => {
  // Add populate to options if not already present
  if (!options.populate) {
    options.populate = 'store,product';
  }
  
  return Replenishment.paginate(filter, options);
};

// Get single replenishment
export const getReplenishment = async (storeId, productId, month) => {
  return Replenishment.findOne({ store: storeId, product: productId, month });
}; 