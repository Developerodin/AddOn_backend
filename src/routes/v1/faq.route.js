import express from 'express';
import faqController from '../../controllers/faq.controller.js';
import validate from '../../middlewares/validate.js';
import faqValidation from '../../validations/faq.validation.js';

const router = express.Router();

/**
 * @route POST /v1/faq/train-faq
 * @desc Train FAQ with embeddings
 * @access Public (for now, can add auth middleware later)
 */
router.post(
  '/train-faq',
  validate(faqValidation.trainFaq),
  faqController.trainFaq
);

/**
 * @route POST /v1/faq/ask
 * @desc Ask a question and get relevant answer
 * @access Public (for now, can add auth middleware later)
 */
router.post(
  '/ask',
  validate(faqValidation.askQuestion),
  faqController.askQuestion
);

/**
 * @route GET /v1/faq
 * @desc Get all FAQ vectors with pagination
 * @access Public (for now, can add auth middleware later)
 */
router.get('/', faqController.getFaqVectors);

/**
 * @route DELETE /v1/faq/:faqId
 * @desc Delete FAQ vector by ID
 * @access Public (for now, can add auth middleware later)
 */
router.delete('/:faqId', faqController.deleteFaqVector);

/**
 * @route DELETE /v1/faq
 * @desc Clear all FAQ vectors
 * @access Public (for now, can add auth middleware later)
 */
router.delete('/', faqController.clearAllFaqs);

export default router;
