import OpenAI from 'openai';
import FaqVector from '../models/faqVector.model.js';
import ApiError from '../utils/ApiError.js';
import config from '../config/config.js';
import * as aiToolService from './aiToolService.js';
import * as blendService from './yarnManagement/blend.service.js';
import * as yarnTypeService from './yarnManagement/yarnType.service.js';
import * as countSizeService from './yarnManagement/countSize.service.js';
import * as colorService from './yarnManagement/color.service.js';
import * as supplierService from './yarnManagement/supplier.service.js';
import * as yarnCatalogService from './yarnManagement/yarnCatalog.service.js';
import * as yarnInventoryService from './yarnManagement/yarnInventory.service.js';
import * as yarnTransactionService from './yarnManagement/yarnTransaction.service.js';
import * as rawMaterialService from './rawMaterial.service.js';
import * as processService from './process.service.js';
import * as productAttributeService from './productAttribute.service.js';

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
 * Detect context category from question
 * @param {string} question - User's question
 * @returns {string|null} Context category or null
 */
const detectContextCategory = (question) => {
  const normalized = question.toLowerCase().trim();
  
  // Map keywords to categories - ordered by specificity (longer/more specific first)
  // This ensures "yarn blend" matches before just "blend"
  const contextMap = [
    // Most specific first
    { keyword: 'yarn blend', category: 'yarn_blends' },
    { keyword: 'yarn blends', category: 'yarn_blends' },
    { keyword: 'yarn type', category: 'yarn_types' },
    { keyword: 'yarn types', category: 'yarn_types' },
    { keyword: 'yarn supplier', category: 'yarn_suppliers' },
    { keyword: 'yarn suppliers', category: 'yarn_suppliers' },
    { keyword: 'yarn color', category: 'yarn_colors' },
    { keyword: 'yarn colors', category: 'yarn_colors' },
    { keyword: 'yarn count size', category: 'yarn_count_sizes' },
    { keyword: 'yarn count sizes', category: 'yarn_count_sizes' },
    { keyword: 'yarn catalog', category: 'yarn_catalog' },
    { keyword: 'yarn catalogue', category: 'yarn_catalog' },
    { keyword: 'yarn inventory', category: 'yarn_inventory' },
    { keyword: 'yarn stock', category: 'yarn_inventory' },
    { keyword: 'yarn transaction', category: 'yarn_transactions' },
    { keyword: 'yarn transactions', category: 'yarn_transactions' },
    { keyword: 'yarn issue', category: 'yarn_issue' },
    { keyword: 'yarn issued', category: 'yarn_issue' },
    { keyword: 'yarn return', category: 'yarn_return' },
    { keyword: 'yarn returned', category: 'yarn_return' },
    { keyword: 'raw material', category: 'raw_materials' },
    { keyword: 'raw materials', category: 'raw_materials' },
    { keyword: 'product attribute', category: 'product_attributes' },
    { keyword: 'product attributes', category: 'product_attributes' },
    { keyword: 'storage slot', category: 'storage_slots' },
    { keyword: 'storage slots', category: 'storage_slots' },
    // Less specific (check after specific ones)
    { keyword: 'count size', category: 'yarn_count_sizes' },
    { keyword: 'count sizes', category: 'yarn_count_sizes' },
    { keyword: 'blends', category: 'yarn_blends' },
    { keyword: 'blend', category: 'yarn_blends' },
    { keyword: 'types', category: 'yarn_types' },
    { keyword: 'type', category: 'yarn_types' },
    { keyword: 'suppliers', category: 'yarn_suppliers' },
    { keyword: 'supplier', category: 'yarn_suppliers' },
    { keyword: 'brands', category: 'yarn_suppliers' },
    { keyword: 'brand', category: 'yarn_suppliers' },
    { keyword: 'colors', category: 'yarn_colors' },
    { keyword: 'color', category: 'yarn_colors' },
    { keyword: 'categories', category: 'categories' },
    { keyword: 'category', category: 'categories' },
    { keyword: 'storage', category: 'storage_slots' },
    { keyword: 'processes', category: 'processes' },
    { keyword: 'process', category: 'processes' },
    { keyword: 'attributes', category: 'product_attributes' },
    { keyword: 'attribute', category: 'product_attributes' },
    { keyword: 'machines', category: 'machines' },
    { keyword: 'machine', category: 'machines' },
    { keyword: 'products', category: 'products' },
    { keyword: 'product', category: 'products' },
    { keyword: 'items', category: 'products' },
    { keyword: 'item', category: 'products' },
  ];
  
  // Check for context keywords (most specific first)
  for (const { keyword, category } of contextMap) {
    // Use word boundaries to avoid partial matches
    const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (regex.test(normalized)) {
      return category;
    }
  }
  
  return null;
};

