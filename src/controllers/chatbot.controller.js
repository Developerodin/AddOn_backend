import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import * as chatbotService from '../services/chatbot.service.js';

/**
 * Process user chat message
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const processChatMessage = catchAsync(async (req, res) => {
  const { message } = req.body;
  
  if (!message || typeof message !== 'string') {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Message is required and must be a string'
    });
  }

  const response = await chatbotService.processMessage(message);
  
  res.status(httpStatus.OK).json({
    success: true,
    ...response
  });
});

/**
 * Get all predefined questions for frontend display
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getPredefinedQuestions = catchAsync(async (req, res) => {
  const questions = chatbotService.getPredefinedQuestions();
  
  res.status(httpStatus.OK).json({
    success: true,
    data: questions
  });
});

/**
 * Get question suggestions by category
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getQuestionSuggestions = catchAsync(async (req, res) => {
  const { category = 'all' } = req.query;
  
  const suggestions = chatbotService.getQuestionSuggestions(category);
  
  res.status(httpStatus.OK).json({
    success: true,
    data: suggestions
  });
});

/**
 * Get chatbot capabilities and help
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getChatbotHelp = catchAsync(async (req, res) => {
  const help = chatbotService.processMessage('help');
  
  res.status(httpStatus.OK).json({
    success: true,
    data: help
  });
});

/**
 * Get demo responses for predefined questions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getDemoResponses = catchAsync(async (req, res) => {
  const demoQuestions = [
    'show me top 5 products',
    'show me top 5 stores',
    'what are the sales trends',
    'how many products do we have',
    'show me replenishment recommendations',
    'help'
  ];

  const demoResponses = [];
  
  for (const question of demoQuestions) {
    try {
      const response = await chatbotService.processMessage(question);
      demoResponses.push({
        question,
        response
      });
    } catch (error) {
      demoResponses.push({
        question,
        response: {
          type: 'error',
          message: `Error processing: ${error.message}`
        }
      });
    }
  }

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Demo responses generated successfully',
    data: demoResponses
  });
});
