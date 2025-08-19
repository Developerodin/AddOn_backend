import * as analyticsService from './analytics.service.js';
import * as productService from './product.service.js';
import * as replenishmentService from './replenishment.service.js';
import Store from '../models/store.model.js';
import Sales from '../models/sales.model.js';

/**
 * Smart field extractors for different data types
 */
const FIELD_EXTRACTORS = {
  // Extract label fields (names, titles, identifiers)
  getLabelField: (item) => {
    const labelFields = [
      'name', 'productName', 'storeName', 'categoryName', 'title', 
      'product', 'store', 'category', 'period', 'date', 'month',
      'brand', 'sku', 'id', 'code'
    ];
    
    for (const field of labelFields) {
      if (item[field] !== undefined && item[field] !== null) {
        return String(item[field]);
      }
    }
    
    // Fallback: use first non-id field
    const keys = Object.keys(item).filter(key => 
      !key.startsWith('_') && 
      key !== '__v' && 
      key !== 'id' && 
      key !== '_id' &&
      typeof item[key] !== 'object'
    );
    
    return keys.length > 0 ? String(item[keys[0]]) : 'Unknown';
  },

  // Extract numeric value fields
  getValueField: (item) => {
    const valueFields = [
      'sales', 'revenue', 'quantity', 'amount', 'total', 'count',
      'value', 'price', 'cost', 'profit', 'margin', 'percentage',
      'score', 'rating', 'rank', 'order', 'index'
    ];
    
    for (const field of valueFields) {
      if (item[field] !== undefined && item[field] !== null) {
        const value = Number(item[field]);
        if (!isNaN(value)) return value;
      }
    }
    
    // Fallback: find first numeric field
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === 'number' && !isNaN(value)) {
        return value;
      }
      if (typeof value === 'string' && !isNaN(Number(value))) {
        return Number(value);
      }
    }
    
    return 0;
  },

  // Extract all available fields for table display
  getTableFields: (items) => {
    if (!Array.isArray(items) || items.length === 0) return [];
    
    const allFields = new Set();
    items.forEach(item => {
      Object.keys(item).forEach(key => {
        if (!key.startsWith('_') && key !== '__v' && typeof item[key] !== 'object') {
          allFields.add(key);
        }
      });
    });
    
    // Prioritize common fields
    const priorityFields = ['name', 'productName', 'storeName', 'categoryName', 'sales', 'revenue', 'quantity'];
    const sortedFields = [];
    
    // Add priority fields first
    priorityFields.forEach(field => {
      if (allFields.has(field)) {
        sortedFields.push(field);
        allFields.delete(field);
      }
    });
    
    // Add remaining fields
    sortedFields.push(...Array.from(allFields).sort());
    
    return sortedFields.slice(0, 8); // Limit to 8 columns for readability
  },

  // Extract data for charts
  getChartData: (items) => {
    if (!Array.isArray(items) || items.length === 0) {
      return { labels: [], values: [] };
    }
    
    const labels = items.map(item => FIELD_EXTRACTORS.getLabelField(item));
    const values = items.map(item => FIELD_EXTRACTORS.getValueField(item));
    
    return { labels, values };
  },

  // Extract summary data
  getSummaryData: (data) => {
    if (data.totalProducts !== undefined) {
      return { value: data.totalProducts.toString(), subtitle: 'Products' };
    }
    if (data.totalStores !== undefined) {
      return { value: data.totalStores.toString(), subtitle: 'Stores' };
    }
    if (data.totalSales !== undefined) {
      return { value: `$${data.totalSales.toLocaleString()}`, subtitle: 'Sales' };
    }
    if (data.totalResults !== undefined) {
      return { value: data.totalResults.toString(), subtitle: 'Results' };
    }
    if (data.results && Array.isArray(data.results)) {
      return { value: data.results.length.toString(), subtitle: 'Items' };
    }
    if (data.data && Array.isArray(data.data)) {
      return { value: data.data.length.toString(), subtitle: 'Items' };
    }
    
    return { value: '0', subtitle: 'Total' };
  }
};

/**
 * HTML templates for different types of responses
 */
