import express from 'express';
import * as replenishmentController from '../../controllers/replenishment.controller.js';

const router = express.Router();

router.get('/', replenishmentController.getReplenishments);
router.post('/calculate', replenishmentController.generateReplenishment);
router.get('/:storeId/:productId/:month', replenishmentController.getReplenishmentById);

export default router; 