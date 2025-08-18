import express from 'express';
import * as chatbotController from '../../controllers/chatbot.controller.js';

const router = express.Router();

// Main chat endpoint - process user messages
router.post('/chat', chatbotController.processChatMessage);

// Get all predefined questions for frontend display
router.get('/questions', chatbotController.getPredefinedQuestions);

// Get question suggestions by category
router.get('/suggestions', chatbotController.getQuestionSuggestions);

// Get chatbot help and capabilities
router.get('/help', chatbotController.getChatbotHelp);

// Get demo responses for predefined questions
router.get('/demo', chatbotController.getDemoResponses);

export default router;