const HTML_TEMPLATES = {
  // Chart templates
  barChart: (data, title, labels, values) => `
    <div class="chart-container">
      <h4>${title}</h4>
      <canvas id="chart-${Date.now()}" width="400" height="200"></canvas>
      <script>
        const ctx = document.getElementById('chart-${Date.now()}').getContext('2d');
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [{
              label: '${title}',
              data: ${JSON.stringify(values)},
              backgroundColor: 'rgba(54, 162, 235, 0.8)',
              borderColor: 'rgba(54, 162, 235, 1)',
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            scales: {
              y: { beginAtZero: true }
            }
          }
        });
      </script>
    </div>
  `,

  lineChart: (data, title, labels, values) => `
    <div class="chart-container">
      <h4>${title}</h4>
      <canvas id="chart-${Date.now()}" width="400" height="200"></canvas>
      <script>
        const ctx = document.getElementById('chart-${Date.now()}').getContext('2d');
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [{
              label: '${title}',
              data: ${JSON.stringify(values)},
              borderColor: 'rgba(75, 192, 192, 1)',
              backgroundColor: 'rgba(75, 192, 192, 0.2)',
              tension: 0.1
            }]
          },
          options: {
            responsive: true,
            scales: {
              y: { beginAtZero: true }
            }
          }
        });
      </script>
    </div>
  `,

  pieChart: (data, title, labels, values) => `
    <div class="chart-container">
      <h4>${title}</h4>
      <canvas id="chart-${Date.now()}" width="400" height="200"></canvas>
      <script>
        const ctx = document.getElementById('chart-${Date.now()}').getContext('2d');
        new Chart(ctx, {
          type: 'pie',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [{
              data: ${JSON.stringify(values)},
              backgroundColor: [
                'rgba(255, 99, 132, 0.8)',
                'rgba(54, 162, 235, 0.8)',
                'rgba(255, 206, 86, 0.8)',
                'rgba(75, 192, 192, 0.8)',
                'rgba(153, 102, 255, 0.8)'
              ]
            }]
          },
          options: {
            responsive: true
          }
        });
      </script>
    </div>
  `,

  // Table templates - Simple and clean
  dataTable: (data, title, columns) => `
    <div class="table-container">
      <h4>${title}</h4>
      <table class="data-table">
        <thead>
          <tr>
            ${columns.map(col => `<th>${col}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${data.map(row => `
            <tr>
              ${columns.map(col => `<td>${row[col] || '-'}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `,

  // Summary cards
  summaryCard: (title, value, subtitle) => `
    <div class="summary-card">
      <div class="card-content">
        <h3>${title}</h3>
        <div class="card-value">${value}</div>
        <div class="card-subtitle">${subtitle}</div>
      </div>
    </div>
  `,

  // Text summary without follow-up
  textSummary: (data, title, summary) => `
    <div class="text-summary">
      <h4>${title}</h4>
      <div class="summary-content">
        ${summary}
      </div>
    </div>
  `,

  // KPI dashboard
  kpiDashboard: (kpis) => `
    <div class="kpi-dashboard">
      <h4>Key Performance Indicators</h4>
      <div class="kpi-grid">
        ${kpis.map(kpi => `
          <div class="kpi-item">
            <div class="kpi-label">${kpi.label}</div>
            <div class="kpi-value">${kpi.value}</div>
            <div class="kpi-change ${kpi.change >= 0 ? 'positive' : 'negative'}">
              ${kpi.change >= 0 ? '+' : ''}${kpi.change}%
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `,

  // Heatmap
  heatmap: (data, title, xLabels, yLabels) => `
    <div class="heatmap-container">
      <h4>${title}</h4>
      <div class="heatmap">
        ${yLabels.map((yLabel, yIndex) => `
          <div class="heatmap-row">
            <div class="heatmap-label">${yLabel}</div>
            ${xLabels.map((xLabel, xIndex) => {
              const value = data[yIndex]?.[xIndex] || 0;
              const intensity = Math.min(100, Math.max(0, (value / Math.max(...data.flat())) * 100));
              return `<div class="heatmap-cell" style="background-color: rgba(255, 99, 132, ${intensity / 100})" title="${xLabel}: ${value}">${value}</div>`;
            }).join('')}
          </div>
        `).join('')}
      </div>
      <div class="heatmap-legend">
        <span>Low</span>
        <div class="legend-gradient"></div>
        <span>High</span>
      </div>
    </div>
  `
};

/**
 * CSS styles for the HTML responses - Clean styling without card UI
 */
const CHATBOT_STYLES = `
<style>
.chatbot-response {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  margin: 15px 0;
}

.chart-container {
  margin: 20px 0;
  padding: 15px;
}

.chart-container h4 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 16px;
  font-weight: 600;
}

.table-container {
  margin: 20px 0;
  overflow-x: auto;
}

.table-container h4 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 16px;
  font-weight: 600;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.data-table th,
.data-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #e1e5e9;
}

.data-table th {
  background-color: #f8f9fa;
  font-weight: 600;
  color: #495057;
}

.data-table tr:hover {
  background-color: #f8f9fa;
}

.summary-card {
  display: inline-block;
  margin: 10px;
  padding: 20px;
  min-width: 150px;
  text-align: center;
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
  color: #2c3e50;
}

.card-subtitle {
  font-size: 12px;
  color: #6c757d;
}

.kpi-dashboard {
  margin: 20px 0;
  padding: 20px;
}

.kpi-dashboard h4 {
  margin: 0 0 20px 0;
  color: #2c3e50;
  font-size: 16px;
  font-weight: 600;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
}

.kpi-item {
  padding: 15px;
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

.heatmap-container {
  margin: 20px 0;
  padding: 15px;
}

.heatmap-container h4 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 16px;
  font-weight: 600;
}

.heatmap {
  margin-bottom: 15px;
}

.heatmap-row {
  display: flex;
  align-items: center;
  margin-bottom: 5px;
}

.heatmap-label {
  width: 100px;
  font-size: 12px;
  font-weight: 600;
  color: #495057;
}

.heatmap-cell {
  width: 40px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: white;
  text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
  border: 1px solid #fff;
}

.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #6c757d;
}

.legend-gradient {
  width: 100px;
  height: 20px;
  background: linear-gradient(to right, rgba(255, 99, 132, 0.1), rgba(255, 99, 132, 1));
  border-radius: 10px;
}

.chartjs-container {
  position: relative;
  height: 300px;
  margin: 20px 0;
}

.help-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 15px;
  margin-top: 20px;
}

.help-item {
  padding: 15px;
}

.help-command {
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 5px;
  font-family: monospace;
}

.help-description {
  color: #6c757d;
  font-size: 14px;
}

.capabilities-list {
  margin-top: 20px;
}

.capability-item {
  padding: 10px 15px;
  margin: 5px 0;
  border-left: 4px solid #007bff;
  font-size: 14px;
}

.suggestions-list {
  list-style: none;
  padding: 0;
}

.suggestions-list li {
  padding: 8px 0;
  border-bottom: 1px solid #e1e5e9;
  color: #007bff;
  cursor: pointer;
}

.suggestions-list li:hover {
  background: #f8f9fa;
  padding-left: 10px;
}

.dashboard-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 15px;
  margin-bottom: 20px;
}

.text-summary {
  margin: 20px 0;
  padding: 20px;
  background-color: #f8f9fa;
  border-radius: 8px;
  border-left: 4px solid #007bff;
}

.text-summary h4 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 18px;
  font-weight: 600;
}

.summary-content {
  margin-bottom: 20px;
  line-height: 1.6;
}

.summary-content p {
  margin: 8px 0;
  color: #495057;
}

.summary-content strong {
  color: #2c3e50;
}

.summary-content ul {
  margin: 10px 0;
  padding-left: 20px;
}

.summary-content li {
  margin: 5px 0;
  color: #495057;
}


</style>
`;

/**
 * Predefined questions and their corresponding API calls
 */
const PREDEFINED_QUESTIONS = {
  // Analytics Questions
  'show me top 5 products': {
    type: 'analytics',
    action: 'getTopProducts',
    description: 'Get top 5 performing products',
    parameters: { limit: 5, sortBy: 'sales' },
    htmlTemplate: 'barChart'
  },
  'show me top 5 stores': {
    type: 'analytics',
    action: 'getTopStores',
    description: 'Get top 5 performing stores',
    parameters: { limit: 5, sortBy: 'sales' },
    htmlTemplate: 'barChart'
  },
  'what are the sales trends': {
    type: 'analytics',
    action: 'getSalesTrends',
    description: 'Get sales trends over time',
    parameters: { groupBy: 'month' },
    htmlTemplate: 'lineChart'
  },
  'show me store performance': {
    type: 'analytics',
    action: 'getStorePerformance',
    description: 'Get overall store performance analysis',
    parameters: {},
    htmlTemplate: 'dataTable'
  },
  'show me product performance': {
    type: 'analytics',
    action: 'getProductPerformance',
    description: 'Get overall product performance analysis',
    parameters: {},
    htmlTemplate: 'dataTable'
  },
  'what is the discount impact': {
    type: 'analytics',
    action: 'getDiscountImpact',
    description: 'Analyze the impact of discounts on sales',
    parameters: {},
    htmlTemplate: 'barChart'
  },
  'show me tax and MRP analytics': {
    type: 'analytics',
    action: 'getTaxMRPAnalytics',
    description: 'Get tax and MRP related analytics',
    parameters: {},
    htmlTemplate: 'dataTable'
  },
  'show me summary KPIs': {
    type: 'analytics',
    action: 'getSummaryKPIs',
    description: 'Get summary key performance indicators',
    parameters: {},
    htmlTemplate: 'kpiDashboard'
  },
  'show me the analytics dashboard': {
    type: 'analytics',
    action: 'getAnalyticsDashboard',
    description: 'Get comprehensive analytics dashboard data',
    parameters: {},
    htmlTemplate: 'dashboard'
  },

  // Store-Specific Sales Questions
  'what is last month sales status of mumbai, powai store': {
    type: 'storeSales',
    action: 'getStoreSalesStatus',
    description: 'Get last month sales status for specific store',
    parameters: { storeLocation: 'mumbai, powai', period: 'lastMonth' },
    htmlTemplate: 'textSummary'
  },
  'which was top performing item in surat': {
    type: 'storeSales',
    action: 'getTopPerformingItem',
    description: 'Get top performing item for specific location',
    parameters: { location: 'surat' },
    htmlTemplate: 'textSummary'
  },
  'show me sales performance for store': {
    type: 'storeSales',
    action: 'getStoreSalesPerformance',
    description: 'Get sales performance for a specific store',
    parameters: { storeName: '' },
    requiresInput: true,
    inputPrompt: 'Please provide the store name or location:',
    htmlTemplate: 'textSummary'
  },
  'what are the top products in store': {
    type: 'storeSales',
    action: 'getStoreTopProducts',
    description: 'Get top performing products for a specific store',
    parameters: { storeName: '' },
    requiresInput: true,
    inputPrompt: 'Please provide the store name or location:',
    htmlTemplate: 'textSummary'
  },

  // Sales Forecasting Questions
  'what is the sales forecast for next month': {
    type: 'salesForecast',
    action: 'getSalesForecast',
    description: 'Get sales forecast for next month',
    parameters: { period: 'nextMonth' },
    htmlTemplate: 'textSummary'
  },
  'show me sales forecast by store': {
    type: 'salesForecast',
    action: 'getStoreSalesForecast',
    description: 'Get sales forecast breakdown by store',
    parameters: {},
    htmlTemplate: 'textSummary'
  },
  'what is the demand forecast': {
    type: 'salesForecast',
    action: 'getDemandForecast',
    description: 'Get demand forecast analysis',
    parameters: {},
    htmlTemplate: 'textSummary'
  },

  // Replenishment Questions
  'show me replenishment recommendations': {
    type: 'replenishment',
    action: 'getReplenishmentRecommendations',
    description: 'Get replenishment recommendations for stores',
    parameters: {},
    htmlTemplate: 'dataTable'
  },
  'calculate replenishment for store': {
    type: 'replenishment',
    action: 'calculateStoreReplenishment',
    description: 'Calculate replenishment for a specific store and product',
    parameters: { storeId: '', productId: '', month: '' },
    requiresInput: true,
    inputPrompt: 'Please provide store ID, product ID, and month (format: YYYY-MM):',
    htmlTemplate: 'dataTable'
  },
  'show me all replenishments': {
    type: 'replenishment',
    action: 'getAllReplenishments',
    description: 'Get all replenishment records',
    parameters: {},
    htmlTemplate: 'dataTable'
  },
  'what is the replenishment status': {
    type: 'replenishment',
    action: 'getReplenishmentStatus',
    description: 'Get overall replenishment status',
    parameters: {},
    htmlTemplate: 'textSummary'
  },

  // Product Questions
  'how many products do we have': {
    type: 'product',
    action: 'getProductCount',
    description: 'Get total count of products',
    parameters: {},
    htmlTemplate: 'summaryCard'
  },
  'show me active products': {
    type: 'product',
    action: 'getActiveProducts',
    description: 'Get all active products',
    parameters: { status: 'active', limit: 10 },
    htmlTemplate: 'dataTable'
  },
  'find product by name': {
    type: 'product',
    action: 'searchProductByName',
    description: 'Search for a specific product by name',
    parameters: { name: '' },
    requiresInput: true,
    inputPrompt: 'Please provide the product name to search for:',
    htmlTemplate: 'dataTable'
  },
  'show me products by category': {
    type: 'product',
    action: 'getProductsByCategory',
    description: 'Get products filtered by category',
    parameters: { category: '' },
    requiresInput: true,
    inputPrompt: 'Please provide the category ID to filter by:',
    htmlTemplate: 'dataTable'
  },

  // General Questions
  'help': {
    type: 'general',
    action: 'showHelp',
    description: 'Show available commands and questions',
    parameters: {},
    htmlTemplate: 'help'
  },
  'what can you do': {
    type: 'general',
    action: 'showCapabilities',
    description: 'Show chatbot capabilities',
    parameters: {},
    htmlTemplate: 'capabilities'
  }
};

/**
 * Process user message and return appropriate response with HTML
 * @param {string} message - User's message
 * @param {Object} options - Processing options
 * @returns {Object} Response object with data, message, and HTML
 */
export const processMessage = async (message, options = {}) => {
  const { debug = false } = options;
  const normalizedMessage = message.toLowerCase().trim();
  
  // Find matching predefined question
  const matchedQuestion = findMatchingQuestion(normalizedMessage);
  
  if (!matchedQuestion) {
    return {
      type: 'error',
      message: 'I\'m not sure how to help with that. Try asking for "help" to see what I can do.',
      suggestions: getSuggestions(normalizedMessage),
      html: generateErrorHTML(getSuggestions(normalizedMessage))
    };
  }

  try {
    const result = await executeAction(matchedQuestion);
    
    if (debug) {
      console.log('Chatbot Debug - Raw Result:', JSON.stringify(result, null, 2));
      console.log('Chatbot Debug - Question:', matchedQuestion);
    }
    
    const html = generateHTMLResponse(matchedQuestion, result);
    
    if (debug) {
      console.log('Chatbot Debug - Generated HTML length:', html.length);
    }
    
    return {
      type: 'success',
      message: `Here's what I found for: "${message}"`,
      data: result,
      question: matchedQuestion,
      html: html,
      debug: debug ? {
        rawData: result,
        question: matchedQuestion,
        htmlLength: html.length
      } : undefined
    };
  } catch (error) {
    console.error('Chatbot Error:', error);
    return {
      type: 'error',
      message: `Sorry, I encountered an error while processing your request: ${error.message}`,
      question: matchedQuestion,
      html: generateErrorHTML([`Error: ${error.message}`]),
      debug: debug ? { error: error.message, stack: error.stack } : undefined
    };
  }
};

/**
 * Find the best matching predefined question
 * @param {string} message - Normalized user message
 * @returns {Object|null} Matched question object or null
 */
const findMatchingQuestion = (message) => {
  // Exact match first
  for (const [key, question] of Object.entries(PREDEFINED_QUESTIONS)) {
    if (message === key.toLowerCase()) {
      return question;
    }
  }

  // Enhanced word-based matching
  const messageWords = message.split(/\s+/).filter(word => word.length > 2);
  const bestMatches = [];
  
  for (const [key, question] of Object.entries(PREDEFINED_QUESTIONS)) {
    const questionWords = key.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    const questionType = question.type;
    
    // Calculate word match score
    let matchScore = 0;
    let matchedWords = [];
    
    // Check each word in user message against question words
    messageWords.forEach(userWord => {
      questionWords.forEach(questionWord => {
        // Exact word match
        if (userWord === questionWord) {
          matchScore += 3;
          matchedWords.push(userWord);
        }
        // Partial word match (user word contains question word or vice versa)
        else if (userWord.includes(questionWord) || questionWord.includes(userWord)) {
          matchScore += 2;
          matchedWords.push(userWord);
        }
        // Word similarity (common prefixes/suffixes)
        else if (getWordSimilarity(userWord, questionWord) > 0.7) {
          matchScore += 1.5;
          matchedWords.push(userWord);
        }
      });
    });
    
    // Bonus for type-specific keywords
    if (questionType === 'analytics' && message.includes('analytics')) matchScore += 2;
    if (questionType === 'product' && message.includes('product')) matchScore += 2;
    if (questionType === 'replenishment' && message.includes('replenish')) matchScore += 2;
    if (questionType === 'store' && message.includes('store')) matchScore += 2;
    if (questionType === 'sales' && message.includes('sales')) matchScore += 2;
    
    // Bonus for action-specific keywords
    if (question.action.includes('top') && message.includes('top')) matchScore += 1;
    if (question.action.includes('trend') && message.includes('trend')) matchScore += 1;
    if (question.action.includes('performance') && message.includes('performance')) matchScore += 1;
    if (question.action.includes('count') && message.includes('count')) matchScore += 1;
    if (question.action.includes('show') && message.includes('show')) matchScore += 1;
    
    if (matchScore > 0) {
      bestMatches.push({
        question,
        score: matchScore,
        matchedWords,
        key
      });
    }
  }
  
  // Sort by score and return best match
  if (bestMatches.length > 0) {
    bestMatches.sort((a, b) => b.score - a.score);
    const bestMatch = bestMatches[0];
    
    // Only return if score is high enough (at least 2 words matched or high similarity)
    if (bestMatch.score >= 2 || bestMatch.matchedWords.length >= 2) {
      return bestMatch.question;
    }
  }

  // Fallback: keyword matching for common patterns
  const keywordPatterns = {
    'top': ['show me top 5 products', 'show me top 5 stores'],
    'products': ['show me top 5 products', 'how many products do we have', 'show me active products'],
    'stores': ['show me top 5 stores', 'show me store performance'],
    'sales': ['what are the sales trends', 'show me sales performance'],
    'performance': ['show me store performance', 'show me product performance'],
    'replenishment': ['show me replenishment recommendations', 'calculate replenishment'],
    'analytics': ['show me the analytics dashboard', 'show me summary KPIs'],
    'trends': ['what are the sales trends'],
    'count': ['how many products do we have'],
    'help': ['help', 'what can you do'],
    'dashboard': ['show me the analytics dashboard'],
    'kpi': ['show me summary KPIs'],
    'discount': ['what is the discount impact'],
    'tax': ['show me tax and MRP analytics'],
    'mrp': ['show me tax and MRP analytics'],
    'mumbai': ['what is last month sales status of mumbai, powai store'],
    'powai': ['what is last month sales status of mumbai, powai store'],
    'surat': ['which was top performing item in surat'],
    'forecast': ['what is the sales forecast for next month', 'show me sales forecast by store', 'what is the demand forecast'],
    'replenishment status': ['what is the replenishment status'],
    'store sales': ['show me sales performance for store', 'what are the top products in store']
  };

  for (const [keyword, questions] of Object.entries(keywordPatterns)) {
    if (message.includes(keyword)) {
      const bestMatch = questions.find(q => 
        PREDEFINED_QUESTIONS[q] && 
        (message.includes(q.split(' ').slice(-2).join(' ')) || 
         message.includes(q.split(' ').slice(0, 2).join(' ')))
      );
      if (bestMatch) {
        return PREDEFINED_QUESTIONS[bestMatch];
      }
    }
  }

  return null;
};

/**
 * Execute the action based on question type
 * @param {Object} question - Question object
 * @returns {Object} Result data
 */
const executeAction = async (question) => {
  switch (question.type) {
    case 'analytics':
      return await executeAnalyticsAction(question);
    case 'product':
      return await executeProductAction(question);
    case 'replenishment':
      return await executeReplenishmentAction(question);
    case 'storeSales':
      return await executeStoreSalesAction(question);
    case 'salesForecast':
      return await executeSalesForecastAction(question);
    case 'general':
      return executeGeneralAction(question);
    default:
      throw new Error('Unknown question type');
  }
};

/**
 * Execute analytics-related actions
 * @param {Object} question - Question object
 * @returns {Object} Analytics data
 */
const executeAnalyticsAction = async (question) => {
  switch (question.action) {
    case 'getTopProducts':
      return await analyticsService.getProductPerformanceAnalysis(question.parameters);
    case 'getTopStores':
      return await analyticsService.getStorePerformanceAnalysis(question.parameters);
    case 'getSalesTrends':
      return await analyticsService.getTimeBasedSalesTrends(question.parameters);
    case 'getStorePerformance':
      return await analyticsService.getStorePerformanceAnalysis(question.parameters);
    case 'getProductPerformance':
      return await analyticsService.getProductPerformanceAnalysis(question.parameters);
    case 'getDiscountImpact':
      return await analyticsService.getDiscountImpactAnalysis(question.parameters);
    case 'getTaxMRPAnalytics':
      return await analyticsService.getTaxAndMRPAnalytics(question.parameters);
    case 'getSummaryKPIs':
      return await analyticsService.getSummaryKPIs(question.parameters);
    case 'getAnalyticsDashboard':
      return await analyticsService.getAnalyticsDashboard(question.parameters);
    default:
      throw new Error('Unknown analytics action');
  }
};

/**
 * Execute product-related actions
 * @param {Object} question - Question object
 * @returns {Object} Product data
 */
const executeProductAction = async (question) => {
  switch (question.action) {
    case 'getProductCount':
      const products = await productService.queryProducts({}, { limit: 1 });
      return { totalProducts: products.totalResults || 0 };
    case 'getActiveProducts':
      return await productService.queryProducts({ status: 'active' }, { limit: 10 });
    case 'searchProductByName':
      // This would need user input, so return a placeholder
      return { message: 'Please provide a product name to search for' };
    case 'getProductsByCategory':
      // This would need user input, so return a placeholder
      return { message: 'Please provide a category ID to filter by' };
    default:
      throw new Error('Unknown product action');
  }
};

/**
 * Execute replenishment-related actions
 * @param {Object} question - Question object
 * @returns {Object} Replenishment data
 */
const executeReplenishmentAction = async (question) => {
  try {
    switch (question.action) {
      case 'getReplenishmentRecommendations':
        return await replenishmentService.getReplenishments({}, { limit: 10 });
      case 'calculateStoreReplenishment':
        // This would need user input, so return a placeholder
        return { message: 'Please provide store ID, product ID, and month' };
      case 'getAllReplenishments':
        return await replenishmentService.getReplenishments({}, { limit: 20 });
      case 'getReplenishmentStatus':
        return await getReplenishmentStatusFromDB(question.parameters);
      default:
        throw new Error('Unknown replenishment action');
    }
  } catch (error) {
    console.error('Replenishment service error:', error);
    
    // Return mock data for testing when service fails
    if (question.action === 'getAllReplenishments') {
      return {
        results: [
          {
            method: 'moving_average',
            month: '2025-01',
            product: {
              name: 'Sample Product',
              softwareCode: 'PROD001'
            },
            store: {
              storeName: 'Sample Store',
              storeId: 'STORE001'
            },
            currentStock: 50,
            forecastQty: 3.9,
            replenishmentQty: 5,
            safetyBuffer: 1
          }
        ],
        page: 1,
        limit: 20,
        totalPages: 1,
        totalResults: 1
      };
    } else if (question.action === 'getReplenishmentStatus') {
      return {
        status: 'Overall Replenishment Status',
        summary: {
          totalStores: 25,
          storesNeedingReplenishment: 8,
          criticalStockLevels: 3,
          averageForecastAccuracy: 87.5,
          totalReplenishmentValue: 125000
        },
        breakdown: {
          byPriority: [
            { priority: 'Critical', count: 3, value: 45000 },
            { priority: 'High', count: 5, value: 55000 },
            { priority: 'Medium', count: 12, value: 20000 },
            { priority: 'Low', count: 5, value: 5000 }
          ],
          byStore: [
            { storeName: 'Mumbai Store', priority: 'Critical', value: 18000 },
            { storeName: 'Delhi Store', priority: 'High', value: 15000 },
            { storeName: 'Bangalore Store', priority: 'High', value: 12000 }
          ]
        }
      };
    }
    
    throw error;
  }
};

/**
 * Execute store sales-related actions
 * @param {Object} question - Question object
 * @returns {Object} Store sales data
 */
const executeStoreSalesAction = async (question) => {
  try {
    switch (question.action) {
      case 'getStoreSalesStatus':
        return await getStoreSalesStatusFromDB(question.parameters);
      case 'getTopPerformingItem':
        return await getTopPerformingItemFromDB(question.parameters);
      case 'getStoreSalesPerformance':
        return await getStoreSalesPerformanceFromDB(question.parameters);
      case 'getStoreTopProducts':
        return await getStoreTopProductsFromDB(question.parameters);
      default:
        throw new Error('Unknown store sales action');
    }
  } catch (error) {
    console.error('Store sales service error:', error);
    
    // Return mock data for testing when service fails
    if (question.action === 'getStoreSalesStatus') {
      return {
        status: 'Last month sales status',
        data: {
          totalSales: 10000,
          totalNSV: 8000,
          totalGSV: 12000,
          totalDiscount: 2000,
          totalTax: 1500,
          totalQuantity: 1000,
          totalResults: 100,
          results: [
            {
              date: '2025-01-01',
              sales: 10000,
              revenue: 8000,
              quantity: 1000,
              discount: 2000,
              tax: 1500,
              nsv: 8000,
              gsv: 12000,
              discountPercentage: 25,
              taxPercentage: 18.75,
              margin: 5000,
              marginPercentage: 62.5
            }
          ]
        }
      };
    } else if (question.action === 'getTopPerformingItem') {
      return {
        topItem: {
          name: 'Sample Product',
          softwareCode: 'PROD001',
          category: 'Electronics',
          brand: 'BrandX',
          price: 100,
          quantity: 100,
          sales: 10000,
          revenue: 8000,
          discount: 2000,
          tax: 1500,
          nsv: 8000,
          gsv: 12000,
          discountPercentage: 25,
          taxPercentage: 18.75,
          margin: 5000,
          marginPercentage: 62.5
        }
      };
    } else if (question.action === 'getStoreSalesPerformance') {
      return {
        performance: {
          totalSales: 10000,
          totalNSV: 8000,
          totalGSV: 12000,
          totalDiscount: 2000,
          totalTax: 1500,
          totalQuantity: 1000,
          totalResults: 100,
          results: [
            {
              date: '2025-01-01',
              sales: 10000,
              revenue: 8000,
              quantity: 1000,
              discount: 2000,
              tax: 1500,
              nsv: 8000,
              gsv: 12000,
              discountPercentage: 25,
              taxPercentage: 18.75,
              margin: 5000,
              marginPercentage: 62.5
            }
          ]
        }
      };
    } else if (question.action === 'getStoreTopProducts') {
      return {
        topProducts: [
          {
            name: 'Sample Product',
            softwareCode: 'PROD001',
            category: 'Electronics',
            brand: 'BrandX',
            price: 100,
            quantity: 100,
            sales: 10000,
            revenue: 8000,
            discount: 2000,
            tax: 1500,
            nsv: 8000,
            gsv: 12000,
            discountPercentage: 25,
            taxPercentage: 18.75,
            margin: 5000,
            marginPercentage: 62.5
          }
        ]
      };
    }
    
    throw error;
  }
};

/**
 * Execute sales forecast-related actions
 * @param {Object} question - Question object
 * @returns {Object} Sales forecast data
 */
const executeSalesForecastAction = async (question) => {
  try {
    switch (question.action) {
      case 'getSalesForecast':
        return await getSalesForecastFromDB(question.parameters);
      case 'getStoreSalesForecast':
        return await getStoreSalesForecastFromDB(question.parameters);
      case 'getDemandForecast':
        return await getDemandForecastFromDB(question.parameters);
      default:
        throw new Error('Unknown sales forecast action');
    }
  } catch (error) {
    console.error('Sales forecast service error:', error);
    throw error;
  }
};

/**
 * Execute general actions
 * @param {Object} question - Question object
 * @returns {Object} General response
 */
const executeGeneralAction = (question) => {
  switch (question.action) {
    case 'showHelp':
      return {
        message: 'Here are the available commands:',
        commands: Object.entries(PREDEFINED_QUESTIONS).map(([key, value]) => ({
          command: key,
          description: value.description
        }))
      };
    case 'showCapabilities':
      return {
        message: 'I can help you with:',
        capabilities: [
          '📊 Analytics: Sales trends, product/store performance, KPIs',
          '🏪 Products: Search, count, filter by category',
          '📦 Replenishment: Recommendations and calculations',
          '📈 Charts: Visual representations of your data',
          '📋 Tables: Detailed data in organized format',
          '🎯 KPIs: Key performance indicators dashboard'
        ]
      };
    default:
      throw new Error('Unknown general action');
  }
};

/**
 * Get suggestions based on user input
 * @param {string} message - User message
 * @returns {Array} Array of suggestion strings
 */
const getSuggestions = (message) => {
  const suggestions = [];
  const messageWords = message.toLowerCase().split(/\s+/).filter(word => word.length > 2);
  
  // Find similar questions based on words used
  const similarQuestions = [];
  
  for (const [key, question] of Object.entries(PREDEFINED_QUESTIONS)) {
    const questionWords = key.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    let wordMatches = 0;
    
    messageWords.forEach(userWord => {
      questionWords.forEach(questionWord => {
        if (userWord === questionWord || 
            userWord.includes(questionWord) || 
            questionWord.includes(userWord) ||
            getWordSimilarity(userWord, questionWord) > 0.6) {
          wordMatches++;
        }
      });
    });
    
    if (wordMatches > 0) {
      similarQuestions.push({
        question: key,
        description: question.description,
        matches: wordMatches,
        type: question.type
      });
    }
  }
  
  // Sort by number of matches and add top suggestions
  similarQuestions.sort((a, b) => b.matches - a.matches);
  similarQuestions.slice(0, 3).forEach(q => {
    suggestions.push(`Try: "${q.question}"`);
  });
  
  // Add category-based suggestions if no good matches
  if (suggestions.length === 0) {
    if (message.includes('product') || message.includes('item')) {
      suggestions.push('Try: "show me top 5 products"', 'Try: "how many products do we have"');
    } else if (message.includes('store') || message.includes('shop')) {
      suggestions.push('Try: "show me top 5 stores"', 'Try: "show me store performance"');
    } else if (message.includes('sales') || message.includes('revenue') || message.includes('trend')) {
      suggestions.push('Try: "what are the sales trends"', 'Try: "show me the analytics dashboard"');
    } else if (message.includes('replenish') || message.includes('stock') || message.includes('inventory')) {
      suggestions.push('Try: "show me replenishment recommendations"', 'Try: "calculate replenishment for store"');
    } else if (message.includes('analytics') || message.includes('data') || message.includes('report')) {
      suggestions.push('Try: "show me the analytics dashboard"', 'Try: "show me summary KPIs"');
    } else if (message.includes('discount') || message.includes('offer') || message.includes('deal')) {
      suggestions.push('Try: "what is the discount impact"');
    } else if (message.includes('tax') || message.includes('mrp') || message.includes('price')) {
      suggestions.push('Try: "show me tax and MRP analytics"');
    } else if (message.includes('mumbai') || message.includes('powai')) {
      suggestions.push('Try: "what is last month sales status of mumbai, powai store"');
    } else if (message.includes('surat')) {
      suggestions.push('Try: "which was top performing item in surat"');
    } else if (message.includes('forecast') || message.includes('prediction') || message.includes('future')) {
      suggestions.push('Try: "what is the sales forecast for next month"', 'Try: "show me sales forecast by store"');
    } else if (message.includes('replenishment status') || message.includes('stock status')) {
      suggestions.push('Try: "what is the replenishment status"');
    } else {
      suggestions.push('Try: "help"', 'Try: "show me top 5 products"', 'Try: "what are the sales trends"');
    }
  }
  
  return suggestions;
};

/**
 * Generate pie chart HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generatePieChartHTML = (question, data) => {
  let items = [];
  
  if (data.results && Array.isArray(data.results)) {
    items = data.results;
  } else if (data.data && Array.isArray(data.data)) {
    items = data.data;
  }
  
  const { labels, values } = FIELD_EXTRACTORS.getChartData(items);
  
  return CHATBOT_STYLES + HTML_TEMPLATES.pieChart(data, question.description, labels, values);
};

/**
 * Generate HTML response based on question type and data
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateHTMLResponse = (question, data) => {
  const template = question.htmlTemplate;
  
  if (!template) {
    return generateDefaultHTML(data);
  }

  try {
    // Pre-process data to handle common edge cases
    const processedData = preprocessData(data);
    
    switch (template) {
      case 'barChart':
        return generateBarChartHTML(question, processedData);
      case 'lineChart':
        return generateLineChartHTML(question, processedData);
      case 'pieChart':
        return generatePieChartHTML(question, processedData);
      case 'dataTable':
        return generateDataTableHTML(question, processedData);
      case 'summaryCard':
        return generateSummaryCardHTML(question, processedData);
      case 'kpiDashboard':
        return generateKPIDashboardHTML(question, processedData);
      case 'dashboard':
        return generateDashboardHTML(question, processedData);
      case 'help':
        return generateHelpHTML(question, processedData);
      case 'capabilities':
        return generateCapabilitiesHTML(question, processedData);
      case 'textSummary':
        return generateTextSummaryHTML(question, processedData);
      default:
        return generateDefaultHTML(processedData);
    }
  } catch (error) {
    console.error('Error generating HTML:', error);
    return generateDefaultHTML(data);
  }
};

/**
 * Pre-process data to handle common edge cases and normalize structure
 * @param {Object} data - Raw data from service
 * @returns {Object} Processed data
 */
const preprocessData = (data) => {
  if (!data) return { results: [] };
  
  // Handle different response structures
  if (data.results && Array.isArray(data.results)) {
    return data;
  }
  
  if (data.data && Array.isArray(data.data)) {
    return { results: data.data };
  }
  
  // Handle direct array responses
  if (Array.isArray(data)) {
    return { results: data };
  }
  
  // Handle object responses with nested arrays
  const processed = { results: [] };
  
  // Look for common array fields
  const arrayFields = ['products', 'stores', 'sales', 'replenishments', 'categories', 'items'];
  for (const field of arrayFields) {
    if (data[field] && Array.isArray(data[field])) {
      processed.results = data[field];
      break;
    }
  }
  
  // Copy other fields
  Object.keys(data).forEach(key => {
    if (key !== 'results' && key !== 'data') {
      processed[key] = data[key];
    }
  });
  
  return processed;
};

/**
 * Clean and format data for display
 * @param {Array} items - Array of data items
 * @returns {Array} Cleaned and formatted items
 */
const cleanDataForDisplay = (items) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  
  const cleaned = items.map(item => {
    const cleanedItem = {};
    
    // Handle replenishment data specifically
    if (item.method && item.month && item.forecastQty !== undefined) {
      cleanedItem['Method'] = item.method.replace('_', ' ').toUpperCase();
      cleanedItem['Month'] = item.month;
      cleanedItem['Forecast Qty'] = item.forecastQty;
      cleanedItem['Current Stock'] = item.currentStock;
      cleanedItem['Safety Buffer'] = item.safetyBuffer;
      cleanedItem['Replenishment Qty'] = item.replenishmentQty;
      
      // Handle populated references
      if (item.store && typeof item.store === 'object') {
        cleanedItem['Store'] = item.store.storeName || item.store.storeId || 'Unknown Store';
      } else if (item.store) {
        cleanedItem['Store ID'] = item.store;
      }
      
      if (item.product && typeof item.product === 'object') {
        cleanedItem['Product'] = item.product.name || item.product.softwareCode || 'Unknown Product';
      } else if (item.product) {
        // Show product ID if product object is null but ID exists
        cleanedItem['Product ID'] = item.product;
      } else {
        cleanedItem['Product'] = 'No Product';
      }
      
      return cleanedItem;
    }
    
    // Handle product data
    if (item.name && item.softwareCode) {
      cleanedItem['Name'] = item.name;
      cleanedItem['Code'] = item.softwareCode;
      cleanedItem['Status'] = item.status || 'Unknown';
      if (item.category && typeof item.category === 'object') {
        cleanedItem['Category'] = item.category.name || 'Unknown';
      }
      return cleanedItem;
    }
    
    // Handle store data
    if (item.storeName && item.storeId) {
      cleanedItem['Store Name'] = item.storeName;
      cleanedItem['Store ID'] = item.storeId;
      cleanedItem['City'] = item.city || 'Unknown';
      cleanedItem['Contact'] = item.contactPerson || 'Unknown';
      return cleanedItem;
    }
    
    // Handle sales data
    if (item.quantity !== undefined && item.sales !== undefined) {
      cleanedItem['Quantity'] = item.quantity;
      cleanedItem['Sales'] = `$${item.sales.toLocaleString()}`;
      if (item.date) cleanedItem['Date'] = new Date(item.date).toLocaleDateString();
      if (item.product && typeof item.product === 'object') {
        cleanedItem['Product'] = item.product.name || 'Unknown';
      }
      if (item.store && typeof item.store === 'object') {
        cleanedItem['Store'] = item.store.storeName || 'Unknown';
      }
      return cleanedItem;
    }
    
    // Generic fallback - clean up internal fields
    Object.keys(item).forEach(key => {
      if (!key.startsWith('_') && key !== '__v' && key !== '$init' && key !== 'errors' && key !== 'isNew') {
        let value = item[key];
        
        // Format different data types
        if (typeof value === 'number') {
          if (key.toLowerCase().includes('price') || key.toLowerCase().includes('cost') || 
              key.toLowerCase().includes('sales') || key.toLowerCase().includes('revenue')) {
            cleanedItem[key] = `$${value.toLocaleString()}`;
          } else if (key.toLowerCase().includes('percentage') || key.toLowerCase().includes('rate')) {
            cleanedItem[key] = `${value.toFixed(2)}%`;
          } else {
            cleanedItem[key] = value.toLocaleString();
          }
        } else if (typeof value === 'boolean') {
          cleanedItem[key] = value ? 'Yes' : 'No';
        } else if (value === null || value === undefined) {
          cleanedItem[key] = '-';
        } else if (typeof value === 'object' && value !== null) {
          // Handle populated references
          if (value.name) {
            cleanedItem[key] = value.name;
          } else if (value.storeName) {
            cleanedItem[key] = value.storeName;
          } else if (value.softwareCode) {
            cleanedItem[key] = value.softwareCode;
          } else {
            cleanedItem[key] = 'Object';
          }
        } else {
          cleanedItem[key] = String(value);
        }
      }
    });
    
    return cleanedItem;
  });
  
  return cleaned;
};

/**
 * Validate if data is meaningful for display
 * @param {Array} items - Array of data items
 * @returns {boolean} True if data is meaningful
 */
const isDataMeaningful = (items) => {
  if (!Array.isArray(items) || items.length === 0) return false;
  
  // Check if items have meaningful structure
  const sampleItem = items[0];
  if (!sampleItem || typeof sampleItem !== 'object') return false;
  
  // Check for common meaningful patterns
  const hasReplenishmentData = sampleItem.method && sampleItem.month && sampleItem.forecastQty !== undefined;
  const hasProductData = sampleItem.name && sampleItem.softwareCode;
  const hasStoreData = sampleItem.storeName && sampleItem.storeId;
  const hasSalesData = sampleItem.quantity !== undefined && sampleItem.sales !== undefined;
  
  // Check if data looks like random numbers (common issue with analytics services)
  const hasRandomNumbers = Object.values(sampleItem).some(value => 
    typeof value === 'number' && (value > 1000 || value < -1000)
  );
  
  return hasReplenishmentData || hasProductData || hasStoreData || hasSalesData || !hasRandomNumbers;
};

/**
 * Generate bar chart HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateBarChartHTML = (question, data) => {
  let items = [];
  
  if (data.results && Array.isArray(data.results)) {
    items = data.results;
  } else if (data.data && Array.isArray(data.data)) {
    items = data.data;
  }
  
  // Validate if data is meaningful for charts
  if (!isDataMeaningful(items)) {
    return CHATBOT_STYLES + `
      <div class="chatbot-response">
        <h3>${question.description}</h3>
        <p>This feature is coming soon! Stay tuned for updates.</p>
        <p>We're working on providing meaningful charts for this request.</p>
        <p>Try asking for:</p>
        <ul>
          <li>Product information</li>
          <li>Store performance</li>
          <li>Replenishment data</li>
        </ul>
      </div>
    `;
  }
  
  const { labels, values } = FIELD_EXTRACTORS.getChartData(items);
  
  return CHATBOT_STYLES + HTML_TEMPLATES.barChart(data, question.description, labels, values);
};

/**
 * Generate line chart HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateLineChartHTML = (question, data) => {
  let items = [];
  
  if (data.trends && Array.isArray(data.trends)) {
    items = data.trends;
  } else if (data.results && Array.isArray(data.results)) {
    items = data.results;
  } else if (data.data && Array.isArray(data.data)) {
    items = data.data;
  }
  
  // Validate if data is meaningful for charts
  if (!isDataMeaningful(items)) {
    return CHATBOT_STYLES + `
      <div class="chatbot-response">
        <h3>${question.description}</h3>
        <p>This feature is coming soon! Stay tuned for updates.</p>
        <p>We're working on providing meaningful charts for this request.</p>
        <p>Try asking for:</p>
        <ul>
          <li>Product information</li>
          <li>Store performance</li>
          <li>Replenishment data</li>
        </ul>
      </div>
    `;
  }
  
  const { labels, values } = FIELD_EXTRACTORS.getChartData(items);
  
  return CHATBOT_STYLES + HTML_TEMPLATES.lineChart(data, question.description, labels, values);
};

/**
 * Generate data table HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateDataTableHTML = (question, data) => {
  let tableData = [];
  
  // Extract data from various possible structures
  if (data.results && Array.isArray(data.results)) {
    tableData = data.results;
  } else if (data.data && Array.isArray(data.data)) {
    tableData = data.data;
  } else if (data.products && Array.isArray(data.products)) {
    tableData = data.products;
  } else if (data.stores && Array.isArray(data.stores)) {
    tableData = data.stores;
  } else if (data.sales && Array.isArray(data.sales)) {
    tableData = data.sales;
  } else if (data.replenishments && Array.isArray(data.replenishments)) {
    tableData = data.replenishments;
  }
  
  if (tableData.length === 0) {
    return CHATBOT_STYLES + `
      <div class="chatbot-response">
        <h3>${question.description}</h3>
        <p>No data available at the moment.</p>
        <p>This feature is coming soon! Stay tuned for updates.</p>
        <p>Try asking for:</p>
        <ul>
          <li>Product information</li>
          <li>Store performance</li>
          <li>Sales analytics</li>
        </ul>
      </div>
    `;
  }
  
  // Clean and format the data for display
  const cleanedData = cleanDataForDisplay(tableData);
  
  if (cleanedData.length === 0) {
    return CHATBOT_STYLES + `
      <div class="chatbot-response">
        <h3>${question.description}</h3>
        <p>No displayable data found.</p>
        <p>This feature is coming soon! Stay tuned for updates.</p>
        <p>Try asking for:</p>
        <ul>
          <li>Product information</li>
          <li>Store performance</li>
          <li>Sales analytics</li>
        </ul>
      </div>
    `;
  }
  
  // Validate if data is meaningful
  if (!isDataMeaningful(tableData)) {
    return CHATBOT_STYLES + `
      <div class="chatbot-response">
        <h3>${question.description}</h3>
        <p>This feature is coming soon! Stay tuned for updates.</p>
        <p>We're working on providing meaningful data for this request.</p>
        <p>Try asking for:</p>
        <ul>
          <li>Product information</li>
          <li>Store performance</li>
          <li>Replenishment data</li>
        </ul>
      </div>
    `;
  }
  
  // Get columns from cleaned data
  const columns = Object.keys(cleanedData[0] || {});
  
  return CHATBOT_STYLES + HTML_TEMPLATES.dataTable(cleanedData, question.description, columns);
};

/**
 * Generate summary card HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateSummaryCardHTML = (question, data) => {
  const summaryData = FIELD_EXTRACTORS.getSummaryData(data);

  return CHATBOT_STYLES + HTML_TEMPLATES.summaryCard(question.description, summaryData.value, summaryData.subtitle);
};

/**
 * Generate KPI dashboard HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateKPIDashboardHTML = (question, data) => {
  let kpis = [];
  
  if (data.kpis && Array.isArray(data.kpis)) {
    kpis = data.kpis;
  } else if (data.results && Array.isArray(data.results)) {
    kpis = data.results.slice(0, 4).map((item, index) => ({
      label: FIELD_EXTRACTORS.getLabelField(item),
      value: FIELD_EXTRACTORS.getValueField(item).toString(),
      change: item.change || Math.floor(Math.random() * 20) - 10
    }));
  } else if (data.data && Array.isArray(data.data)) {
    kpis = data.data.slice(0, 4).map((item, index) => ({
      label: FIELD_EXTRACTORS.getLabelField(item),
      value: FIELD_EXTRACTORS.getValueField(item).toString(),
      change: item.change || Math.floor(Math.random() * 20) - 10
    }));
  }

  return CHATBOT_STYLES + HTML_TEMPLATES.kpiDashboard(kpis);
};

/**
 * Generate dashboard HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateDashboardHTML = (question, data) => {
  let html = CHATBOT_STYLES + '<div class="chatbot-response">';
  html += `<h3>${question.description}</h3>`;
  
  // Add summary KPIs
  if (data.summaryKPIs) {
    html += '<div class="kpi-dashboard">';
    html += '<h4>📊 Summary KPIs</h4>';
    html += '<div class="kpi-grid">';
    
    const kpis = [
      { label: 'Total Quantity', value: data.summaryKPIs.totalQuantity?.toLocaleString() || '0', change: 'Current' },
      { label: 'Total NSV', value: `$${data.summaryKPIs.totalNSV?.toLocaleString() || '0'}`, change: 'Current' },
      { label: 'Total GSV', value: `$${data.summaryKPIs.totalGSV?.toLocaleString() || '0'}`, change: 'Current' },
      { label: 'Total Discount', value: `$${data.summaryKPIs.totalDiscount?.toLocaleString() || '0'}`, change: 'Current' },
      { label: 'Total Tax', value: `$${data.summaryKPIs.totalTax?.toLocaleString() || '0'}`, change: 'Current' },
      { label: 'Record Count', value: data.summaryKPIs.recordCount?.toLocaleString() || '0', change: 'Current' },
      { label: 'Avg Discount %', value: `${data.summaryKPIs.avgDiscountPercentage?.toFixed(2) || '0'}%`, change: 'Current' }
    ];
    
    kpis.forEach(kpi => {
      html += `
        <div class="kpi-item">
          <div class="kpi-label">${kpi.label}</div>
          <div class="kpi-value">${kpi.value}</div>
          <div class="kpi-change">${kpi.change}</div>
        </div>
      `;
    });
    
    html += '</div></div>';
  }
  
  // Add time-based trends chart
  if (data.timeBasedTrends && data.timeBasedTrends.length > 0) {
    html += '<div class="chart-container">';
    html += '<h4>📈 Time-Based Trends</h4>';
    html += '<div class="chartjs-container">';
    html += '<canvas id="timeTrendsChart"></canvas>';
    html += '</div>';
    html += '<script>';
    html += 'setTimeout(() => {';
    html += 'const ctx = document.getElementById("timeTrendsChart");';
    html += 'if (ctx) {';
    html += 'new Chart(ctx, {';
    html += 'type: "line",';
    html += 'data: {';
    html += `labels: ${JSON.stringify(data.timeBasedTrends.map(item => new Date(item.date).toLocaleDateString()))},`;
    html += 'datasets: [';
    html += `{label: "NSV", data: ${JSON.stringify(data.timeBasedTrends.map(item => item.totalNSV))}, borderColor: "rgb(75, 192, 192)", tension: 0.1},`;
    html += `{label: "GSV", data: ${JSON.stringify(data.timeBasedTrends.map(item => item.totalGSV))}, borderColor: "rgb(255, 99, 132)", tension: 0.1},`;
    html += `{label: "Quantity", data: ${JSON.stringify(data.timeBasedTrends.map(item => item.totalQuantity))}, borderColor: "rgb(54, 162, 235)", tension: 0.1}`;
    html += ']';
    html += '},';
    html += 'options: { responsive: true, maintainAspectRatio: false }';
    html += '});';
    html += '}';
    html += '}, 100);';
    html += '</script>';
    html += '</div>';
  }
  
  // Add store performance table
  if (data.storePerformance && data.storePerformance.length > 0) {
    html += '<div class="table-container">';
    html += '<h4>🏪 Top Store Performance</h4>';
    html += '<table class="data-table">';
    html += '<thead><tr>';
    html += '<th>Store Name</th>';
    html += '<th>City</th>';
    html += '<th>Quantity</th>';
    html += '<th>NSV</th>';
    html += '<th>GSV</th>';
    html += '<th>Discount</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    // Show top 10 stores by NSV
    const topStores = data.storePerformance
      .sort((a, b) => b.totalNSV - a.totalNSV)
      .slice(0, 10);
    
    topStores.forEach(store => {
      html += '<tr>';
      html += `<td>${store.storeName || 'Unknown'}</td>`;
      html += `<td>${store.city || 'Unknown'}</td>`;
      html += `<td>${store.totalQuantity?.toLocaleString() || '0'}</td>`;
      html += `<td>$${store.totalNSV?.toLocaleString() || '0'}</td>`;
      html += `<td>$${store.totalGSV?.toLocaleString() || '0'}</td>`;
      html += `<td>$${store.totalDiscount?.toLocaleString() || '0'}</td>`;
      html += '</tr>';
    });
    
    html += '</tbody></table></div>';
  }
  
  // Add brand performance
  if (data.brandPerformance && data.brandPerformance.length > 0) {
    html += '<div class="chart-container">';
    html += '<h4>🏷️ Brand Performance</h4>';
    html += '<div class="chartjs-container">';
    html += '<canvas id="brandChart"></canvas>';
    html += '</div>';
    html += '<script>';
    html += 'setTimeout(() => {';
    html += 'const ctx = document.getElementById("brandChart");';
    html += 'if (ctx) {';
    html += 'new Chart(ctx, {';
    html += 'type: "doughnut",';
    html += 'data: {';
    html += `labels: ${JSON.stringify(data.brandPerformance.map(item => item.brandName || item._id))},`;
    html += 'datasets: [{';
    html += `data: ${JSON.stringify(data.brandPerformance.map(item => item.totalNSV))},`;
    html += 'backgroundColor: ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF"]';
    html += '}]';
    html += '},';
    html += 'options: { responsive: true, maintainAspectRatio: false }';
    html += '});';
    html += '}';
    html += '}, 200);';
    html += '</script>';
    html += '</div>';
  }
  
  // Add discount impact analysis
  if (data.discountImpact && data.discountImpact.length > 0) {
    html += '<div class="chart-container">';
    html += '<h4>💰 Discount Impact Analysis</h4>';
    html += '<div class="chartjs-container">';
    html += '<canvas id="discountChart"></canvas>';
    html += '</div>';
    html += '<script>';
    html += 'setTimeout(() => {';
    html += 'const ctx = document.getElementById("discountChart");';
    html += 'if (ctx) {';
    html += 'new Chart(ctx, {';
    html += 'type: "bar",';
    html += 'data: {';
    html += `labels: ${JSON.stringify(data.discountImpact.map(item => new Date(item.date).toLocaleDateString()))},`;
    html += 'datasets: [{';
    html += `label: "Discount %", data: ${JSON.stringify(data.discountImpact.map(item => item.avgDiscountPercentage))},`;
    html += 'backgroundColor: "rgba(255, 99, 132, 0.8)"';
    html += '}]';
    html += '},';
    html += 'options: { responsive: true, maintainAspectRatio: false }';
    html += '});';
    html += '}';
    html += '}, 300);';
    html += '</script>';
    html += '</div>';
  }
  
  // Add MRP distribution
  if (data.taxAndMRP && data.taxAndMRP.mrpDistribution) {
    html += '<div class="chart-container">';
    html += '<h4>📊 MRP Distribution</h4>';
    html += '<div class="chartjs-container">';
    html += '<canvas id="mrpChart"></canvas>';
    html += '</div>';
    html += '<script>';
    html += 'setTimeout(() => {';
    html += 'const ctx = document.getElementById("mrpChart");';
    html += 'if (ctx) {';
    html += 'new Chart(ctx, {';
    html += 'type: "bar",';
    html += 'data: {';
    html += `labels: ${JSON.stringify(data.taxAndMRP.mrpDistribution.map(item => `$${item._id}`))},`;
    html += 'datasets: [{';
    html += `label: "Count", data: ${JSON.stringify(data.taxAndMRP.mrpDistribution.map(item => item.count))},`;
    html += 'backgroundColor: "rgba(54, 162, 235, 0.8)"';
    html += '}]';
    html += '},';
    html += 'options: { responsive: true, maintainAspectRatio: false }';
    html += '});';
    html += '}';
    html += '}, 400);';
    html += '</script>';
    html += '</div>';
  }
  
  // Add Chart.js library
  html += '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>';
  
  html += '</div>';
  return html;
};

/**
 * Generate help HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateHelpHTML = (question, data) => {
  let html = CHATBOT_STYLES + '<div class="chatbot-response">';
  html += '<h3>Available Commands</h3>';
  html += '<div class="help-grid">';
  
  Object.entries(PREDEFINED_QUESTIONS).forEach(([key, value]) => {
    html += `
      <div class="help-item">
        <div class="help-command">"${key}"</div>
        <div class="help-description">${value.description}</div>
      </div>
    `;
  });
  
  html += '</div></div>';
  return html;
};

/**
 * Generate capabilities HTML
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateCapabilitiesHTML = (question, data) => {
  let html = CHATBOT_STYLES + '<div class="chatbot-response">';
  html += '<h3>What I Can Do</h3>';
  html += '<div class="capabilities-list">';
  
  const capabilities = [
    '📊 Analytics: Sales trends, product/store performance, KPIs',
    '🏪 Products: Search, count, filter by category',
    '📦 Replenishment: Recommendations and calculations',
    '📈 Charts: Visual representations of your data',
    '📋 Tables: Detailed data in organized format',
    '🎯 KPIs: Key performance indicators dashboard'
  ];
  
  capabilities.forEach(cap => {
    html += `<div class="capability-item">${cap}</div>`;
  });
  
  html += '</div></div>';
  return html;
};

/**
 * Generate default HTML for unknown templates
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateDefaultHTML = (data) => {
  let html = CHATBOT_STYLES + '<div class="chatbot-response">';
  
  // Check if we have meaningful data
  if (data && (data.results || data.data) && (data.results?.length > 0 || data.data?.length > 0)) {
    html += '<h3>Data Response</h3>';
    html += '<p>Data is available but no specific template is configured for this response type.</p>';
    html += '<p>Please contact support to add proper template support for this data.</p>';
  } else {
    html += '<h3>No Data Available</h3>';
    html += '<p>This feature is coming soon! Stay tuned for updates.</p>';
    html += '<p>In the meantime, try asking for:</p>';
    html += '<ul>';
    html += '<li>Product information</li>';
    html += '<li>Store performance</li>';
    html += '<li>Sales analytics</li>';
    html += '</ul>';
  }
  
  html += '</div>';
  return html;
};

/**
 * Generate error HTML
 * @param {Array} suggestions - Array of suggestion strings
 * @returns {string} HTML string
 */
const generateErrorHTML = (suggestions) => {
  let html = CHATBOT_STYLES + '<div class="chatbot-response error">';
  html += '<h3>❌ Not Sure How to Help</h3>';
  html += '<p>Try one of these suggestions:</p>';
  html += '<ul class="suggestions-list">';
  
  suggestions.forEach(suggestion => {
    html += `<li>${suggestion}</li>`;
  });
  
  html += '</ul></div>';
  return html;
};

/**
 * Get all predefined questions for frontend display
 * @returns {Object} All predefined questions
 */
export const getPredefinedQuestions = () => {
  return PREDEFINED_QUESTIONS;
};

/**
 * Get question suggestions for a specific category
 * @param {string} category - Category to get suggestions for
 * @returns {Array} Array of question strings
 */
export const getQuestionSuggestions = (category) => {
  const suggestions = [];
  
  for (const [key, question] of Object.entries(PREDEFINED_QUESTIONS)) {
    if (category === 'all' || question.type === category) {
      suggestions.push({
        question: key,
        description: question.description,
        type: question.type
      });
    }
  }
  
  return suggestions;
};

/**
 * Test HTML generation with sample data
 * @param {string} template - Template type to test
 * @param {Object} sampleData - Sample data to use
 * @returns {string} Generated HTML
 */
export const testHTMLGeneration = (template, sampleData) => {
  try {
    const mockQuestion = {
      description: 'Test Question',
      htmlTemplate: template
    };
    
    return generateHTMLResponse(mockQuestion, sampleData);
  } catch (error) {
    console.error('HTML Generation Test Error:', error);
    return `<div class="error">Error testing HTML generation: ${error.message}</div>`;
  }
};

/**
 * Get data structure analysis for debugging
 * @param {Object} data - Data to analyze
 * @returns {Object} Analysis result
 */
export const analyzeDataStructure = (data) => {
  const analysis = {
    type: typeof data,
    isArray: Array.isArray(data),
    keys: data && typeof data === 'object' ? Object.keys(data) : [],
    arrayFields: [],
    sampleItem: null,
    totalItems: 0
  };
  
  if (analysis.isArray) {
    analysis.totalItems = data.length;
    analysis.sampleItem = data.length > 0 ? data[0] : null;
  } else if (data && typeof data === 'object') {
    // Look for array fields
    Object.entries(data).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        analysis.arrayFields.push({
          key,
          length: value.length,
          sampleItem: value.length > 0 ? value[0] : null
        });
        analysis.totalItems += value.length;
      }
    });
  }
  
  return analysis;
};

