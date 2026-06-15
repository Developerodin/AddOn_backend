import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as validation from '../../validations/vendorPoVendorReturn.validation.js';
import * as controller from '../../controllers/vendorManagement/vendorPoVendorReturn.controller.js';

const router = express.Router();

router
  .route('/history')
  .get(auth(), validate(validation.listVendorReturnHistory), controller.getHistory);

router
  .route('/article-candidates')
  .get(auth(), validate(validation.getArticleReturnCandidates), controller.getArticleCandidates);

router
  .route('/m4-candidates')
  .get(auth(), validate(validation.getM4ReturnCandidates), controller.getM4Candidates);

router
  .route('/sessions')
  .post(auth(), validate(validation.createVendorReturnSession), controller.createSession);

router
  .route('/sessions/:sessionId')
  .get(auth(), validate(validation.getVendorReturnSession), controller.getSession);

router
  .route('/sessions/:sessionId/scan')
  .post(auth(), validate(validation.scanVendorReturnBarcode), controller.scanBarcode)
  .delete(auth(), validate(validation.removeVendorReturnBarcode), controller.removeBarcode);

router
  .route('/sessions/:sessionId/article-qty-lines')
  .post(auth(), validate(validation.addVendorReturnArticleQtyLine), controller.addArticleQtyLine)
  .delete(auth(), validate(validation.removeVendorReturnArticleQtyLine), controller.removeArticleQtyLine);

router
  .route('/sessions/:sessionId/m4-lines')
  .post(auth(), validate(validation.addVendorReturnM4Line), controller.addM4Line)
  .delete(auth(), validate(validation.removeVendorReturnM4Line), controller.removeM4Line);

router
  .route('/sessions/:sessionId/finalize')
  .post(auth(), validate(validation.finalizeVendorReturnSession), controller.finalizeSession);

export default router;
