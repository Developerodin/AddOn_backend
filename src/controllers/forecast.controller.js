import * as forecastService from '../services/forecast.service.js';
import catchAsync from '../utils/catchAsync.js';

export const getForecasts = catchAsync(async (req, res) => {
  const forecasts = await forecastService.getForecasts(req.query, { populate: 'store,product' });
  res.json(forecasts);
});

export const generateForecast = catchAsync(async (req, res) => {
  const { storeId, productId, month, method } = req.body;
  const forecast = await forecastService.generateForecast({ storeId, productId, month, method });
  res.status(201).json(forecast);
});

export const getForecastById = catchAsync(async (req, res) => {
  const { storeId, productId, month } = req.params;
  const forecast = await forecastService.getForecast(storeId, productId, month);
  if (!forecast) return res.status(404).json({ message: 'Forecast not found' });
  res.json(forecast);
});

export const updateForecast = catchAsync(async (req, res) => {
  const { id } = req.params;
  const forecast = await forecastService.updateForecast(id, req.body);
  res.json(forecast);
}); 