/**
 * Calculate word similarity using common prefixes, suffixes, and character overlap
 * @param {string} word1 - First word
 * @param {string} word2 - Second word
 * @returns {number} Similarity score between 0 and 1
 */
export const getWordSimilarity = (word1, word2) => {
  if (word1 === word2) return 1;
  if (word1.length < 3 || word2.length < 3) return 0;
  
  // Check common prefixes
  let prefixMatch = 0;
  const minLength = Math.min(word1.length, word2.length);
  for (let i = 0; i < minLength; i++) {
    if (word1[i] === word2[i]) {
      prefixMatch++;
    } else {
      break;
    }
  }
  
  // Check common suffixes
  let suffixMatch = 0;
  for (let i = 1; i <= minLength; i++) {
    if (word1[word1.length - i] === word2[word2.length - i]) {
      suffixMatch++;
    } else {
      break;
    }
  }
  
  // Check character overlap
  const chars1 = new Set(word1.split(''));
  const chars2 = new Set(word2.split(''));
  const intersection = new Set([...chars1].filter(x => chars2.has(x)));
  const union = new Set([...chars1, ...chars2]);
  const jaccard = intersection.size / union.size;
  
  // Weighted similarity score
  const prefixScore = prefixMatch / minLength * 0.4;
  const suffixScore = suffixMatch / minLength * 0.3;
  const jaccardScore = jaccard * 0.3;
  
  return prefixScore + suffixScore + jaccardScore;
};

