import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import salesValidation from '../../validations/sales.validation.js';
import * as salesController from '../../controllers/sales.controller.js';

const router = express.Router();

router
  .route('/')
  .post(
    validate(salesValidation.createSales),
    salesController.createSales
  )
  .get(
    validate(salesValidation.getSales),
    salesController.getSales
  );

router
  .route('/bulk-import')
  .post(
    
    validate(salesValidation.bulkImportSales),
    salesController.bulkImportSales
  );

router
  .route('/:salesId')
  .get(
  
    validate(salesValidation.getSalesRecord),
    salesController.getSalesRecord
  )
  .patch(
    
    validate(salesValidation.updateSales),
    salesController.updateSales
  )
  .delete(
 
    validate(salesValidation.deleteSales),
    salesController.deleteSales
  );

// Debug route for development
router.get('/debug/query', salesController.debugQuery);

export default router; 