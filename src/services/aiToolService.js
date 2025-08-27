import * as analyticsService from './analytics.service.js';
import * as productService from './product.service.js';
import * as storeService from './store.service.js';
import * as salesService from './sales.service.js';
import * as replenishmentService from './replenishment.service.js';
import * as categoryService from './category.service.js';
import Sales from '../models/sales.model.js';
import Store from '../models/store.model.js';
import Product from '../models/product.model.js';
import { OpenAI } from 'openai';
import config from '../config/config.js';
import * as dashboardService from './dashboard.service.js'; // Added missing import

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

/**
 * Use OpenAI to intelligently detect intent and extract parameters
 * @param {string} question - User's question
 * @returns {Promise<Object|null>} Intent object or null if no match
 */
const detectIntentWithAI = async (question) => {
  try {
    // Use OpenAI to intelligently understand the user's intent and extract parameters
    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are an AI assistant that analyzes retail business queries and determines the user's intent. 
          
          Analyze the user's question and return a JSON object with the following structure:
          {
            "action": "one of: getProductForecast, getProductAnalysis, getStoreAnalysisByName, getTopProducts, getProductCount, getSalesReport, getAnalyticsDashboard, getCapabilities",
            "params": {
              "productName": "extracted product name or null",
              "city": "extracted city name or null", 
              "storeName": "extracted store name or null",
              "period": "extracted time period or null",
              "limit": "extracted number limit or null"
            },
            "description": "brief description of what the user wants",
            "confidence": 0.9
          }
          
          Rules:
          - For sales forecasts: action = "getProductForecast", extract productName and city
          - For product analysis: action = "getProductAnalysis", extract productName
          - For store analysis: action = "getStoreAnalysisByName", extract storeName (only if a specific store name is mentioned)
          - For city-based analytics: action = "getAnalyticsDashboard", extract city (when asking for analytics/performance in a city)
          - For top products: action = "getTopProducts", extract city if mentioned
          - For capabilities: action = "getCapabilities" if asking about what the system can do
          - For sales reports: action = "getSalesReport", extract period, city if mentioned
          - For analytics: action = "getAnalyticsDashboard" for general business insights or city-based analysis
          - For product count: action = "getProductCount" if asking about inventory
          
          IMPORTANT: 
          - "mumbai", "delhi", "bangalore" etc. are CITIES, not store names
          - Store names are specific business names like "ABC Store", "Central Mall", "Reliance Mart"
          - When someone asks for "analytics for mumbai" or "store performance in mumbai", use getAnalyticsDashboard with city="mumbai"
          - When someone asks for "analytics for mumbai store" (meaning stores in Mumbai city), use getAnalyticsDashboard with city="mumbai"
          - Only use getStoreAnalysisByName when a specific store name is mentioned like "ABC store" or "Store XYZ"
          - The word "store" after a city name usually means "stores in that city", not a store name
          
          Examples:
          - "next months sales forecast for PE Mens Full Rib Navy FL in mumbai" → getProductForecast with productName="PE Mens Full Rib Navy FL", city="mumbai"
          - "give me PE Mens Full Rib White FL analysis" → getProductAnalysis with productName="PE Mens Full Rib White FL"
          - "show me store ABC data" → getStoreAnalysisByName with storeName="ABC"
          - "analytics for mumbai store" → getAnalyticsDashboard with city="mumbai" (stores in Mumbai)
          - "store performance in mumbai" → getAnalyticsDashboard with city="mumbai" (stores in Mumbai)
          - "give me analytics for mumbai store" → getAnalyticsDashboard with city="mumbai" (stores in Mumbai)
          - "what are your capabilities" → getCapabilities
          - "top 5 products in delhi" → getTopProducts with city="delhi", limit=5`
        },
        {
          role: 'user',
          content: `Analyze this query: "${question}"`
        }
      ],
      temperature: 0.1,
      max_tokens: 300
    });

    const content = aiResponse.choices[0]?.message?.content?.trim();
    if (!content) {
      console.log('No response from OpenAI');
      return null;
    }

    try {
      // Extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const intent = JSON.parse(jsonMatch[0]);
        
        // Validate the intent structure
        if (intent.action && intent.params) {
          return {
            action: intent.action,
            params: intent.params,
            description: intent.description || 'AI-detected intent',
            confidence: intent.confidence || 0.9
          };
        }
      }
      
      console.log('Invalid JSON response from OpenAI:', content);
      return null;
      
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError);
      console.log('Raw response:', content);
      return null;
    }
    
  } catch (error) {
    console.error('Error using OpenAI for intent detection:', error);
    return null;
  }
};

/**
 * Enhanced intent detection for AI tool calling
 * @param {string} question - User's question
 * @returns {Object|null} Intent object or null if no match
 */
export const detectIntent = async (question) => {
  // First try AI-powered detection
  const aiIntent = await detectIntentWithAI(question);
  if (aiIntent) {
    return aiIntent;
  }
  
  // Fallback to regex patterns if AI fails
  const normalizedQuestion = question.toLowerCase().trim();
  
  // Intent patterns
  const intents = [
    {
      pattern: /top\s+products\s+(?:in\s+)?([a-zA-Z\s,]+)/i,
      action: 'getTopProductsInCity',
      extractParams: (match) => ({ city: match[1].trim() }),
      description: 'Get top products in a specific city'
    },
    {
      pattern: /top\s+\d*\s*products/i,
      action: 'getTopProducts',
      extractParams: () => ({}),
      description: 'Get top products across all stores'
    },
    {
      pattern: /how\s+many\s+products|product\s+count|total\s+products/i,
      action: 'getProductCount',
      extractParams: () => ({}),
      description: 'Get total product count'
    },
    {
      pattern: /sales\s+report|sales\s+data|sales\s+summary/i,
      action: 'getSalesReport',
      extractParams: () => ({}),
      description: 'Get sales report'
    },
    {
      pattern: /analytics\s+dashboard|dashboard|business\s+insights/i,
      action: 'getAnalyticsDashboard',
      extractParams: () => ({}),
      description: 'Get comprehensive analytics dashboard'
    },
    {
      pattern: /store\s+analysis|store\s+performance|store\s+report/i,
      action: 'getStoreAnalysis',
      extractParams: () => ({}),
      description: 'Get store performance analysis'
    },
    {
      pattern: /products\s+in\s+([a-zA-Z\s,]+)/i,
      action: 'getTopProductsInCity',
      extractParams: (match) => ({ city: match[1].trim() }),
      description: 'Get products in a specific city'
    },
    {
      pattern: /best\s+selling\s+products/i,
      action: 'getTopProducts',
      extractParams: () => ({}),
      description: 'Get best selling products'
    },
    {
      pattern: /inventory\s+summary|product\s+inventory/i,
      action: 'getProductCount',
      extractParams: () => ({}),
      description: 'Get product inventory summary'
    },
    {
      pattern: /sales\s+trend|trend\s+for|monthly\s+sales/i,
      action: 'getSalesReport',
      extractParams: () => ({}),
      description: 'Get sales trend analysis'
    },
    {
      pattern: /top\s+stores|stores\s+by\s+performance|store\s+ranking/i,
      action: 'getStoreAnalysis',
      extractParams: () => ({}),
      description: 'Get top stores by performance'
    },
    {
      pattern: /brand\s+performance|brand\s+data|brand\s+analysis/i,
      action: 'getAnalyticsDashboard',
      extractParams: () => ({}),
      description: 'Get brand performance analysis'
    },
    {
      pattern: /(?:next\s+)?(?:month|months?)\s+(?:sales\s+)?forecast\s+(?:for\s+)?([^?]+?)(?:\s+in\s+([a-zA-Z\s,]+))?/i,
      action: 'getProductForecast',
      extractParams: (match) => ({ 
        productName: match[1].trim(),
        city: match[2] ? match[2].trim() : null
      }),
      description: 'Get sales forecast for specific product and city'
    },
    {
      pattern: /(?:what\s+are\s+)?(?:your\s+)?(?:potential\s+)?use\s+cases?|capabilities?|what\s+can\s+you\s+do/i,
      action: 'getCapabilities',
      extractParams: () => ({}),
      description: 'Get system capabilities and use cases'
    },
    {
      pattern: /(?:give\s+me\s+)?([^?]+?)\s+analysis|analyze\s+([^?]+?)/i,
      action: 'getProductAnalysis',
      extractParams: (match) => ({ 
        productName: (match[1] || match[2]).trim()
      }),
      description: 'Get detailed product analysis by name'
    },
    {
      pattern: /(?:show\s+me\s+)?(?:data\s+for\s+)?(?:store\s+)?([a-zA-Z0-9\s\-]+?)(?:\s+store)?/i,
      action: 'getStoreAnalysisByName',
      extractParams: (match) => ({ 
        storeName: match[1].trim()
      }),
      description: 'Get store analysis by store name'
    }
  ];
  
  // Check each intent pattern
  for (const intent of intents) {
    const match = normalizedQuestion.match(intent.pattern);
    if (match) {
      return {
        action: intent.action,
        params: intent.extractParams(match),
        description: intent.description,
        confidence: 0.9
      };
    }
  }
  
  return null;
};

/**
 * CSS styles for AI tool responses
 */
const AI_TOOL_STYLES = `
<style>
.ai-tool-response {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  margin: 20px 0;
  padding: 20px;
  background-color: #f8f9fa;
  border-radius: 8px;
  border-left: 4px solid #007bff;
}

.ai-tool-response h3 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 18px;
  font-weight: 600;
}

.city-info, .report-info {
  background-color: #e9ecef;
  padding: 15px;
  border-radius: 6px;
  margin-bottom: 20px;
}

.city-info p, .report-info p {
  margin: 5px 0;
  color: #495057;
  font-size: 14px;
}

.city-info strong, .report-info strong {
  color: #2c3e50;
}

.table-container {
  margin: 20px 0;
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  background-color: white;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.data-table th,
.data-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #e1e5e9;
}

.data-table th {
  background-color: #007bff;
  color: white;
  font-weight: 600;
  font-size: 13px;
}

.data-table tr:hover {
  background-color: #f8f9fa;
}

.data-table tr:nth-child(even) {
  background-color: #f8f9fa;
}

.summary-card {
  display: inline-block;
  margin: 10px;
  padding: 20px;
  min-width: 150px;
  text-align: center;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.card-content h3 {
  margin: 0 0 10px 0;
  font-size: 14px;
  font-weight: 500;
  color: #2c3e50;
}

.card-value {
  font-size: 24px;
  font-weight: 700;
  margin: 10px 0;
  color: #007bff;
}

.card-subtitle {
  font-size: 12px;
  color: #6c757d;
}

.summary {
  margin-top: 15px;
  padding: 10px;
  background-color: #d4edda;
  border: 1px solid #c3e6cb;
  border-radius: 4px;
  color: #155724;
  font-size: 14px;
  text-align: center;
}

.response-content {
  background-color: white;
  padding: 15px;
  border-radius: 6px;
  border: 1px solid #dee2e6;
}

.response-content p {
  margin: 8px 0;
  color: #495057;
  line-height: 1.6;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin: 20px 0;
}

.kpi-item {
  background-color: white;
  padding: 15px;
  border-radius: 6px;
  text-align: center;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.kpi-label {
  font-size: 12px;
  color: #6c757d;
  margin-bottom: 5px;
}

.kpi-value {
  font-size: 20px;
  font-weight: 700;
  color: #2c3e50;
  margin-bottom: 5px;
}

.kpi-change {
  font-size: 12px;
  font-weight: 600;
}

.kpi-change.positive { color: #28a745; }
.kpi-change.negative { color: #dc3545; }

.chart-container {
  margin: 20px 0;
  padding: 15px;
  background-color: white;
  border-radius: 6px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.chart-container h4 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 16px;
  font-weight: 600;
}
</style>
`;

/**
 * Get top products across all stores or filtered by city using analytics service
 * @param {string} city - Optional city filter
 * @returns {Promise<string>} HTML string with top products data
 */
export const getTopProducts = async (city = null) => {
  try {
    let filter = {};
    let storeFilter = {};
    
    if (city) {
      storeFilter.city = { $regex: city, $options: 'i' };
    }
    
    // Get stores based on filter
    const stores = await Store.find(storeFilter).select('_id storeName city').lean();
    if (stores.length === 0) {
      return generateHTMLResponse('No stores found', 'No stores available for the specified criteria.');
    }
    
    const storeIds = stores.map(store => store._id);
    
    // Helper function to get top products from sales data
    const getTopProductsFromSales = async (storeFilter = {}) => {
      return await Sales.aggregate([
        { $match: storeFilter },
        {
          $lookup: {
            from: 'products',
            localField: 'materialCode',
            foreignField: '_id',
            as: 'productData'
          }
        },
        { $unwind: '$productData' },
        {
          $lookup: {
            from: 'categories',
            localField: 'productData.category',
            foreignField: '_id',
            as: 'categoryData'
          }
        },
        {
          $unwind: {
            path: '$categoryData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: '$materialCode',
            productName: { $first: '$productData.name' },
            productCode: { $first: '$productData.softwareCode' },
            categoryName: { $first: { $ifNull: ['$categoryData.name', 'Unknown Category'] } },
            totalQuantity: { $sum: '$quantity' },
            totalNSV: { $sum: '$nsv' },
            totalGSV: { $sum: '$gsv' },
            totalDiscount: { $sum: '$discount' },
            recordCount: { $sum: 1 }
          }
        },
        { $sort: { totalNSV: -1 } },
        { $limit: 10 }
      ]);
    };
    
    // Try to use dashboard service first
    let productPerformance = null;
    try {
      productPerformance = await dashboardService.getAllProductsPerformance('month');
      if (productPerformance && productPerformance.products && productPerformance.products.length > 0) {
        // Filter by city if specified
        if (city && storeIds.length > 0) {
          const citySales = await getTopProductsFromSales({ plant: { $in: storeIds } });
          if (citySales.length > 0) {
            productPerformance = { products: citySales };
          }
        }
      }
    } catch (dashboardError) {
      console.log('Dashboard service failed, falling back to direct query:', dashboardError.message);
    }
    
    // Fallback to direct database query if dashboard service fails
    if (!productPerformance || !productPerformance.products || productPerformance.products.length === 0) {
      console.log('Using fallback direct query for top products');
      
      let matchFilter = {};
      if (city && storeIds.length > 0) {
        matchFilter.plant = { $in: storeIds };
      }
      
      const topProducts = await getTopProductsFromSales(matchFilter);
      
      if (topProducts.length === 0) {
        return generateHTMLResponse('No sales data found', 'No sales transactions found for the specified criteria.');
      }
      
      productPerformance = { products: topProducts };
    }
    
    const products = productPerformance.products || [];
    
    // Generate HTML table
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏆 Top Products ${city ? `in ${city}` : 'Across All Stores'}</h3>
        ${city ? `<div class="city-info"><p><strong>City:</strong> ${city}</p><p><strong>Stores:</strong> ${stores.length}</p></div>` : ''}
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Product Name</th>
                <th>Code</th>
                <th>Category</th>
                <th>Quantity Sold</th>
                <th>Total NSV (₹)</th>
                <th>Total GSV (₹)</th>
                <th>Discount (₹)</th>
                <th>Orders</th>
              </tr>
            </thead>
            <tbody>
              ${products.map((product, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${product.productName || 'Unknown'}</td>
                  <td>${product.productCode || 'N/A'}</td>
                  <td>${product.categoryName || 'Unknown'}</td>
                  <td>${product.totalQuantity.toLocaleString()}</td>
                  <td>₹${product.totalNSV.toLocaleString()}</td>
                  <td>₹${product.totalGSV.toLocaleString()}</td>
                  <td>₹${product.totalDiscount.toLocaleString()}</td>
                  <td>${product.recordCount}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="summary">Found ${products.length} top performing products ${city ? `in ${city}` : 'across all stores'}.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getTopProducts:', error);
    return generateHTMLResponse('Error', `Failed to retrieve top products: ${error.message}`);
  }
};

/**
 * Get total product count using product service
 * @returns {Promise<string>} HTML string with product count
 */
export const getProductCount = async () => {
  try {
    const products = await productService.queryProducts({}, { limit: 1 });
    const totalProducts = products.totalResults || 0;
    
    // Get additional product statistics
    const activeProducts = await productService.queryProducts({ status: 'active' }, { limit: 1 });
    const activeCount = activeProducts.totalResults || 0;
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📦 Product Inventory Summary</h3>
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Products</div>
            <div class="kpi-value">${totalProducts.toLocaleString()}</div>
            <div class="kpi-change">Available in System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Products</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Inactive Products</div>
            <div class="kpi-value">${(totalProducts - activeCount).toLocaleString()}</div>
            <div class="kpi-change">Not Active</div>
          </div>
        </div>
        <p class="summary">Your inventory currently contains ${totalProducts.toLocaleString()} products with ${activeCount.toLocaleString()} active items.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getProductCount:', error);
    return generateHTMLResponse('Error', `Failed to retrieve product count: ${error.message}`);
  }
};

/**
 * Get top products in a specific city using analytics service
 * @param {string} city - City name
 * @returns {Promise<string>} HTML string with top products in city
 */
export const getTopProductsInCity = async (city) => {
  try {
    if (!city) {
      return generateHTMLResponse('City Required', 'Please specify a city to get top products.');
    }
    
    // Find stores in the city
    const stores = await Store.find({ 
      city: { $regex: city, $options: 'i' } 
    }).select('_id storeName city').lean();
    
    if (stores.length === 0) {
      return generateHTMLResponse('No Stores Found', `No stores found in ${city}. Please check the city name.`);
    }
    
    const storeIds = stores.map(store => store._id);
    
    // Get sales data for top products in the city using analytics service
    const salesData = await Sales.aggregate([
      { $match: { plant: { $in: storeIds } } },
      {
        $lookup: {
          from: 'products',
          localField: 'materialCode',
          foreignField: '_id',
          as: 'productData'
        }
      },
      { $unwind: '$productData' },
      {
        $lookup: {
          from: 'categories',
          localField: 'productData.category',
          foreignField: '_id',
          as: 'categoryData'
        }
      },
      {
        $unwind: {
          path: '$categoryData',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: '$materialCode',
          productName: { $first: '$productData.name' },
          softwareCode: { $first: '$productData.softwareCode' },
          categoryName: { $first: '$categoryData.name' },
          totalQuantity: { $sum: '$quantity' },
          totalSales: { $sum: '$gsv' },
          totalRevenue: { $sum: '$nsv' },
          totalDiscount: { $sum: '$discount' },
          storeCount: { $addToSet: '$plant' }
        }
      },
      {
        $addFields: {
          storeCount: { $size: '$storeCount' }
        }
      },
      { $sort: { totalSales: -1 } },
      { $limit: 10 }
    ]);
    
    if (salesData.length === 0) {
      return generateHTMLResponse('No Sales Data', `No sales transactions found for stores in ${city}.`);
    }
    
    // Generate HTML table
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏆 Top Products in ${city}</h3>
        <div class="city-info">
          <p><strong>City:</strong> ${city}</p>
          <p><strong>Stores:</strong> ${stores.length}</p>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Product Name</th>
                <th>Code</th>
                <th>Category</th>
                <th>Quantity Sold</th>
                <th>Total Sales (₹)</th>
                <th>Revenue (₹)</th>
                <th>Discount (₹)</th>
                <th>Stores Selling</th>
              </tr>
            </thead>
            <tbody>
              ${salesData.map((product, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${product.productName || 'Unknown'}</td>
                  <td>${product.softwareCode || 'N/A'}</td>
                  <td>${product.categoryName || 'Unknown'}</td>
                  <td>${product.totalQuantity.toLocaleString()}</td>
                  <td>₹${product.totalSales.toLocaleString()}</td>
                  <td>₹${product.totalRevenue.toLocaleString()}</td>
                  <td>₹${product.totalDiscount.toLocaleString()}</td>
                  <td>${product.storeCount}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="summary">Found ${salesData.length} top performing products in ${city} across ${stores.length} stores.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getTopProductsInCity:', error);
    return generateHTMLResponse('Error', `Failed to retrieve top products in ${city}: ${error.message}`);
  }
};

/**
 * Get sales report with various parameters using analytics service
 * @param {Object} params - Report parameters
 * @returns {Promise<string>} HTML string with sales report
 */
export const getSalesReport = async (params = {}) => {
  try {
    const { 
      dateFrom, 
      dateTo, 
      city, 
      category, 
      limit,
      groupBy = 'product'
    } = params;
    
    // Set default limit if not provided or invalid
    const reportLimit = parseInt(limit) || 20;
    
    // Build filter
    let filter = {};
    let storeFilter = {};
    
    if (city) {
      storeFilter.city = { $regex: city, $options: 'i' };
    }
    
    if (dateFrom || dateTo) {
      filter.dateFrom = dateFrom;
      filter.dateTo = dateTo;
    }
    
    // Get stores if city filter is applied
    let storeIds = null;
    if (Object.keys(storeFilter).length > 0) {
      const stores = await Store.find(storeFilter).select('_id').lean();
      if (stores.length === 0) {
        return generateHTMLResponse('No Stores Found', `No stores found matching the criteria.`);
      }
      storeIds = stores.map(store => store._id);
      filter.storeId = storeIds[0]; // For analytics service
    }
    
    let reportData = null;
    let columns = [];
    let tableData = [];
    
    // Use direct database queries instead of analytics service
    if (groupBy === 'product') {
      // Get product performance data directly
      const productMatch = {};
      if (storeIds && storeIds.length > 0) {
        productMatch.plant = { $in: storeIds };
      }
      if (filter.dateFrom || filter.dateTo) {
        productMatch.date = {};
        if (filter.dateFrom) productMatch.date.$gte = new Date(filter.dateFrom);
        if (filter.dateTo) productMatch.date.$lte = new Date(filter.dateTo);
      }
      
      reportData = await Sales.aggregate([
        { $match: productMatch },
        {
          $lookup: {
            from: 'products',
            localField: 'materialCode',
            foreignField: '_id',
            as: 'productData'
          }
        },
        { $unwind: '$productData' },
        {
          $lookup: {
            from: 'categories',
            localField: 'productData.category',
            foreignField: '_id',
            as: 'categoryData'
          }
        },
        {
          $unwind: {
            path: '$categoryData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: '$materialCode',
            productName: { $first: '$productData.name' },
            productCode: { $first: '$productData.softwareCode' },
            categoryName: { $first: { $ifNull: ['$categoryData.name', 'Unknown Category'] } },
            totalQuantity: { $sum: '$quantity' },
            totalNSV: { $sum: '$nsv' },
            totalGSV: { $sum: '$gsv' },
            totalDiscount: { $sum: '$discount' },
            recordCount: { $sum: 1 }
          }
        },
        { $sort: { totalNSV: -1 } },
        { $limit: reportLimit }
      ]);
      
      columns = ['Rank', 'Product Name', 'Code', 'Category', 'Quantity', 'NSV (₹)', 'GSV (₹)', 'Discount (₹)', 'Orders'];
      tableData = reportData.map((item, index) => [
        index + 1,
        item.productName || 'Unknown',
        item.productCode || 'N/A',
        item.categoryName || 'Unknown',
        (item.totalQuantity || 0).toLocaleString(),
        `₹${(item.totalNSV || 0).toLocaleString()}`,
        `₹${(item.totalGSV || 0).toLocaleString()}`,
        `₹${(item.totalDiscount || 0).toLocaleString()}`,
        item.recordCount || 0
      ]);
      
    } else if (groupBy === 'store') {
      // Get store performance data directly
      const storeMatch = {};
      if (filter.dateFrom || filter.dateTo) {
        storeMatch.date = {};
        if (filter.dateFrom) storeMatch.date.$gte = new Date(filter.dateFrom);
        if (filter.dateTo) storeMatch.date.$lte = new Date(filter.dateTo);
      }
      
      reportData = await Sales.aggregate([
        { $match: storeMatch },
        {
          $lookup: {
            from: 'stores',
            localField: 'plant',
            foreignField: '_id',
            as: 'storeData'
          }
        },
        { $unwind: '$storeData' },
        {
          $group: {
            _id: '$storeData._id',
            storeName: { $first: '$storeData.storeName' },
            storeId: { $first: '$storeData.storeId' },
            city: { $first: '$storeData.city' },
            totalQuantity: { $sum: '$quantity' },
            totalNSV: { $sum: '$nsv' },
            totalGSV: { $sum: '$gsv' },
            totalDiscount: { $sum: '$discount' },
            totalTax: { $sum: '$totalTax' },
            recordCount: { $sum: 1 }
          }
        },
        { $sort: { totalNSV: -1 } },
        { $limit: reportLimit }
      ]);
      
      columns = ['Rank', 'Store Name', 'Store ID', 'City', 'Quantity', 'NSV (₹)', 'GSV (₹)', 'Discount (₹)', 'Tax (₹)', 'Orders'];
      tableData = reportData.map((item, index) => [
        index + 1,
        item.storeName || 'Unknown',
        item.storeId || 'N/A',
        item.city || 'Unknown',
        (item.totalQuantity || 0).toLocaleString(),
        `₹${(item.totalNSV || 0).toLocaleString()}`,
        `₹${(item.totalGSV || 0).toLocaleString()}`,
        `₹${(item.totalDiscount || 0).toLocaleString()}`,
        `₹${(item.totalTax || 0).toLocaleString()}`,
        item.recordCount || 0
      ]);
      
    } else if (groupBy === 'date') {
      // Get time-based sales trends directly
      const dateMatch = {};
      if (filter.dateFrom || filter.dateTo) {
        dateMatch.date = {};
        if (filter.dateFrom) dateMatch.date.$gte = new Date(filter.dateFrom);
        if (filter.dateTo) dateMatch.date.$lte = new Date(filter.dateTo);
      }
      
      reportData = await Sales.aggregate([
        { $match: dateMatch },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }
            },
            totalQuantity: { $sum: '$quantity' },
            totalNSV: { $sum: '$nsv' },
            totalGSV: { $sum: '$gsv' },
            totalDiscount: { $sum: '$discount' },
            totalTax: { $sum: '$totalTax' },
            recordCount: { $sum: 1 }
          }
        },
        { $sort: { '_id.date': 1 } },
        { $limit: reportLimit }
      ]);
      
      columns = ['Rank', 'Date', 'Quantity', 'NSV (₹)', 'GSV (₹)', 'Discount (₹)', 'Tax (₹)', 'Orders'];
      tableData = reportData.map((item, index) => [
        index + 1,
        item._id.date,
        (item.totalQuantity || 0).toLocaleString(),
        `₹${(item.totalNSV || 0).toLocaleString()}`,
        `₹${(item.totalGSV || 0).toLocaleString()}`,
        `₹${(item.totalDiscount || 0).toLocaleString()}`,
        `₹${(item.totalTax || 0).toLocaleString()}`,
        item.recordCount || 0
      ]);
    }
    
    if (!reportData || reportData.length === 0) {
      return generateHTMLResponse('No Sales Data', 'No sales data found matching the specified criteria.');
    }
    
    // Generate table HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📊 Sales Report</h3>
        <div class="report-info">
          <p><strong>Grouped by:</strong> ${groupBy}</p>
          ${city ? `<p><strong>City:</strong> ${city}</p>` : ''}
          ${category ? `<p><strong>Category:</strong> ${category}</p>` : ''}
          ${dateFrom || dateTo ? `<p><strong>Date Range:</strong> ${dateFrom || 'Start'} to ${dateTo || 'End'}</p>` : ''}
          <p><strong>Results:</strong> ${reportData.length} records</p>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                ${columns.map(col => `<th>${col}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${tableData.map(row => `
                <tr>
                  ${row.map(cell => `<td>${cell}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="summary">Sales report generated successfully with ${reportData.length} records.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getSalesReport:', error);
    return generateHTMLResponse('Error', `Failed to generate sales report: ${error.message}`);
  }
};

/**
 * Get city-specific analytics data
 * @param {string} city - City name
 * @param {Object} filter - Additional filters
 * @returns {Promise<Object>} City analytics data
 */
const getCitySpecificAnalytics = async (city, filter = {}) => {
  try {
    // Find all stores in the specified city
    const storesInCity = await Store.find({ 
      city: { $regex: city, $options: 'i' } 
    }).select('_id').lean();
    
    if (storesInCity.length === 0) {
      return null;
    }
    
    const storeIds = storesInCity.map(store => store._id);
    
    // Build date filter
    let dateFilter = {};
    if (filter.dateFrom || filter.dateTo) {
      dateFilter.date = {};
      if (filter.dateFrom) dateFilter.date.$gte = new Date(filter.dateFrom);
      if (filter.dateTo) dateFilter.date.$lte = new Date(filter.dateTo);
    }
    
    // Get city summary KPIs
    const summaryKPIs = await Sales.aggregate([
      {
        $match: {
          plant: { $in: storeIds },
          ...dateFilter
        }
      },
      {
        $group: {
          _id: null,
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalGSV: { $sum: '$gsv' },
          totalDiscount: { $sum: '$discount' },
          totalTax: { $sum: '$totalTax' },
          totalOrders: { $sum: 1 }
        }
      }
    ]);
    
    // Get top products in city
    const topProducts = await Sales.aggregate([
      {
        $match: {
          plant: { $in: storeIds },
          ...dateFilter
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: 'materialCode',
          foreignField: '_id',
          as: 'product'
        }
      },
      {
        $unwind: '$product'
      },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.category',
          foreignField: '_id',
          as: 'category'
        }
      },
      {
        $unwind: {
          path: '$category',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: '$product._id',
          productName: { $first: '$product.name' },
          productCode: { $first: '$product.softwareCode' },
          categoryName: { $first: { $ifNull: ['$category.name', 'Unknown Category'] } },
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalGSV: { $sum: '$gsv' }
        }
      },
      {
        $sort: { totalNSV: -1 }
      },
      {
        $limit: 10
      }
    ]);
    
    // Get store performance in city
    const storePerformance = await Sales.aggregate([
      {
        $match: {
          plant: { $in: storeIds },
          ...dateFilter
        }
      },
      {
        $lookup: {
          from: 'stores',
          localField: 'plant',
          foreignField: '_id',
          as: 'store'
        }
      },
      {
        $unwind: '$store'
      },
      {
        $group: {
          _id: '$store._id',
          storeName: { $first: '$store.storeName' },
          storeId: { $first: '$store.storeId' },
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalGSV: { $sum: '$gsv' }
        }
      },
      {
        $sort: { totalNSV: -1 }
      }
    ]);
    
    const summary = summaryKPIs[0] || {
      totalQuantity: 0,
      totalNSV: 0,
      totalGSV: 0,
      totalDiscount: 0,
      totalTax: 0,
      totalOrders: 0
    };
    
    return {
      totalQuantity: summary.totalQuantity,
      totalNSV: summary.totalNSV,
      totalGSV: summary.totalGSV,
      totalDiscount: summary.totalDiscount,
      totalTax: summary.totalTax,
      totalOrders: summary.totalOrders,
      topProducts,
      storePerformance
    };
    
  } catch (error) {
    console.error('Error in getCitySpecificAnalytics:', error);
    return null;
  }
};

/**
 * Get comprehensive analytics dashboard using analytics service
 * @param {Object} params - Dashboard parameters
 * @returns {Promise<string>} HTML string with analytics dashboard
 */
export const getAnalyticsDashboard = async (params = {}) => {
  try {
    const { dateFrom, dateTo, city } = params;
    
    let filter = {};
    if (dateFrom || dateTo) {
      filter.dateFrom = dateFrom;
      filter.dateTo = dateTo;
    }
    
    // If city is specified, we need to filter data for that city
    if (city) {
      // Find all stores in the specified city
      const storesInCity = await Store.find({ 
        city: { $regex: city, $options: 'i' } 
      }).select('_id storeName storeId city').lean();
      
      if (storesInCity.length === 0) {
        return generateHTMLResponse('No Stores Found', `No stores found in ${city}. Please check the city name.`);
      }
      
      // Get city-specific analytics data
      const cityAnalytics = await getCitySpecificAnalytics(city, filter);
      
      if (!cityAnalytics) {
        return generateHTMLResponse('No Data Available', `No analytics data available for ${city}.`);
      }
      
      // Generate city-specific dashboard HTML
      const html = AI_TOOL_STYLES + `
        <div class="ai-tool-response">
          <h3>📊 Analytics Dashboard - ${city.charAt(0).toUpperCase() + city.slice(1)}</h3>
          
          <!-- City Info -->
          <div class="city-info">
            <p><strong>City:</strong> ${city.charAt(0).toUpperCase() + city.slice(1)}</p>
            <p><strong>Total Stores:</strong> ${storesInCity.length}</p>
            <p><strong>Stores:</strong> ${storesInCity.map(s => s.storeName).join(', ')}</p>
          </div>
          
          <!-- Summary KPIs -->
          <div class="kpi-grid">
            <div class="kpi-item">
              <div class="kpi-label">Total Quantity</div>
              <div class="kpi-value">${cityAnalytics.totalQuantity?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total NSV</div>
              <div class="kpi-value">₹${cityAnalytics.totalNSV?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total GSV</div>
              <div class="kpi-value">₹${cityAnalytics.totalGSV?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total Discount</div>
              <div class="kpi-value">₹${cityAnalytics.totalDiscount?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total Tax</div>
              <div class="kpi-value">₹${cityAnalytics.totalTax?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Orders</div>
              <div class="kpi-value">${cityAnalytics.totalOrders?.toLocaleString() || '0'}</div>
            </div>
          </div>
          
          <!-- Top Products in City -->
          ${cityAnalytics.topProducts && cityAnalytics.topProducts.length > 0 ? `
            <div class="chart-container">
              <h4>🏆 Top Products in ${city.charAt(0).toUpperCase() + city.slice(1)}</h4>
              <div class="table-container">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Product Name</th>
                      <th>Code</th>
                      <th>Category</th>
                      <th>Quantity</th>
                      <th>NSV (₹)</th>
                      <th>GSV (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${cityAnalytics.topProducts.slice(0, 5).map((product, index) => `
                      <tr>
                        <td>${index + 1}</td>
                        <td>${product.productName || 'Unknown'}</td>
                        <td>${product.productCode || 'N/A'}</td>
                        <td>${product.categoryName || 'Unknown'}</td>
                        <td>${product.totalQuantity.toLocaleString()}</td>
                        <td>₹${product.totalNSV.toLocaleString()}</td>
                        <td>₹${product.totalGSV.toLocaleString()}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}
          
          <!-- Store Performance in City -->
          ${cityAnalytics.storePerformance && cityAnalytics.storePerformance.length > 0 ? `
            <div class="chart-container">
              <h4>🏪 Store Performance in ${city.charAt(0).toUpperCase() + city.slice(1)}</h4>
              <div class="table-container">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Store Name</th>
                      <th>Store ID</th>
                      <th>Quantity</th>
                      <th>NSV (₹)</th>
                      <th>GSV (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${cityAnalytics.storePerformance.slice(0, 10).map((store, index) => `
                      <tr>
                        <td>${index + 1}</td>
                        <td>${store.storeName || 'Unknown'}</td>
                        <td>${store.storeId || 'N/A'}</td>
                        <td>${store.totalQuantity.toLocaleString()}</td>
                        <td>₹${store.totalNSV.toLocaleString()}</td>
                        <td>₹${store.totalGSV.toLocaleString()}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}
          
          <p class="summary">Analytics dashboard generated successfully for ${city.charAt(0).toUpperCase() + city.slice(1)} with ${storesInCity.length} stores.</p>
        </div>
      `;
      
      return html;
    }
    
    // Get dashboard data using analytics service
    const dashboardData = await analyticsService.getAnalyticsDashboard(filter);
    
    if (!dashboardData) {
      return generateHTMLResponse('No Data Available', 'Analytics dashboard data not available.');
    }
    
    // Generate comprehensive dashboard HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📊 Analytics Dashboard</h3>
        
        <!-- Summary KPIs -->
        ${dashboardData.summaryKPIs ? `
          <div class="kpi-grid">
            <div class="kpi-item">
              <div class="kpi-label">Total Quantity</div>
              <div class="kpi-value">${dashboardData.summaryKPIs.totalQuantity?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total NSV</div>
              <div class="kpi-value">₹${dashboardData.summaryKPIs.totalNSV?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total GSV</div>
              <div class="kpi-value">₹${dashboardData.summaryKPIs.totalGSV?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total Discount</div>
              <div class="kpi-value">₹${dashboardData.summaryKPIs.totalDiscount?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total Tax</div>
              <div class="kpi-value">₹${dashboardData.summaryKPIs.totalTax?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Orders</div>
              <div class="kpi-value">${dashboardData.summaryKPIs.recordCount?.toLocaleString() || '0'}</div>
            </div>
          </div>
        ` : ''}
        
        <!-- Top Products -->
        ${dashboardData.productPerformance && dashboardData.productPerformance.length > 0 ? `
          <div class="chart-container">
            <h4>🏆 Top Products</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Product Name</th>
                    <th>Code</th>
                    <th>Category</th>
                    <th>Quantity</th>
                    <th>NSV (₹)</th>
                    <th>GSV (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  ${dashboardData.productPerformance.slice(0, 5).map((product, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${product.productName || 'Unknown'}</td>
                      <td>${product.productCode || 'N/A'}</td>
                      <td>${product.categoryName || 'Unknown'}</td>
                      <td>${product.totalQuantity.toLocaleString()}</td>
                      <td>₹${product.totalNSV.toLocaleString()}</td>
                      <td>₹${product.totalGSV.toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <!-- Top Stores -->
        ${dashboardData.storePerformance && dashboardData.storePerformance.length > 0 ? `
          <div class="chart-container">
            <h4>🏪 Top Stores</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Store Name</th>
                    <th>Store ID</th>
                    <th>City</th>
                    <th>Quantity</th>
                    <th>NSV (₹)</th>
                    <th>GSV (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  ${dashboardData.storePerformance.slice(0, 5).map((store, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${store.storeName || 'Unknown'}</td>
                      <td>${store.storeId || 'N/A'}</td>
                      <td>${store.city || 'Unknown'}</td>
                      <td>${store.totalQuantity.toLocaleString()}</td>
                      <td>₹${store.totalNSV.toLocaleString()}</td>
                      <td>₹${store.totalGSV.toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <!-- Brand Performance -->
        ${dashboardData.brandPerformance && dashboardData.brandPerformance.length > 0 ? `
          <div class="chart-container">
            <h4>🏷️ Brand Performance</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Brand</th>
                    <th>Quantity</th>
                    <th>NSV (₹)</th>
                    <th>GSV (₹)</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${dashboardData.brandPerformance.slice(0, 5).map((brand, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${brand.brandName || 'Unknown'}</td>
                      <td>${brand.totalQuantity.toLocaleString()}</td>
                      <td>₹${brand.totalNSV.toLocaleString()}</td>
                      <td>₹${brand.totalGSV.toLocaleString()}</td>
                      <td>${brand.recordCount}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <p class="summary">Analytics dashboard generated successfully with comprehensive business insights.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getAnalyticsDashboard:', error);
    return generateHTMLResponse('Error', `Failed to generate analytics dashboard: ${error.message}`);
  }
};

/**
 * Get store performance analysis using analytics service
 * @param {Object} params - Store analysis parameters
 * @returns {Promise<string>} HTML string with store analysis
 */
export const getStoreAnalysis = async (params = {}) => {
  try {
    const { storeId, storeName, city, dateFrom, dateTo } = params;
    
    let filter = {};
    if (dateFrom || dateTo) {
      filter.dateFrom = dateFrom;
      filter.dateTo = dateTo;
    }
    
    let storeData = null;
    
    // Find store by ID, name, or city
    if (storeId) {
      storeData = await analyticsService.getIndividualStoreAnalysis({ ...filter, storeId });
    } else if (storeName || city) {
      const storeFilter = {};
      if (storeName) storeFilter.storeName = { $regex: storeName, $options: 'i' };
      if (city) storeFilter.city = { $regex: city, $options: 'i' };
      
      const stores = await Store.find(storeFilter).limit(1).lean();
      if (stores.length > 0) {
        storeData = await analyticsService.getIndividualStoreAnalysis({ ...filter, storeId: stores[0]._id });
      }
    }
    
    if (!storeData) {
      return generateHTMLResponse('Store Not Found', 'No store found matching the specified criteria.');
    }
    
    // Generate store analysis HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏪 Store Performance Analysis</h3>
        
        <!-- Store Info -->
        <div class="city-info">
          <p><strong>Store:</strong> ${storeData.storeInfo.storeName}</p>
          <p><strong>Store ID:</strong> ${storeData.storeInfo.storeId}</p>
          <p><strong>Address:</strong> ${storeData.storeInfo.address}</p>
          <p><strong>Contact:</strong> ${storeData.storeInfo.contactPerson}</p>
          <p><strong>Gross LTV:</strong> ₹${storeData.storeInfo.grossLTV.toLocaleString()}</p>
          <p><strong>Current Month Trend:</strong> ${storeData.storeInfo.currentMonthTrend}%</p>
        </div>
        
        <!-- Monthly Sales Analysis -->
        ${storeData.monthlySalesAnalysis && storeData.monthlySalesAnalysis.length > 0 ? `
          <div class="chart-container">
            <h4>📈 Monthly Sales Analysis</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>NSV (₹)</th>
                    <th>Quantity</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${storeData.monthlySalesAnalysis.slice(0, 6).map((month) => `
                    <tr>
                      <td>${new Date(month.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                      <td>₹${month.totalNSV.toLocaleString()}</td>
                      <td>${month.totalQuantity.toLocaleString()}</td>
                      <td>${month.totalOrders}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <!-- Top Products in Store -->
        ${storeData.productSalesAnalysis && storeData.productSalesAnalysis.length > 0 ? `
          <div class="chart-container">
            <h4>📦 Top Products in Store</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Product Name</th>
                    <th>Code</th>
                    <th>NSV (₹)</th>
                    <th>Quantity</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${storeData.productSalesAnalysis.slice(0, 5).map((product, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${product.productName || 'Unknown'}</td>
                      <td>${product.productCode || 'N/A'}</td>
                      <td>₹${product.totalNSV.toLocaleString()}</td>
                      <td>${product.totalQuantity.toLocaleString()}</td>
                      <td>${product.totalOrders}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <p class="summary">Store analysis completed for ${storeData.storeInfo.storeName}.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getStoreAnalysis:', error);
    return generateHTMLResponse('Error', `Failed to generate store analysis: ${error.message}`);
  }
};

/**
 * Generate HTML response wrapper
 * @param {string} title - Response title
 * @param {string} content - Response content
 * @returns {string} Formatted HTML
 */
const generateHTMLResponse = (title, content) => {
  return AI_TOOL_STYLES + `
    <div class="ai-tool-response">
      <h3>${title}</h3>
      <div class="response-content">
        <p>${content}</p>
      </div>
    </div>
  `;
};

/**
 * Get sales forecast for specific product and city
 * @param {Object} params - Forecast parameters
 * @returns {Promise<string>} HTML string with forecast data
 */
export const getProductForecast = async (params = {}) => {
  try {
    const { productName, city } = params;
    
    if (!productName) {
      return generateHTMLResponse('Product Required', 'Please specify a product name for forecasting.');
    }
    
    // Find product by name
    const product = await Product.findOne({ 
      name: { $regex: productName, $options: 'i' } 
    }).lean();
    
    if (!product) {
      return generateHTMLResponse('Product Not Found', `Product "${productName}" not found in the system.`);
    }
    
    let storeFilter = {};
    if (city) {
      storeFilter.city = { $regex: city, $options: 'i' };
    }
    
    // Get stores
    const stores = await Store.find(storeFilter).select('_id storeName city').lean();
    if (stores.length === 0) {
      return generateHTMLResponse('No Stores Found', city ? `No stores found in ${city}.` : 'No stores found in the system.');
    }
    
    // Get forecast data using analytics service
    const forecastData = await analyticsService.getProductDemandForecasting({
      productId: product._id,
      months: 3
    });
    
    // Filter forecast data for specific stores if city is specified
    let filteredForecast = forecastData.forecastData;
    if (city) {
      const storeIds = stores.map(s => s._id.toString());
      filteredForecast = forecastData.forecastData.filter(f => 
        storeIds.includes(f.storeId.toString())
      );
    }
    
    if (filteredForecast.length === 0) {
      return generateHTMLResponse('No Forecast Data', `No forecast data available for ${productName}${city ? ` in ${city}` : ''}.`);
    }
    
    // Generate forecast HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🔮 Sales Forecast for ${product.name}</h3>
        <div class="city-info">
          <p><strong>Product:</strong> ${product.name}</p>
          <p><strong>Product Code:</strong> ${product.softwareCode || 'N/A'}</p>
          ${city ? `<p><strong>City:</strong> ${city}</p>` : ''}
          <p><strong>Forecast Period:</strong> Next 3 months</p>
        </div>
        
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Store</th>
                <th>City</th>
                <th>Forecasted Quantity</th>
                <th>Forecasted NSV (₹)</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              ${filteredForecast.map((forecast) => `
                <tr>
                  <td>${new Date(forecast.forecastMonth).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                  <td>${forecast.storeName || 'Unknown'}</td>
                  <td>${forecast.storeCode || 'N/A'}</td>
                  <td>${forecast.forecastedQuantity.toLocaleString()}</td>
                  <td>₹${forecast.forecastedNSV.toLocaleString()}</td>
                  <td>${(forecast.confidence * 100).toFixed(1)}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        
        <p class="summary">Forecast generated for ${product.name}${city ? ` in ${city}` : ''} across ${stores.length} stores.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getProductForecast:', error);
    return generateHTMLResponse('Error', `Failed to generate forecast: ${error.message}`);
  }
};

/**
 * Get system capabilities and use cases
 * @returns {Promise<string>} HTML string with capabilities
 */
export const getCapabilities = async () => {
  const html = AI_TOOL_STYLES + `
    <div class="ai-tool-response">
      <h3>🚀 System Capabilities & Use Cases</h3>
      
      <div class="kpi-grid">
        <div class="kpi-item">
          <div class="kpi-label">📊 Analytics & Reporting</div>
          <div class="kpi-value">Complete</div>
          <div class="kpi-change">Sales trends, product performance, store analysis</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-label">🔮 Demand Forecasting</div>
          <div class="kpi-value">Advanced</div>
          <div class="kpi-change">Product & store-level predictions</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-label">📦 Inventory Management</div>
          <div class="kpi-value">Smart</div>
          <div class="kpi-change">Replenishment recommendations</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-label">🏪 Store Performance</div>
          <div class="kpi-value">Real-time</div>
          <div class="kpi-change">Individual store analytics</div>
        </div>
      </div>
      
      <div class="chart-container">
        <h4>🎯 Key Use Cases</h4>
        <div class="response-content">
          <p><strong>1. Sales Analysis:</strong> Track product performance, identify top sellers, analyze trends</p>
          <p><strong>2. Store Optimization:</strong> Compare store performance, identify improvement opportunities</p>
          <p><strong>3. Demand Planning:</strong> Forecast future sales, optimize inventory levels</p>
          <p><strong>4. Product Insights:</strong> Analyze individual product performance across stores</p>
          <p><strong>5. Geographic Analysis:</strong> City-wise performance, regional trends</p>
          <p><strong>6. Inventory Optimization:</strong> Prevent stockouts, reduce excess inventory</p>
        </div>
      </div>
      
      <div class="chart-container">
        <h4>💡 How to Use</h4>
        <div class="response-content">
          <p><strong>• Ask for reports:</strong> "Show me top products", "Generate sales report"</p>
          <p><strong>• Analyze specific items:</strong> "Give me PE Mens Full Rib analysis"</p>
          <p><strong>• Check store performance:</strong> "Show me store ABC data"</p>
          <p><strong>• Get forecasts:</strong> "Next month sales forecast for Product X in Mumbai"</p>
          <p><strong>• Compare performance:</strong> "Store performance analysis"</p>
        </div>
      </div>
      
      <p class="summary">Our AI-powered system provides comprehensive business intelligence for retail operations.</p>
    </div>
  `;
  
  return html;
};

/**
 * Get detailed product analysis by product name
 * @param {Object} params - Product analysis parameters
 * @returns {Promise<string>} HTML string with product analysis
 */
export const getProductAnalysis = async (params = {}) => {
  try {
    const { productName } = params;
    
    if (!productName) {
      return generateHTMLResponse('Product Required', 'Please specify a product name for analysis.');
    }
    
    // Find product by name
    const product = await Product.findOne({ 
      name: { $regex: productName, $options: 'i' } 
    }).lean();
    
    if (!product) {
      return generateHTMLResponse('Product Not Found', `Product "${productName}" not found in the system.`);
    }
    
    // Get product analysis directly from sales data
    const productAnalysis = await Sales.aggregate([
      { $match: { materialCode: product._id } },
      {
        $lookup: {
          from: 'stores',
          localField: 'plant',
          foreignField: '_id',
          as: 'storeData'
        }
      },
      { $unwind: '$storeData' },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.category',
          foreignField: '_id',
          as: 'categoryData'
        }
      },
      {
        $unwind: {
          path: '$categoryData',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: null,
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalGSV: { $sum: '$gsv' },
          totalDiscount: { $sum: '$discount' },
          totalOrders: { $sum: 1 },
          avgOrderValue: { $avg: '$nsv' }
        }
      }
    ]);
    
    if (!productAnalysis || productAnalysis.length === 0) {
      return generateHTMLResponse('No Sales Data', `No sales data available for ${product.name}.`);
    }
    
    const summary = productAnalysis[0];
    
    // Get monthly sales analysis
    const monthlySales = await Sales.aggregate([
      { $match: { materialCode: product._id } },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' }
          },
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalOrders: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $limit: 6 }
    ]);
    
    // Get store-wise performance
    const storePerformance = await Sales.aggregate([
      { $match: { materialCode: product._id } },
      {
        $lookup: {
          from: 'stores',
          localField: 'plant',
          foreignField: '_id',
          as: 'storeData'
        }
      },
      { $unwind: '$storeData' },
      {
        $group: {
          _id: '$storeData._id',
          storeName: { $first: '$storeData.storeName' },
          storeCode: { $first: '$storeData.storeId' },
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalOrders: { $sum: 1 }
        }
      },
      { $sort: { totalNSV: -1 } },
      { $limit: 10 }
    ]);
    
    // Calculate trend (simple comparison with previous period)
    let currentTrend = 0;
    if (monthlySales.length >= 2) {
      const currentMonth = monthlySales[monthlySales.length - 1];
      const previousMonth = monthlySales[monthlySales.length - 2];
      if (previousMonth.totalNSV > 0) {
        currentTrend = ((currentMonth.totalNSV - previousMonth.totalNSV) / previousMonth.totalNSV * 100).toFixed(1);
      }
    }
    
    // Generate product analysis HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📦 Product Analysis: ${product.name}</h3>
        
        <!-- Product Info -->
        <div class="city-info">
          <p><strong>Product Name:</strong> ${product.name}</p>
          <p><strong>Product Code:</strong> ${product.softwareCode || 'N/A'}</p>
          <p><strong>Category:</strong> ${product.category ? 'Unknown Category' : 'Uncategorized'}</p>
          <p><strong>Total Quantity Sold:</strong> ${(summary.totalQuantity || 0).toLocaleString()}</p>
          <p><strong>Total Revenue (NSV):</strong> ₹${(summary.totalNSV || 0).toLocaleString()}</p>
          <p><strong>Total Revenue (GSV):</strong> ₹${(summary.totalGSV || 0).toLocaleString()}</p>
          <p><strong>Total Discount:</strong> ₹${(summary.totalDiscount || 0).toLocaleString()}</p>
          <p><strong>Total Orders:</strong> ${(summary.totalOrders || 0).toLocaleString()}</p>
          <p><strong>Average Order Value:</strong> ₹${(summary.avgOrderValue || 0).toFixed(2)}</p>
          <p><strong>Current Trend:</strong> ${currentTrend}%</p>
        </div>
        
        <!-- Monthly Sales Analysis -->
        ${monthlySales && monthlySales.length > 0 ? `
          <div class="chart-container">
            <h4>📈 Monthly Sales Trend</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Quantity Sold</th>
                    <th>Revenue (₹)</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${monthlySales.map((month) => `
                    <tr>
                      <td>${month._id.month}/${month._id.year}</td>
                      <td>${(month.totalQuantity || 0).toLocaleString()}</td>
                      <td>₹${(month.totalNSV || 0).toLocaleString()}</td>
                      <td>${month.totalOrders || 0}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <!-- Store-wise Performance -->
        ${storePerformance && storePerformance.length > 0 ? `
          <div class="chart-container">
            <h4>🏪 Store Performance</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Store Name</th>
                    <th>Store Code</th>
                    <th>Quantity Sold</th>
                    <th>Revenue (₹)</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${storePerformance.map((store, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${store.storeName || 'Unknown'}</td>
                      <td>${store.storeCode || 'N/A'}</td>
                      <td>${(store.totalQuantity || 0).toLocaleString()}</td>
                      <td>₹${(store.totalNSV || 0).toLocaleString()}</td>
                      <td>${store.totalOrders || 0}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <p class="summary">Product analysis completed for ${product.name} with comprehensive performance insights.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getProductAnalysis:', error);
    return generateHTMLResponse('Error', `Failed to generate product analysis: ${error.message}`);
  }
};

/**
 * Get store analysis by store name
 * @param {Object} params - Store analysis parameters
 * @returns {Promise<string>} HTML string with store analysis
 */
export const getStoreAnalysisByName = async (params = {}) => {
  try {
    const { storeName } = params;
    
    if (!storeName) {
      return generateHTMLResponse('Store Required', 'Please specify a store name for analysis.');
    }
    
    // Find store by name
    const store = await Store.findOne({ 
      storeName: { $regex: storeName, $options: 'i' } 
    }).lean();
    
    if (!store) {
      return generateHTMLResponse('Store Not Found', `Store "${storeName}" not found in the system.`);
    }
    
    // Get store analysis using analytics service
    const storeAnalysis = await analyticsService.getIndividualStoreAnalysis({
      storeId: store._id
    });
    
    if (!storeAnalysis) {
      return generateHTMLResponse('No Data Available', `No analysis data available for ${store.storeName}.`);
    }
    
    // Generate store analysis HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏪 Store Analysis: ${store.storeName}</h3>
        
        <!-- Store Info -->
        <div class="city-info">
          <p><strong>Store Name:</strong> ${store.storeName}</p>
          <p><strong>Store ID:</strong> ${store.storeId}</p>
          <p><strong>City:</strong> ${store.city}</p>
          <p><strong>Address:</strong> ${store.addressLine1}, ${store.city}, ${store.state}</p>
          <p><strong>Contact:</strong> ${store.contactPerson} (${store.contactPerson})</p>
          <p><strong>Gross LTV:</strong> ₹${storeAnalysis.storeInfo.grossLTV.toLocaleString()}</p>
          <p><strong>Current Month Trend:</strong> ${storeAnalysis.storeInfo.currentMonthTrend}%</p>
        </div>
        
        <!-- Monthly Sales Analysis -->
        ${storeAnalysis.monthlySalesAnalysis && storeAnalysis.monthlySalesAnalysis.length > 0 ? `
          <div class="chart-container">
            <h4>📈 Monthly Sales Trend</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Quantity Sold</th>
                    <th>Revenue (₹)</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${storeAnalysis.monthlySalesAnalysis.slice(0, 6).map((month) => `
                    <tr>
                      <td>${new Date(month.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                      <td>${month.totalQuantity.toLocaleString()}</td>
                      <td>₹${month.totalNSV.toLocaleString()}</td>
                      <td>${month.totalOrders}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <!-- Top Products in Store -->
        ${storeAnalysis.productSalesAnalysis && storeAnalysis.productSalesAnalysis.length > 0 ? `
          <div class="chart-container">
            <h4>📦 Top Products</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Product Name</th>
                    <th>Product Code</th>
                    <th>Quantity Sold</th>
                    <th>Revenue (₹)</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${storeAnalysis.productSalesAnalysis.slice(0, 10).map((product, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${product.productName || 'Unknown'}</td>
                      <td>${product.productCode || 'N/A'}</td>
                      <td>${product.totalQuantity.toLocaleString()}</td>
                      <td>₹${product.totalNSV.toLocaleString()}</td>
                      <td>${product.totalOrders}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <p class="summary">Store analysis completed for ${store.storeName} with comprehensive performance insights.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getStoreAnalysisByName:', error);
    return generateHTMLResponse('Error', `Failed to generate store analysis: ${error.message}`);
  }
};

/**
 * Execute AI tool based on detected intent
 * @param {Object} intent - Detected intent object
 * @returns {Promise<string>} HTML response
 */
export const executeAITool = async (intent) => {
  try {
    switch (intent.action) {
      case 'getTopProducts':
        return await getTopProducts(intent.params.city);
      case 'getProductCount':
        return await getProductCount();
      case 'getTopProductsInCity':
        return await getTopProductsInCity(intent.params.city);
      case 'getSalesReport':
        return await getSalesReport(intent.params);
      case 'getAnalyticsDashboard':
        return await getAnalyticsDashboard(intent.params);
      case 'getStoreAnalysis':
        return await getStoreAnalysis(intent.params);
      case 'getProductForecast':
        return await getProductForecast(intent.params);
      case 'getCapabilities':
        return await getCapabilities();
      case 'getProductAnalysis':
        return await getProductAnalysis(intent.params);
      case 'getStoreAnalysisByName':
        return await getStoreAnalysisByName(intent.params);
      default:
        throw new Error(`Unknown action: ${intent.action}`);
    }
  } catch (error) {
    console.error('Error executing AI tool:', error);
    return generateHTMLResponse('Error', `Failed to execute ${intent.action}: ${error.message}`);
  }
};

export default {
  getTopProducts,
  getProductCount,
  getTopProductsInCity,
  getSalesReport,
  getAnalyticsDashboard,
  getStoreAnalysis,
  getProductForecast,
  getCapabilities,
  getProductAnalysis,
  getStoreAnalysisByName,
  detectIntent,
  executeAITool
};