/**
 * Fetch context data for a category
 * @param {string} category - Context category
 * @returns {Promise<Object|null>} Context data or null
 */
const fetchContextData = async (category) => {
  try {
    switch (category) {
      case 'yarn_blends':
        const blends = await blendService.queryBlends({}, { limit: 20 });
        return {
          category: 'Yarn Blends',
          data: blends.results || [],
          total: blends.totalResults || 0
        };
      
      case 'yarn_types':
        const yarnTypes = await yarnTypeService.queryYarnTypes({}, { limit: 20 });
        return {
          category: 'Yarn Types',
          data: yarnTypes.results || [],
          total: yarnTypes.totalResults || 0
        };
      
      case 'yarn_suppliers':
        const suppliers = await supplierService.querySuppliers({}, { limit: 20 });
        return {
          category: 'Yarn Suppliers',
          data: suppliers.results || [],
          total: suppliers.totalResults || 0
        };
      
      case 'yarn_colors':
        const colors = await colorService.queryColors({}, { limit: 20 });
        return {
          category: 'Yarn Colors',
          data: colors.results || [],
          total: colors.totalResults || 0
        };
      
      case 'yarn_count_sizes':
        const countSizes = await countSizeService.queryCountSizes({}, { limit: 20 });
        return {
          category: 'Yarn Count Sizes',
          data: countSizes.results || [],
          total: countSizes.totalResults || 0
        };
      
      case 'yarn_catalog':
        const yarnCatalogs = await yarnCatalogService.queryYarnCatalogs({}, { limit: 20 });
        return {
          category: 'Yarn Catalog',
          data: yarnCatalogs.results || [],
          total: yarnCatalogs.totalResults || 0
        };
      
      case 'yarn_inventory':
        const inventories = await yarnInventoryService.queryYarnInventories({}, { limit: 20 });
        return {
          category: 'Yarn Inventory',
          data: inventories.results || [],
          total: inventories.totalResults || 0
        };
      
      case 'raw_materials':
        const rawMaterials = await rawMaterialService.queryRawMaterials({}, { limit: 20 });
        return {
          category: 'Raw Materials',
          data: rawMaterials.results || [],
          total: rawMaterials.totalResults || 0
        };
      
      case 'processes':
        const processes = await processService.queryProcesses({}, { limit: 20 });
        return {
          category: 'Processes',
          data: processes.results || [],
          total: processes.totalResults || 0
        };
      
      case 'product_attributes':
        const attributes = await productAttributeService.queryProductAttributes({}, { limit: 20 });
        return {
          category: 'Product Attributes',
          data: attributes.results || [],
          total: attributes.totalResults || 0
        };
      
      default:
        return null;
    }
  } catch (error) {
    console.error(`Error fetching context data for ${category}:`, error);
    return null;
  }
};

