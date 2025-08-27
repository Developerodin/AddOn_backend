import OpenAI from 'openai';
import FaqVector from '../models/faqVector.model.js';
import ApiError from '../utils/ApiError.js';
import config from '../config/config.js';
import * as aiToolService from './aiToolService.js';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

/**
 * Generate embedding for text using OpenAI
 * @param {string} text - Text to generate embedding for
 * @returns {Promise<Array<number>>} - Embedding vector
 */
const generateEmbedding = async (text) => {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    
    return response.data[0].embedding;
  } catch (error) {
    throw new ApiError(500, `Failed to generate embedding: ${error.message}`);
  }
};

/**
 * Calculate cosine similarity between two vectors
 * @param {Array<number>} vecA - First vector
 * @param {Array<number>} vecB - Second vector
 * @returns {number} - Similarity score between 0 and 1
 */
const cosineSimilarity = (vecA, vecB) => {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

/**
 * Train FAQ with vector embeddings
 * @param {Object} faqData - FAQ data object
 * @returns {Promise<Object>} - Training result
 */
export const trainFAQ = async (faqData) => {
  try {
    const { question, answer } = faqData;
    
    if (!question || !answer) {
      throw new ApiError(400, 'Question and answer are required');
    }
    
    // Generate embedding for the question
    const embedding = await generateEmbedding(question);
    
    // Check if FAQ already exists
    const existingFAQ = await FaqVector.findOne({ question: question.trim() });
    
    if (existingFAQ) {
      // Update existing FAQ
      existingFAQ.answer = answer.trim();
      existingFAQ.embedding = embedding;
      existingFAQ.updatedAt = new Date();
      await existingFAQ.save();
      
      return {
        message: 'FAQ updated successfully',
        faqId: existingFAQ._id,
        action: 'updated'
      };
    } else {
      // Create new FAQ
      const newFAQ = new FaqVector({
        question: question.trim(),
        answer: answer.trim(),
        embedding
      });
      
      await newFAQ.save();
      
      return {
        message: 'FAQ trained successfully',
        faqId: newFAQ._id,
        action: 'created'
      };
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Failed to train FAQ: ${error.message}`);
  }
};

/**
 * Bulk train multiple FAQs
 * @param {Array<Object>} faqList - Array of FAQ objects
 * @returns {Promise<Object>} - Bulk training results
 */
export const bulkTrainFAQ = async (faqList) => {
  try {
    if (!Array.isArray(faqList) || faqList.length === 0) {
      throw new ApiError(400, 'FAQ list must be a non-empty array');
    }
    
    if (faqList.length > 100) {
      throw new ApiError(400, 'Maximum 100 FAQs allowed per request');
    }
    
    const results = {
      total: faqList.length,
      created: 0,
      updated: 0,
      failed: 0,
      errors: []
    };
    
    // Process FAQs in parallel with rate limiting
    const batchSize = 10;
    for (let i = 0; i < faqList.length; i += batchSize) {
      const batch = faqList.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (faqData, batchIndex) => {
        const globalIndex = i + batchIndex;
        
        try {
          await trainFAQ(faqData);
          if (faqData.action === 'created') {
            results.created++;
          } else {
            results.updated++;
          }
        } catch (error) {
          results.failed++;
          results.errors.push({
            index: globalIndex,
            question: faqData.question || 'Unknown',
            error: error.message
          });
        }
      });
      
      await Promise.all(batchPromises);
      
      // Small delay between batches to prevent overwhelming the API
      if (i + batchSize < faqList.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Failed to bulk train FAQs: ${error.message}`);
  }
};

/**
 * Ask question with AI tool calling and FAQ vector search
 * @param {string} question - User's question
 * @returns {Promise<Object>} - Response object
 */
export const askQuestion = async (question) => {
  try {
    if (!question || typeof question !== 'string') {
      throw new ApiError(400, 'Question is required and must be a string');
    }
    
    const normalizedQuestion = question.trim();
    if (normalizedQuestion.length === 0) {
      throw new ApiError(400, 'Question cannot be empty');
    }
    
    // Step 1: Check if this is an AI tool intent
    const aiIntent = aiToolService.detectIntent(normalizedQuestion);
    
    if (aiIntent) {
      console.log('AI Tool Intent Detected:', aiIntent);
      
      try {
        // Execute AI tool and return HTML response
        const aiResponse = await aiToolService.executeAITool(aiIntent);
        
        return {
          type: 'ai_tool',
          intent: aiIntent,
          response: aiResponse,
          confidence: aiIntent.confidence,
          source: 'ai_tool_service'
        };
      } catch (aiError) {
        console.error('AI Tool execution failed:', aiError);
        // Fall back to FAQ search if AI tool fails
      }
    }
    
    // Step 2: Fall back to FAQ vector search
    console.log('Using FAQ vector search for:', normalizedQuestion);
    
    // Generate embedding for the question
    const questionEmbedding = await generateEmbedding(normalizedQuestion);
    
    // Find similar FAQs using vector similarity
    const allFAQs = await FaqVector.find({}).lean();
    
    if (allFAQs.length === 0) {
      return {
        type: 'faq',
        response: "I don't have any FAQ knowledge yet. Please train me with some questions and answers first.",
        confidence: 0,
        source: 'faq_vector_search',
        fallback: true
      };
    }
    
    // Calculate similarities and find best matches
    const similarities = allFAQs.map(faq => ({
      faq,
      similarity: cosineSimilarity(questionEmbedding, faq.embedding)
    }));
    
    // Sort by similarity (descending)
    similarities.sort((a, b) => b.similarity - a.similarity);
    
    // Get top matches above threshold
    const threshold = 0.7;
    const topMatches = similarities.filter(item => item.similarity >= threshold);
    
    if (topMatches.length === 0) {
      return {
        type: 'faq',
        response: "I don't have a specific answer for that question. Could you please rephrase or ask something else?",
        confidence: 0,
        source: 'faq_vector_search',
        fallback: true
      };
    }
    
    // Get the best match
    const bestMatch = topMatches[0];
    
    // Use OpenAI to enhance the FAQ response
    try {
      const openaiResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are a helpful support assistant. 
Answer ONLY based on the stored FAQ knowledge base. 
If the question is unrelated or not found in the database, politely reply:
"Sorry, I don't have an answer for that."

Keep your response concise, helpful, and professional.`
          },
          {
            role: 'user',
            content: `Question: ${normalizedQuestion}

FAQ Knowledge Base:
Question: ${bestMatch.faq.question}
Answer: ${bestMatch.faq.answer}

Please provide a helpful response based on this FAQ knowledge.`
          }
        ],
        max_tokens: 300,
        temperature: 0.7
      });
      
      const enhancedAnswer = openaiResponse.choices[0]?.message?.content?.trim() || bestMatch.faq.answer;
      
      return {
        type: 'faq',
        response: enhancedAnswer,
        confidence: bestMatch.similarity,
        source: 'faq_vector_search',
        originalFAQ: {
          question: bestMatch.faq.question,
          answer: bestMatch.faq.answer
        },
        similarity: bestMatch.similarity,
        topMatches: topMatches.slice(0, 3).map(match => ({
          question: match.faq.question,
          answer: match.faq.answer,
          similarity: match.similarity
        }))
      };
      
    } catch (openaiError) {
      console.error('OpenAI enhancement failed:', openaiError);
      
      // Return original FAQ answer if OpenAI fails
      return {
        type: 'faq',
        response: bestMatch.faq.answer,
        confidence: bestMatch.similarity,
        source: 'faq_vector_search',
        originalFAQ: {
          question: bestMatch.faq.question,
          answer: bestMatch.faq.answer
        },
        similarity: bestMatch.similarity,
        fallback: true
      };
    }
    
  } catch (error) {
    console.error('Error in askQuestion:', error);
    
    if (error instanceof ApiError) throw error;
    
    // Return a helpful error message
    return {
      type: 'error',
      response: "I'm having trouble processing your question right now. Please try again in a moment.",
      confidence: 0,
      source: 'error_handler',
      error: error.message
    };
  }
};

/**
 * Get all FAQs with pagination
 * @param {Object} options - Query options
 * @returns {Promise<Object>} - Paginated FAQ results
 */
export const getAllFAQs = async (options = {}) => {
  try {
    const { page = 1, limit = 10, search } = options;
    
    let filter = {};
    if (search) {
      filter.$or = [
        { question: { $regex: search, $options: 'i' } },
        { answer: { $regex: search, $options: 'i' } }
      ];
    }
    
    const skip = (page - 1) * limit;
    
    const [faqs, total] = await Promise.all([
      FaqVector.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-embedding')
        .lean(),
      FaqVector.countDocuments(filter)
    ]);
    
    return {
      faqs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    };
  } catch (error) {
    throw new ApiError(500, `Failed to get FAQs: ${error.message}`);
  }
};

/**
 * Delete FAQ by ID
 * @param {string} faqId - FAQ ID
 * @returns {Promise<Object>} - Deletion result
 */
export const deleteFAQ = async (faqId) => {
  try {
    const faq = await FaqVector.findByIdAndDelete(faqId);
    
    if (!faq) {
      throw new ApiError(404, 'FAQ not found');
    }
    
    return {
      message: 'FAQ deleted successfully',
      faqId: faq._id
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Failed to delete FAQ: ${error.message}`);
  }
};

/**
 * Update FAQ by ID
 * @param {string} faqId - FAQ ID
 * @param {Object} updateData - Update data
 * @returns {Promise<Object>} - Update result
 */
export const updateFAQ = async (faqId, updateData) => {
  try {
    const { question, answer } = updateData;
    
    if (question && question.trim()) {
      // Generate new embedding if question changed
      const embedding = await generateEmbedding(question.trim());
      updateData.embedding = embedding;
    }
    
    const faq = await FaqVector.findByIdAndUpdate(
      faqId,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!faq) {
      throw new ApiError(404, 'FAQ not found');
    }
    
    return {
      message: 'FAQ updated successfully',
      faq: {
        id: faq._id,
        question: faq.question,
        answer: faq.answer,
        updatedAt: faq.updatedAt
      }
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Failed to update FAQ: ${error.message}`);
  }
};

/**
 * Get FAQ statistics
 * @returns {Promise<Object>} - FAQ statistics
 */
export const getFAQStats = async () => {
  try {
    const [totalFAQs, recentFAQs, topQuestions] = await Promise.all([
      FaqVector.countDocuments(),
      FaqVector.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
      FaqVector.aggregate([
        { $sort: { createdAt: -1 } },
        { $limit: 5 },
        { $project: { question: 1, createdAt: 1 } }
      ])
    ]);
    
    return {
      totalFAQs,
      recentFAQs,
      topQuestions,
      lastUpdated: new Date()
    };
  } catch (error) {
    throw new ApiError(500, `Failed to get FAQ stats: ${error.message}`);
  }
};

/**
 * Get all FAQ vectors with pagination
 * @param {Object} filter - Filter criteria
 * @param {Object} options - Pagination and sorting options
 * @returns {Promise<Object>} - Paginated FAQ results
 */
export const getFaqVectors = async (filter = {}, options = {}) => {
  try {
    const { page = 1, limit = 10, sortBy = 'createdAt' } = options;
    
    const skip = (page - 1) * limit;
    
    const [faqs, totalResults] = await Promise.all([
      FaqVector.find(filter)
        .sort({ [sortBy]: -1 })
        .skip(skip)
        .limit(limit)
        .select('-embedding')
        .lean(),
      FaqVector.countDocuments(filter)
    ]);
    
    const totalPages = Math.ceil(totalResults / limit);
    
    return {
      results: faqs,
      page,
      limit,
      totalPages,
      totalResults,
      hasNext: page < totalPages,
      hasPrev: page > 1
    };
  } catch (error) {
    throw new ApiError(500, `Failed to get FAQ vectors: ${error.message}`);
  }
};

/**
 * Delete FAQ vector by ID
 * @param {string} faqId - FAQ ID
 * @returns {Promise<Object>} - Deletion result
 */
export const deleteFaqVector = async (faqId) => {
  try {
    const faq = await FaqVector.findByIdAndDelete(faqId);
    
    if (!faq) {
      throw new ApiError(404, 'FAQ vector not found');
    }
    
    return {
      message: 'FAQ vector deleted successfully',
      faqId: faq._id
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Failed to delete FAQ vector: ${error.message}`);
  }
};

/**
 * Clear all FAQ vectors
 * @returns {Promise<Object>} - Clear result
 */
export const clearAllFaqs = async () => {
  try {
    const result = await FaqVector.deleteMany({});
    
    return {
      message: 'All FAQ vectors cleared successfully',
      deletedCount: result.deletedCount
    };
  } catch (error) {
    throw new ApiError(500, `Failed to clear FAQ vectors: ${error.message}`);
  }
};

export default {
  trainFAQ,
  bulkTrainFAQ,
  askQuestion,
  getAllFAQs,
  deleteFAQ,
  updateFAQ,
  getFAQStats,
  getFaqVectors,
  deleteFaqVector,
  clearAllFaqs
};
