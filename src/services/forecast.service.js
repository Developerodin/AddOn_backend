import Forecast from '../models/forecast.model.js';
import Sales from '../models/sales.model.js';
import Product from '../models/product.model.js';
import Store from '../models/store.model.js';
import mongoose from 'mongoose';

// Helper: Get sales data for last N months for a store/product
export const getSalesData = async (storeId, productId, months = 3) => {
  // Get last N months sales, grouped by month
  const now = new Date();
  console.log('🔍 Looking for sales data for store:', storeId, 'product:', productId);
  
  const sales = await Sales.aggregate([
    { $match: { plant: mongoose.Types.ObjectId(storeId), materialCode: mongoose.Types.ObjectId(productId) } },
    { $addFields: { month: { $dateToString: { format: '%Y-%m', date: '$date' } } } },
    { $group: { _id: '$month', qtySold: { $sum: '$quantity' } } },
    { $sort: { _id: 1 } },
  ]);
  
  console.log('📊 Raw sales data found:', sales.length, 'months');
  const result = sales.slice(-months);
  console.log('📊 Returning last', months, 'months:', result);
  return result;
};

// Moving Average Forecast
export const movingAverageForecast = (salesData) => {
  if (salesData.length === 0) return 0;
  return salesData.reduce((sum, m) => sum + m.qtySold, 0) / salesData.length;
};

// Weighted Average Forecast
export const weightedAverageForecast = (salesData) => {
  const weights = [0.5, 0.3, 0.2];
  const last3 = salesData.slice(-3);
  if (last3.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < last3.length; i++) {
    sum += last3[i].qtySold * (weights[i] || 0);
  }
  return sum;
};

// Generate and save forecast for a store/product/month
export const generateForecast = async ({ storeId, productId, month, method = 'moving_average' }) => {
  const salesData = await getSalesData(storeId, productId, 3);
  console.log('📊 Sales data for forecast:', JSON.stringify(salesData, null, 2));
  
  let forecastQty = 0;
  if (method === 'moving_average') forecastQty = movingAverageForecast(salesData);
  else if (method === 'weighted_average') forecastQty = weightedAverageForecast(salesData);
  
  console.log('📈 Forecast quantity calculated:', forecastQty);
  
  // TODO: Add seasonal adjustment if needed
  const forecast = await Forecast.findOneAndUpdate(
    { store: storeId, product: productId, month },
    { forecastQty, method },
    { upsert: true, new: true }
  ).populate('store product');
  
  return forecast;
};

// Get forecasts (with filters)
export const getForecasts = async (filter = {}, options = {}) => {
  return Forecast.paginate(filter, options);
};

// Get single forecast
export const getForecast = async (storeId, productId, month) => {
  return Forecast.findOne({ store: storeId, product: productId, month });
};

// Update forecast (actual sales, accuracy)
export const updateForecast = async (id, updateBody) => {
  const forecast = await Forecast.findById(id);
  if (!forecast) throw new Error('Forecast not found');
  Object.assign(forecast, updateBody);
  if (updateBody.actualQty != null) {
    forecast.accuracy = 100 - (Math.abs(forecast.forecastQty - updateBody.actualQty) / (updateBody.actualQty || 1)) * 100;
  }
  await forecast.save();
  return forecast;
}; 