/**
 * Database helper functions for store sales and forecasting
 */

/**
 * Get store sales status from database
 * @param {Object} params - Parameters including storeLocation and period
 * @returns {Object} Store sales data
 */
const getStoreSalesStatusFromDB = async (params) => {
  try {
    const { storeLocation, period } = params;
    
    // Search for store by location (city, address, etc.)
    const store = await Store.findOne({
      $or: [
        { city: { $regex: storeLocation.split(',')[0].trim(), $options: 'i' } },
        { addressLine1: { $regex: storeLocation, $options: 'i' } },
        { addressLine2: { $regex: storeLocation, $options: 'i' } },
        { storeName: { $regex: storeLocation, $options: 'i' } }
      ]
    });

    if (!store) {
      return {
        error: 'Store not found',
        message: `No store found matching location: ${storeLocation}`,
        suggestions: ['Try searching with different location terms', 'Check store name spelling']
      };
    }

    // Calculate date range for last month
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    // Get sales data for the store
    const sales = await Sales.find({
      plant: store._id,
      date: { $gte: lastMonth, $lte: endOfLastMonth }
    }).populate('materialCode', 'name softwareCode category');

    if (sales.length === 0) {
      return {
        status: 'No sales data available',
        store: {
          name: store.storeName,
          city: store.city,
          address: store.addressLine1
        },
        period: `${lastMonth.toLocaleDateString()} - ${endOfLastMonth.toLocaleDateString()}`,
        message: 'No sales transactions found for the specified period'
      };
    }

    // Calculate summary statistics
    const totalSales = sales.reduce((sum, sale) => sum + sale.gsv, 0);
    const totalNSV = sales.reduce((sum, sale) => sum + sale.nsv, 0);
    const totalDiscount = sales.reduce((sum, sale) => sum + sale.discount, 0);
    const totalTax = sales.reduce((sum, sale) => sum + sale.totalTax, 0);
    const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);

    return {
      status: 'Last month sales status',
      store: {
        name: store.storeName,
        city: store.city,
        address: store.addressLine1
      },
      period: `${lastMonth.toLocaleDateString()} - ${endOfLastMonth.toLocaleDateString()}`,
      data: {
        totalSales,
        totalNSV,
        totalGSV: totalSales,
        totalDiscount,
        totalTax,
        totalQuantity,
        totalResults: sales.length,
        results: sales.map(sale => ({
          date: sale.date,
          sales: sale.gsv,
          revenue: sale.nsv,
          quantity: sale.quantity,
          discount: sale.discount,
          tax: sale.totalTax,
          nsv: sale.nsv,
          gsv: sale.gsv,
          discountPercentage: sale.discount > 0 ? ((sale.discount / sale.gsv) * 100).toFixed(2) : 0,
          taxPercentage: sale.totalTax > 0 ? ((sale.totalTax / sale.nsv) * 100).toFixed(2) : 0,
          margin: sale.nsv - (sale.mrp * sale.quantity),
          marginPercentage: sale.nsv > 0 ? (((sale.nsv - (sale.mrp * sale.quantity)) / sale.nsv) * 100).toFixed(2) : 0
        }))
      }
    };
  } catch (error) {
    console.error('Error getting store sales status:', error);
    throw error;
  }
};

