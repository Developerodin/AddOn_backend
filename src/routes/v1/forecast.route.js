import express from 'express';
import * as forecastController from '../../controllers/forecast.controller.js';

const router = express.Router();

router.get('/', forecastController.getForecasts);
router.post('/generate', forecastController.generateForecast);
router.get('/:storeId/:productId/:month', forecastController.getForecastById);
router.put('/:id', forecastController.updateForecast);

export default router; 