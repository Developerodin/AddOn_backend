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

/**
 * Get word matching suggestions for a specific message
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getWordMatchingSuggestions = catchAsync(async (req, res) => {
  const { message } = req.body;
  
  if (!message || typeof message !== 'string') {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Message is required and must be a string'
    });
  }

  const suggestions = chatbotService.getSuggestions(message);
  const questions = chatbotService.getPredefinedQuestions();
  
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Word matching suggestions generated',
    data: {
      userMessage: message,
      suggestions,
      availableQuestions: Object.keys(questions),
      totalQuestions: Object.keys(questions).length
    }
  });
});

/**
 * Debug word matching process for a specific message
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const debugWordMatching = catchAsync(async (req, res) => {
  const { message } = req.body;
  
  if (!message || typeof message !== 'string') {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Message is required and must be a string'
    });
  }

  const normalizedMessage = message.toLowerCase().trim();
  const messageWords = normalizedMessage.split(/\s+/).filter(word => word.length > 2);
  const questions = chatbotService.getPredefinedQuestions();
  
  // Analyze word matching for each question
  const analysis = [];
  
  for (const [key, question] of Object.entries(questions)) {
    const questionWords = key.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    const questionType = question.type;
    
    let matchScore = 0;
    let matchedWords = [];
    let wordDetails = [];
    
    // Check each word in user message against question words
    messageWords.forEach(userWord => {
      questionWords.forEach(questionWord => {
        let wordScore = 0;
        let matchType = 'none';
        
        // Exact word match
        if (userWord === questionWord) {
          wordScore = 3;
          matchType = 'exact';
          matchedWords.push(userWord);
        }
        // Partial word match
        else if (userWord.includes(questionWord) || questionWord.includes(userWord)) {
          wordScore = 2;
          matchType = 'partial';
          matchedWords.push(userWord);
        }
        // Word similarity
        else {
          const similarity = chatbotService.getWordSimilarity ? 
            chatbotService.getWordSimilarity(userWord, questionWord) : 0;
          if (similarity > 0.7) {
            wordScore = 1.5;
            matchType = 'similar';
            matchedWords.push(userWord);
          }
        }
        
        if (wordScore > 0) {
          wordDetails.push({
            userWord,
            questionWord,
            score: wordScore,
            matchType
          });
        }
        
        matchScore += wordScore;
      });
    });
    
    // Bonus for type-specific keywords
    if (questionType === 'analytics' && normalizedMessage.includes('analytics')) matchScore += 2;
    if (questionType === 'product' && normalizedMessage.includes('product')) matchScore += 2;
    if (questionType === 'replenishment' && normalizedMessage.includes('replenish')) matchScore += 2;
    if (questionType === 'store' && normalizedMessage.includes('store')) matchScore += 2;
    if (questionType === 'sales' && normalizedMessage.includes('sales')) matchScore += 2;
    
    if (matchScore > 0) {
      analysis.push({
        question: key,
        description: question.description,
        type: questionType,
        action: question.action,
        matchScore,
        matchedWords: [...new Set(matchedWords)],
        wordDetails,
        questionWords
      });
    }
  }
  
  // Sort by score
  analysis.sort((a, b) => b.matchScore - a.matchScore);
  
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Word matching debug analysis generated',
    data: {
      userMessage: message,
      normalizedMessage,
      messageWords,
      analysis,
      totalQuestions: Object.keys(questions).length,
      questionsWithMatches: analysis.length
    }
  });
});