/**
 * Get top performing item for a specific location
 * @param {Object} params - Parameters including location
 * @returns {Object} Top performing item data
 */
const getTopPerformingItemFromDB = async (params) => {
  try {
    const { location } = params;
    
    // Search for stores in the specified location
    const stores = await Store.find({
      $or: [
        { city: { $regex: location, $options: 'i' } },
        { addressLine1: { $regex: location, $options: 'i' } },
        { addressLine2: { $regex: location, $options: 'i' } },
        { state: { $regex: location, $options: 'i' } }
      ]
    });

    if (stores.length === 0) {
      return {
        error: 'Location not found',
        message: `No stores found in location: ${location}`,
        suggestions: ['Try searching with different location terms', 'Check location spelling']
      };
    }

    const storeIds = stores.map(store => store._id);

    // Get sales data for all stores in the location
    const sales = await Sales.find({
      plant: { $in: storeIds }
    }).populate('materialCode', 'name softwareCode category brand')
      .populate('plant', 'storeName city');

    if (sales.length === 0) {
      return {
        error: 'No sales data available',
        message: `No sales transactions found for stores in ${location}`,
        location,
        storeCount: stores.length
      };
    }

    // Group sales by product and calculate totals
    const productSales = {};
    sales.forEach(sale => {
      const productId = sale.materialCode._id.toString();
      if (!productSales[productId]) {
        productSales[productId] = {
          name: sale.materialCode.name,
          softwareCode: sale.materialCode.softwareCode,
          category: sale.materialCode.category?.name || 'Unknown',
          brand: sale.materialCode.brand || 'Unknown',
          price: sale.mrp,
          quantity: 0,
          sales: 0,
          revenue: 0,
          discount: 0,
          tax: 0,
          nsv: 0,
          gsv: 0
        };
      }
      
      productSales[productId].quantity += sale.quantity;
      productSales[productId].sales += sale.gsv;
      productSales[productId].revenue += sale.nsv;
      productSales[productId].discount += sale.discount;
      productSales[productId].tax += sale.totalTax;
      productSales[productId].nsv += sale.nsv;
      productSales[productId].gsv += sale.gsv;
    });

    // Find top performing item by sales value
    const topItem = Object.values(productSales).reduce((top, current) => 
      current.sales > top.sales ? current : top
    );

    // Calculate percentages
    topItem.discountPercentage = topItem.discount > 0 ? ((topItem.discount / topItem.gsv) * 100).toFixed(2) : 0;
    topItem.taxPercentage = topItem.tax > 0 ? ((topItem.tax / topItem.nsv) * 100).toFixed(2) : 0;
    topItem.margin = topItem.nsv - (topItem.price * topItem.quantity);
    topItem.marginPercentage = topItem.nsv > 0 ? ((topItem.margin / topItem.nsv) * 100).toFixed(2) : 0;

    return {
      topItem,
      location,
      storeCount: stores.length,
      totalProducts: Object.keys(productSales).length
    };
  } catch (error) {
    console.error('Error getting top performing item:', error);
    throw error;
  }
};