/**
 * Ask question with AI tool calling and FAQ vector search
 * @param {string} question - User's question
 * @returns {Promise<Object>} Response object
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
    
    // Check for slash commands (e.g., /commands, /help)
    if (normalizedQuestion.startsWith('/')) {
      const command = normalizedQuestion.toLowerCase();
      if (command === '/commands' || command === '/help' || command === '/') {
        const commandsResult = await aiToolService.getCommands();
        return {
          type: 'ai_tool',
          intent: commandsResult.intent,
          response: commandsResult.response,
          confidence: 1.0,
          source: 'slash_command',
          data: {
            type: 'ai_tool',
            intent: commandsResult.intent,
            response: commandsResult.response
          }
        };
      }
    }
    
    // Step 1: Check FAQ vector search first for existing knowledge
    console.log('Checking FAQ vector search for:', normalizedQuestion);
    
    // Generate embedding for the question
    const questionEmbedding = await generateEmbedding(normalizedQuestion);
    
    // Find similar FAQs using vector similarity
    const allFAQs = await FaqVector.find({}).lean();
    
    if (allFAQs.length > 0) {
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
      
      if (topMatches.length > 0) {
        // Get the best match
        const bestMatch = topMatches[0];
        
        console.log(`FAQ match found with similarity: ${(bestMatch.similarity * 100).toFixed(1)}%`);
        
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
      }
    }
    
    // Step 2: If no good FAQ match found, check if this is a capability question
    const capabilityPatterns = [
      /what\s+can\s+you\s+do/i,
      /what\s+are\s+your\s+capabilities/i,
      /what\s+are\s+your\s+use\s+cases/i,
      /how\s+can\s+you\s+help/i,
      /what\s+do\s+you\s+do/i,
      /tell\s+me\s+about\s+yourself/i
    ];
    
    const isCapabilityQuestion = capabilityPatterns.some(pattern => pattern.test(normalizedQuestion));
    
    if (isCapabilityQuestion) {
      console.log('Capability question detected, checking AI tool intent for:', normalizedQuestion);
      
      const aiIntent = await aiToolService.detectIntent(normalizedQuestion);
      
      if (aiIntent && aiIntent.action === 'getCapabilities') {
        try {
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
          // Continue to fallback response
        }
      }
    }
    
    // Step 3: If no good FAQ match and not a capability question, check AI tool intent for data/analytics requests
    console.log('No good FAQ match found, checking AI tool intent for:', normalizedQuestion);
    
    const aiIntent = await aiToolService.detectIntent(normalizedQuestion);
    
    if (aiIntent && aiIntent.action !== 'getCapabilities') {
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
        // Continue to fallback response
      }
    }
    
    // Step 4: Final fallback - no FAQ match and no AI tool
    if (allFAQs.length === 0) {
      // Use conversation service for natural conversation handling
      console.log('No FAQ knowledge, using conversation service for:', normalizedQuestion);
      try {
        const conversationResponse = await conversationService.processNaturalConversation(question, 'faq-session');
        
        // Convert conversation service response to FAQ service format
        if (conversationResponse.type === 'data_response') {
          return {
            type: 'ai_tool',
            intent: conversationResponse.intent,
            response: conversationResponse.dataHtml,
            conversationalMessage: conversationResponse.conversationalMessage,
            confidence: 0.9,
            source: 'conversation_service'
          };
        } else if (conversationResponse.type === 'clarification') {
          return {
            type: 'faq',
            response: conversationResponse.message,
            suggestions: conversationResponse.options || conversationResponse.suggestions,
            confidence: 0.8,
            source: 'conversation_service',
            clarification: true
          };
        } else {
          return {
            type: 'faq',
            response: conversationResponse.message,
            suggestions: conversationResponse.suggestions,
            confidence: 0.8,
            source: 'conversation_service'
          };
        }
      } catch (convError) {
        console.error('Conversation service error:', convError);
        return {
          type: 'faq',
          response: "I don't have any FAQ knowledge yet. Please train me with some questions and answers first.",
          confidence: 0,
          source: 'faq_vector_search',
          fallback: true
        };
      }
    } else {
      // Step 5: Use conversation service for queries not covered by FAQ or AI tools
      console.log('No FAQ or AI tool match found, using conversation service for:', normalizedQuestion);
      
      try {
        const conversationResponse = await conversationService.processNaturalConversation(question, 'faq-session');
        
        // Convert conversation service response to FAQ service format
        if (conversationResponse.type === 'data_response') {
          return {
            type: 'ai_tool',
            intent: conversationResponse.intent,
            response: conversationResponse.dataHtml,
            conversationalMessage: conversationResponse.conversationalMessage,
            confidence: 0.9,
            source: 'conversation_service'
          };
        } else if (conversationResponse.type === 'clarification') {
          return {
            type: 'faq',
            response: conversationResponse.message,
            suggestions: conversationResponse.options || conversationResponse.suggestions,
            confidence: 0.8,
            source: 'conversation_service',
            clarification: true
          };
        } else {
          return {
            type: 'faq',
            response: conversationResponse.message,
            suggestions: conversationResponse.suggestions,
            confidence: 0.8,
            source: 'conversation_service'
          };
        }
      } catch (convError) {
        console.error('Conversation service error:', convError);
        // Final fallback if conversation service fails
        return {
          type: 'faq',
          response: "I apologize, but I'm having trouble processing your question right now. Could you please rephrase it or try asking about sales data, products, stores, yarn management, or production?",
          confidence: 0.5,
          source: 'faq_fallback',
          suggestions: [
            "Show me top products",
            "Show me sales data",
            "Show me yarn inventory",
            "Show me stores"
          ]
        };
      }
    }
  } catch (error) {
    console.error('FAQ service error:', error);
    throw error;
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
    const deletedFaq = await FaqVector.findByIdAndDelete(faqId);
    if (!deletedFaq) {
      throw new ApiError(404, 'FAQ not found');
    }
    return {
      message: 'FAQ deleted successfully',
      faq: deletedFaq
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
 * @returns {Promise<Object>} - Updated FAQ
 */
export const updateFAQ = async (faqId, updateData) => {
  try {
    const updatedFaq = await FaqVector.findByIdAndUpdate(faqId, updateData, { new: true });
    if (!updatedFaq) {
      throw new ApiError(404, 'FAQ not found');
    }
    return updatedFaq;
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
    const total = await FaqVector.countDocuments();
    return {
      total,
      message: `Total FAQs: ${total}`
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
    const deletedFaq = await FaqVector.findByIdAndDelete(faqId);
    if (!deletedFaq) {
      throw new ApiError(404, 'FAQ not found');
    }
    return {
      message: 'FAQ deleted successfully',
      faq: deletedFaq
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
