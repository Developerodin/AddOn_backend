import * as replenishmentService from '../services/replenishment.service.js';
import catchAsync from '../utils/catchAsync.js';

export const getReplenishments = catchAsync(async (req, res) => {
  const replenishments = await replenishmentService.getReplenishments(req.query, { populate: 'store,product' });
  res.json(replenishments);
});

export const generateReplenishment = catchAsync(async (req, res) => {
  const { storeId, productId, month, currentStock, variability, method } = req.body;
  const replenishment = await replenishmentService.generateReplenishment({ storeId, productId, month, currentStock, variability, method });
  res.status(201).json(replenishment);
});

export const getReplenishmentById = catchAsync(async (req, res) => {
  const { storeId, productId, month } = req.params;
  const replenishment = await replenishmentService.getReplenishment(storeId, productId, month);
  if (!replenishment) return res.status(404).json({ message: 'Replenishment not found' });
  res.json(replenishment);
}); 