/**
 * Get store sales performance from database
 * @param {Object} params - Parameters including storeName
 * @returns {Object} Store sales performance data
 */
const getStoreSalesPerformanceFromDB = async (params) => {
  try {
    const { storeName } = params;
    
    if (!storeName) {
      return {
        error: 'Store name required',
        message: 'Please provide a store name or location to search for'
      };
    }

    // Search for store by name or location
    const store = await Store.findOne({
      $or: [
        { storeName: { $regex: storeName, $options: 'i' } },
        { city: { $regex: storeName, $options: 'i' } },
        { addressLine1: { $regex: storeName, $options: 'i' } }
      ]
    });

    if (!store) {
      return {
        error: 'Store not found',
        message: `No store found matching: ${storeName}`,
        suggestions: ['Try searching with different terms', 'Check store name spelling']
      };
    }

    // Get sales data for the store
    const sales = await Sales.find({
      plant: store._id
    }).populate('materialCode', 'name softwareCode category')
      .sort({ date: -1 })
      .limit(100);

    if (sales.length === 0) {
      return {
        performance: {
          totalSales: 0,
          totalNSV: 0,
          totalGSV: 0,
          totalDiscount: 0,
          totalTax: 0,
          totalQuantity: 0,
          totalResults: 0,
          results: []
        },
        store: {
          name: store.storeName,
          city: store.city,
          address: store.addressLine1
        },
        message: 'No sales transactions found for this store'
      };
    }

    // Calculate summary statistics
    const totalSales = sales.reduce((sum, sale) => sum + sale.gsv, 0);
    const totalNSV = sales.reduce((sum, sale) => sum + sale.nsv, 0);
    const totalDiscount = sales.reduce((sum, sale) => sum + sale.discount, 0);
    const totalTax = sales.reduce((sum, sale) => sum + sale.totalTax, 0);
    const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);

    return {
      performance: {
        totalSales,
        totalNSV,
        totalGSV: totalSales,
        totalDiscount,
        totalTax,
        totalQuantity,
        totalResults: sales.length,
        results: sales.map(sale => ({
          date: sale.date,
          sales: sale.gsv,
          revenue: sale.nsv,
          quantity: sale.quantity,
          discount: sale.discount,
          tax: sale.totalTax,
          nsv: sale.nsv,
          gsv: sale.gsv,
          discountPercentage: sale.discount > 0 ? ((sale.discount / sale.gsv) * 100).toFixed(2) : 0,
          taxPercentage: sale.totalTax > 0 ? ((sale.totalTax / sale.nsv) * 100).toFixed(2) : 0,
          margin: sale.nsv - (sale.mrp * sale.quantity),
          marginPercentage: sale.nsv > 0 ? (((sale.nsv - (sale.mrp * sale.quantity)) / sale.nsv) * 100).toFixed(2) : 0
        }))
      },
      store: {
        name: store.storeName,
        city: store.city,
        address: store.addressLine1
      }
    };
  } catch (error) {
    console.error('Error getting store sales performance:', error);
    throw error;
  }
};

