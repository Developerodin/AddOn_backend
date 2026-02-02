import express from 'express';
import * as chatbotController from '../../controllers/chatbot.controller.js';
import * as telegramWebhookController from '../../controllers/telegramWebhook.controller.js';

const router = express.Router();

// Telegram webhook: Telegram sends updates here; chatbot replies to user
router.post('/telegram/webhook', telegramWebhookController.handleTelegramWebhook);
// Optional: set webhook URL (e.g. GET /chatbot/telegram/set-webhook?url=https://your-domain.com)
router.get('/telegram/set-webhook', telegramWebhookController.setTelegramWebhook);
router.post('/telegram/set-webhook', telegramWebhookController.setTelegramWebhook);

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

// Get word matching suggestions for a specific message
router.post('/match-words', chatbotController.getWordMatchingSuggestions);

// Debug endpoint to see how words are matched
router.post('/debug-match', chatbotController.debugWordMatching);

export default router;