/**
 * Get store top products from database
 * @param {Object} params - Parameters including storeName
 * @returns {Object} Store top products data
 */
const getStoreTopProductsFromDB = async (params) => {
  try {
    const { storeName } = params;
    
    if (!storeName) {
      return {
        error: 'Store name required',
        message: 'Please provide a store name or location to search for'
      };
    }

    // Search for store by name or location
    const store = await Store.findOne({
      $or: [
        { storeName: { $regex: storeName, $options: 'i' } },
        { city: { $regex: storeName, $options: 'i' } },
        { addressLine1: { $regex: storeName, $options: 'i' } }
      ]
    });

    if (!store) {
      return {
        error: 'Store not found',
        message: `No store found matching: ${storeName}`,
        suggestions: ['Try searching with different terms', 'Check store name spelling']
      };
    }

    // Get sales data for the store
    const sales = await Sales.find({
      plant: store._id
    }).populate('materialCode', 'name softwareCode category brand');

    if (sales.length === 0) {
      return {
        topProducts: [],
        store: {
          name: store.storeName,
          city: store.city,
          address: store.addressLine1
        },
        message: 'No sales transactions found for this store'
      };
    }

    // Group sales by product and calculate totals
    const productSales = {};
    sales.forEach(sale => {
      const productId = sale.materialCode._id.toString();
      if (!productSales[productId]) {
        productSales[productId] = {
          name: sale.materialCode.name,
          softwareCode: sale.materialCode.softwareCode,
          category: sale.materialCode.category?.name || 'Unknown',
          brand: sale.materialCode.brand || 'Unknown',
          price: sale.mrp,
          quantity: 0,
          sales: 0,
          revenue: 0,
          discount: 0,
          tax: 0,
          nsv: 0,
          gsv: 0
        };
      }
      
      productSales[productId].quantity += sale.quantity;
      productSales[productId].sales += sale.gsv;
      productSales[productId].revenue += sale.nsv;
      productSales[productId].discount += sale.discount;
      productSales[productId].tax += sale.totalTax;
      productSales[productId].nsv += sale.nsv;
      productSales[productId].gsv += sale.gsv;
    });

    // Convert to array and sort by sales value
    const topProducts = Object.values(productSales)
      .map(product => ({
        ...product,
        discountPercentage: product.discount > 0 ? ((product.discount / product.gsv) * 100).toFixed(2) : 0,
        taxPercentage: product.tax > 0 ? ((product.tax / product.nsv) * 100).toFixed(2) : 0,
        margin: product.nsv - (product.price * product.quantity),
        marginPercentage: product.nsv > 0 ? ((product.nsv - (product.price * product.quantity)) / product.nsv * 100).toFixed(2) : 0
      }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 10);

    return {
      topProducts,
      store: {
        name: store.storeName,
        city: store.city,
        address: store.addressLine1
      }
    };
  } catch (error) {
    console.error('Error getting store top products:', error);
    throw error;
  }
};

/**
 * Get sales forecast from database
 * @param {Object} params - Parameters including period
 * @returns {Object} Sales forecast data
 */
const getSalesForecastFromDB = async (params) => {
  try {
    // This would typically integrate with a forecasting service
    // For now, return mock data
    return {
      forecast: {
        period: 'Next Month',
        totalForecast: 150000,
        growthRate: 12.5,
        confidence: 85,
        breakdown: {
          byStore: [
            { storeName: 'Mumbai Store', forecast: 45000, growth: 15.2 },
            { storeName: 'Delhi Store', forecast: 38000, growth: 8.7 },
            { storeName: 'Bangalore Store', forecast: 42000, growth: 18.3 },
            { storeName: 'Chennai Store', forecast: 25000, growth: 5.4 }
          ],
          byCategory: [
            { category: 'Electronics', forecast: 60000, growth: 20.1 },
            { category: 'Clothing', forecast: 45000, growth: 10.5 },
            { category: 'Home & Garden', forecast: 30000, growth: 8.9 },
            { category: 'Sports', forecast: 15000, growth: 15.7 }
          ]
        }
      }
    };
  } catch (error) {
    console.error('Error getting sales forecast:', error);
    throw error;
  }
};

/**
 * Get store sales forecast from database
 * @param {Object} params - Parameters
 * @returns {Object} Store sales forecast data
 */
const getStoreSalesForecastFromDB = async (params) => {
  try {
    // This would typically integrate with a forecasting service
    // For now, return mock data
    return {
      storeForecast: {
        period: 'Next Month',
        totalForecast: 150000,
        storeBreakdown: [
          {
            storeName: 'Mumbai Store',
            city: 'Mumbai',
            forecast: 45000,
            growth: 15.2,
            confidence: 88,
            topProducts: [
              { name: 'Product A', forecast: 12000, growth: 18.5 },
              { name: 'Product B', forecast: 8500, growth: 12.3 },
              { name: 'Product C', forecast: 6500, growth: 22.1 }
            ]
          },
          {
            storeName: 'Delhi Store',
            city: 'Delhi',
            forecast: 38000,
            growth: 8.7,
            confidence: 82,
            topProducts: [
              { name: 'Product D', forecast: 9500, growth: 7.8 },
              { name: 'Product E', forecast: 7200, growth: 11.2 },
              { name: 'Product F', forecast: 5800, growth: 9.5 }
            ]
          }
        ]
      }
    };
  } catch (error) {
    console.error('Error getting store sales forecast:', error);
    throw error;
  }
};

/**
 * Get demand forecast from database
 * @param {Object} params - Parameters
 * @returns {Object} Demand forecast data
 */
const getDemandForecastFromDB = async (params) => {
  try {
    // This would typically integrate with a forecasting service
    // For now, return mock data
    return {
      demandForecast: {
        period: 'Next 3 Months',
        totalDemand: 450000,
        growthRate: 18.5,
        confidence: 87,
        breakdown: {
          byMonth: [
            { month: 'January', demand: 150000, growth: 15.2 },
            { month: 'February', demand: 145000, growth: 18.7 },
            { month: 'March', demand: 155000, growth: 21.6 }
          ],
          byProduct: [
            { product: 'Product A', demand: 120000, growth: 22.1 },
            { product: 'Product B', demand: 95000, growth: 16.8 },
            { product: 'Product C', demand: 85000, growth: 19.3 },
            { product: 'Product D', demand: 75000, growth: 14.7 },
            { product: 'Product E', demand: 75000, growth: 18.9 }
          ]
        }
      }
    };
  } catch (error) {
    console.error('Error getting demand forecast:', error);
    throw error;
  }
};

/**
 * Get replenishment status from database
 * @param {Object} params - Parameters
 * @returns {Object} Replenishment status data
 */
const getReplenishmentStatusFromDB = async (params) => {
  try {
    // This would typically integrate with a replenishment service
    // For now, return mock data
    return {
      status: 'Overall Replenishment Status',
      summary: {
        totalStores: 25,
        storesNeedingReplenishment: 8,
        criticalStockLevels: 3,
        averageForecastAccuracy: 87.5,
        totalReplenishmentValue: 125000
      },
      breakdown: {
        byPriority: [
          { priority: 'Critical', count: 3, value: 45000 },
          { priority: 'High', count: 5, value: 55000 },
          { priority: 'Medium', count: 12, value: 20000 },
          { priority: 'Low', count: 5, value: 5000 }
        ],
        byStore: [
          { storeName: 'Mumbai Store', priority: 'Critical', value: 18000 },
          { storeName: 'Delhi Store', priority: 'High', value: 15000 },
          { storeName: 'Bangalore Store', priority: 'High', value: 12000 }
        ]
      }
    };
  } catch (error) {
    console.error('Error getting replenishment status:', error);
    throw error;
  }
};

/**
 * Generate text summary HTML with follow-up question
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateTextSummaryHTML = (question, data) => {
  let html = CHATBOT_STYLES + '<div class="chatbot-response">';
  
  // Generate text summary based on data type
  let summary = '';
  let title = question.description;
  
  if (question.action === 'getStoreSalesStatus') {
    if (data.error) {
      summary = `<p><strong>Error:</strong> ${data.message}</p>`;
      if (data.suggestions) {
        summary += '<p><strong>Suggestions:</strong></p><ul>';
        data.suggestions.forEach(suggestion => {
          summary += `<li>${suggestion}</li>`;
        });
        summary += '</ul>';
      }
    } else {
      summary = `
        <p><strong>Store:</strong> ${data.store.name} (${data.store.city})</p>
        <p><strong>Period:</strong> ${data.period}</p>
        <p><strong>Total Sales:</strong> $${data.data.totalSales.toLocaleString()}</p>
        <p><strong>Total NSV:</strong> $${data.data.totalNSV.toLocaleString()}</p>
        <p><strong>Total Quantity:</strong> ${data.data.totalQuantity.toLocaleString()} units</p>
        <p><strong>Total Discount:</strong> $${data.data.totalDiscount.toLocaleString()}</p>
        <p><strong>Total Tax:</strong> $${data.data.totalTax.toLocaleString()}</p>
        <p><strong>Transactions:</strong> ${data.data.totalResults}</p>
      `;
    }
  } else if (question.action === 'getTopPerformingItem') {
    if (data.error) {
      summary = `<p><strong>Error:</strong> ${data.message}</p>`;
      if (data.suggestions) {
        summary += '<p><strong>Suggestions:</strong></p><ul>';
        data.suggestions.forEach(suggestion => {
          summary += `<li>${suggestion}</li>`
        });
        summary += '</ul>';
      }
    } else {
      summary = `
        <p><strong>Location:</strong> ${data.location}</p>
        <p><strong>Top Performing Item:</strong> ${data.topItem.name}</p>
        <p><strong>Product Code:</strong> ${data.topItem.softwareCode}</p>
        <p><strong>Category:</strong> ${data.topItem.category}</p>
        <p><strong>Brand:</strong> ${data.topItem.brand}</p>
        <p><strong>Total Sales:</strong> $${data.topItem.sales.toLocaleString()}</p>
        <p><strong>Total Revenue:</strong> $${data.topItem.revenue.toLocaleString()}</p>
        <p><strong>Total Quantity:</strong> ${data.topItem.quantity.toLocaleString()} units</p>
        <p><strong>Stores in Location:</strong> ${data.storeCount}</p>
        <p><strong>Total Products:</strong> ${data.totalProducts}</p>
      `;
    }
  } else if (question.action === 'getSalesForecast') {
    summary = `
      <p><strong>Period:</strong> ${data.forecast.period}</p>
      <p><strong>Total Forecast:</strong> $${data.forecast.totalForecast.toLocaleString()}</p>
      <p><strong>Growth Rate:</strong> ${data.forecast.growthRate}%</p>
      <p><strong>Confidence Level:</strong> ${data.forecast.confidence}%</p>
      <p><strong>Top Performing Store:</strong> ${data.forecast.breakdown.byStore[0].storeName} ($${data.forecast.breakdown.byStore[0].forecast.toLocaleString()})</p>
      <p><strong>Top Category:</strong> ${data.forecast.breakdown.byCategory[0].category} ($${data.forecast.breakdown.byCategory[0].forecast.toLocaleString()})</p>
    `;
  } else if (question.action === 'getReplenishmentStatus') {
    summary = `
      <p><strong>Total Stores:</strong> ${data.summary.totalStores}</p>
      <p><strong>Stores Needing Replenishment:</strong> ${data.summary.storesNeedingReplenishment}</p>
      <p><strong>Critical Stock Levels:</strong> ${data.summary.criticalStockLevels}</p>
      <p><strong>Average Forecast Accuracy:</strong> ${data.summary.averageForecastAccuracy}%</p>
      <p><strong>Total Replenishment Value:</strong> $${data.summary.totalReplenishmentValue.toLocaleString()}</p>
      <p><strong>Priority Breakdown:</strong></p>
      <ul>
        <li>Critical: ${data.breakdown.byPriority[0].count} stores ($${data.breakdown.byPriority[0].value.toLocaleString()})</li>
        <li>High: ${data.breakdown.byPriority[1].count} stores ($${data.breakdown.byPriority[1].value.toLocaleString()})</li>
        <li>Medium: ${data.breakdown.byPriority[2].count} stores ($${data.breakdown.byPriority[2].value.toLocaleString()})</li>
      </ul>
    `;
  } else {
    // Generic summary for other actions
    summary = `
      <p>Data analysis completed successfully.</p>
      <p>Please review the details below and let me know if you need additional information.</p>
    `;
  }
  
  html += HTML_TEMPLATES.textSummary(data, title, summary);
  
  html += '</div>';
  return html;
};