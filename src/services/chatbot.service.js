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
      return { value: `₹${data.totalSales.toLocaleString()}`, subtitle: 'Sales' };
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

  'which was top performing item in': {
    type: 'storeSales',
    action: 'getTopPerformingItem',
    description: 'Get top performing item for specific location',
    parameters: { location: '' },
    requiresInput: true,
    inputPrompt: 'Please provide the location (city, state, or area):',
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
  'what are the top products in store LUC-66': {
    type: 'storeSales',
    action: 'getStoreTopProducts',
    description: 'Get top performing products for store LUC-66',
    parameters: { storeId: 'LUC-66' },
    htmlTemplate: 'textSummary'
  },
  'what are the top products in store SUR-5': {
    type: 'storeSales',
    action: 'getStoreTopProducts',
    description: 'Get top performing products for store SUR-5',
    parameters: { storeId: 'SUR-5' },
    htmlTemplate: 'textSummary'
  },
  'show me top products in store': {
    type: 'storeSales',
    action: 'getStoreTopProducts',
    description: 'Get top performing products for a specific store',
    parameters: { storeName: '' },
    requiresInput: true,
    inputPrompt: 'Please provide the store name or location:',
    htmlTemplate: 'textSummary'
  },
  'top products in store': {
    type: 'storeSales',
    action: 'getStoreTopProducts',
    description: 'Get top performing products for a specific store',
    parameters: { storeName: '' },
    requiresInput: true,
    inputPrompt: 'Please provide the store name, store ID, or location:',
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
 * Extract location from user message for top performing item queries
 * @param {string} message - User message
 * @returns {string|null} - Extracted location or null
 */
const extractLocationFromMessage = (message) => {
  // Common patterns for location extraction
  const locationPatterns = [
    /which was top performing item in (\w+)/i,
    /top performing item in (\w+)/i,
    /top item in (\w+)/i,
    /best performing item in (\w+)/i,
    /top product in (\w+)/i
  ];

  for (const pattern of locationPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
};

/**
 * Find matching question with dynamic parameter extraction
 * @param {string} message - User message
 * @returns {Object|null} - Matched question with extracted parameters
 */
const findMatchingQuestion = (message) => {
  // Check for dynamic location extraction first
  const extractedLocation = extractLocationFromMessage(message);
  if (extractedLocation) {
    return {
      type: 'storeSales',
      action: 'getTopPerformingItem',
      description: `Get top performing item for ${extractedLocation}`,
      parameters: { location: extractedLocation },
      htmlTemplate: 'textSummary'
    };
  }

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
    'surat': ['which was top performing item in surat', 'which was top performing item in chandigarh'],
    'forecast': ['what is the sales forecast for next month', 'show me sales forecast by store', 'what is the demand forecast'],
    'replenishment status': ['what is the replenishment status'],
    'store sales': ['show me sales performance for store', 'what are the top products in store'],
    'store products': ['what are the top products in store', 'show me top products in store'],
    'top products': ['what are the top products in store', 'show me top products in store'],
    'LUC-66': ['what are the top products in store LUC-66'],
    'SUR-5': ['what are the top products in store SUR-5']
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
      const activeProducts = await productService.queryProducts({ status: 'active' }, { 
        limit: 10, 
        populate: 'category' 
      });
      
      // Debug: Check what's being returned
      console.log('Active products debug:', {
        totalResults: activeProducts.totalResults,
        resultsCount: activeProducts.results?.length || 0,
        firstProduct: activeProducts.results?.[0] ? {
          name: activeProducts.results[0].name,
          category: activeProducts.results[0].category,
          categoryType: typeof activeProducts.results[0].category,
          hasName: activeProducts.results[0].category?.name
        } : 'No products'
      });
      
      return activeProducts;
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
              suggestions.push('Try: "which was top performing item in [city name]"');
    } else if (message.includes('forecast') || message.includes('prediction') || message.includes('future')) {
      suggestions.push('Try: "what is the sales forecast for next month"', 'Try: "show me sales forecast by store"');
    } else if (message.includes('replenishment status') || message.includes('stock status')) {
      suggestions.push('Try: "what is the replenishment status"');
    } else if (message.includes('top products') || message.includes('store products')) {
      suggestions.push('Try: "what are the top products in store"', 'Try: "show me top products in store"');
    } else if (message.includes('LUC-66') || message.includes('SUR-5') || /\b[A-Z]{3}-\d+\b/.test(message)) {
      // Pattern for store IDs like LUC-66, SUR-5, etc.
      suggestions.push('Try: "what are the top products in store [STORE-ID]"', 'Try: "show me sales performance for store [STORE-ID]"');
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
      // Debug: Check category data
      console.log('Product data cleaning debug:', {
        name: item.name,
        category: item.category,
        categoryType: typeof item.category,
        hasName: item.category?.name,
        categoryKeys: item.category ? Object.keys(item.category) : 'No category'
      });
      
      cleanedItem['Name'] = item.name;
      cleanedItem['Code'] = item.softwareCode;
      cleanedItem['Status'] = item.status || 'Unknown';
      if (item.category && typeof item.category === 'object') {
        cleanedItem['Category'] = item.category.name || 'Unknown';
      } else {
        cleanedItem['Category'] = 'Category not populated';
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
      cleanedItem['Sales'] = `₹${item.sales.toLocaleString()}`;
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
            cleanedItem[key] = `₹${value.toLocaleString()}`;
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
    }).populate({
      path: 'materialCode',
      select: 'name softwareCode category',
      populate: {
        path: 'category',
        select: 'name'
      }
    });

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
    }).populate({
      path: 'materialCode',
      select: 'name softwareCode category',
      populate: {
        path: 'category',
        select: 'name'
      }
    }).populate('plant', 'storeName city');

    // Debug: Check what's being populated
    if (sales.length > 0) {
      console.log('Sample sale materialCode debug:', {
        firstSale: sales[0].materialCode,
        category: sales[0].materialCode?.category,
        categoryType: typeof sales[0].materialCode?.category,
        hasName: sales[0].materialCode?.category?.name,
        materialCodeKeys: Object.keys(sales[0].materialCode || {}),
        categoryKeys: sales[0].materialCode?.category ? Object.keys(sales[0].materialCode.category) : 'No category'
      });
    }

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
          brand: 'Brand info not available', // Product model doesn't have brand field
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

    // Calculate percentages and profit metrics
    topItem.discountPercentage = topItem.discount > 0 ? ((topItem.discount / topItem.gsv) * 100).toFixed(2) : 0;
    topItem.taxPercentage = topItem.tax > 0 ? ((topItem.tax / topItem.nsv) * 100).toFixed(2) : 0;
    
    // Calculate discount impact (how much revenue was lost due to discounts)
    topItem.discountImpact = topItem.gsv - topItem.nsv;
    topItem.discountImpactPercentage = topItem.gsv > 0 ? ((topItem.discountImpact / topItem.gsv) * 100).toFixed(2) : 0;
    
    // Calculate estimated gross profit (NSV - Estimated Cost)
    // Assuming cost is 70% of MRP (30% markup)
    const estimatedCost = topItem.price * topItem.quantity * 0.7;
    topItem.estimatedGrossProfit = topItem.nsv - estimatedCost;
    topItem.estimatedGrossProfitPercentage = topItem.nsv > 0 ? ((topItem.estimatedGrossProfit / topItem.nsv) * 100).toFixed(2) : 0;
    
    // Calculate actual profit margin (NSV - GSV + Discount) - this should be 0 if discount = GSV - NSV
    topItem.actualProfitMargin = topItem.nsv - (topItem.gsv - topItem.discount);
    topItem.actualProfitMarginPercentage = topItem.nsv > 0 ? ((topItem.actualProfitMargin / topItem.nsv) * 100).toFixed(2) : 0;

            // Debug category information
        console.log('Top item category debug:', {
          category: topItem.category,
          categoryType: typeof topItem.category,
          hasName: topItem.category?.name,
          rawCategory: topItem.category,
          productName: topItem.name,
          softwareCode: topItem.softwareCode
        });

        // Debug profit calculations
        console.log('Top item profit debug:', {
          productName: topItem.name,
          gsv: topItem.gsv,
          nsv: topItem.nsv,
          discount: topItem.discount,
          price: topItem.price,
          quantity: topItem.quantity,
          discountImpact: topItem.discountImpact,
          estimatedCost: topItem.price * topItem.quantity * 0.7,
          estimatedGrossProfit: topItem.estimatedGrossProfit,
          actualProfitMargin: topItem.actualProfitMargin
        });

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
    }).populate({
      path: 'materialCode',
      select: 'name softwareCode category',
      populate: {
        path: 'category',
        select: 'name'
      }
    }).sort({ date: -1 })
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
 * @param {Object} params - Parameters including storeName or storeId
 * @returns {Object} Store top products data
 */
const getStoreTopProductsFromDB = async (params) => {
  try {
    const { storeName, storeId } = params;
    
    if (!storeName && !storeId) {
      return {
        error: 'Store identifier required',
        message: 'Please provide a store name, location, or store ID to search for'
      };
    }

    let store;
    
    // Search by store ID first (more specific)
    if (storeId) {
      // Check if storeId is a valid ObjectId
      const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(storeId);
      
      if (isValidObjectId) {
        store = await Store.findOne({
          $or: [
            { storeId: storeId },
            { _id: storeId }
          ]
        });
      } else {
        // If not a valid ObjectId, search by storeId as a string
        store = await Store.findOne({ storeId: storeId });
      }
      
      // If not found by storeId, try to find by other fields
      if (!store) {
        store = await Store.findOne({
          $or: [
            { storeName: { $regex: storeId, $options: 'i' } },
            { city: { $regex: storeId, $options: 'i' } },
            { addressLine1: { $regex: storeId, $options: 'i' } }
          ]
        });
      }
    }
    
    // If not found by ID, search by name or location
    if (!store && storeName) {
      store = await Store.findOne({
        $or: [
          { storeName: { $regex: storeName, $options: 'i' } },
          { city: { $regex: storeName, $options: 'i' } },
          { addressLine1: { $regex: storeName, $options: 'i' } },
          { storeId: { $regex: storeName, $options: 'i' } }
        ]
      });
    }
    
    // Enhanced search: try to find by partial matches
    if (!store) {
      const searchTerm = storeId || storeName;
      if (searchTerm) {
        // Try different search patterns
        store = await Store.findOne({
          $or: [
            // Exact store ID match
            { storeId: searchTerm },
            // Store ID contains search term
            { storeId: { $regex: searchTerm, $options: 'i' } },
            // Store name contains search term
            { storeName: { $regex: searchTerm, $options: 'i' } },
            // Store name starts with search term
            { storeName: { $regex: `^${searchTerm}`, $options: 'i' } },
            // Store name contains search term (with "Store" prefix)
            { storeName: { $regex: `Store ${searchTerm}`, $options: 'i' } },
            // City contains search term
            { city: { $regex: searchTerm, $options: 'i' } },
            // Address contains search term
            { addressLine1: { $regex: searchTerm, $options: 'i' } },
            // Business partner code
            { bpCode: { $regex: searchTerm, $options: 'i' } }
          ]
        });
      }
    }

    if (!store) {
      return {
        error: 'Store not found',
        message: `No store found matching: ${storeId || storeName}`,
        suggestions: ['Try searching with different terms', 'Check store ID or name spelling']
      };
    }

    // Get sales data for the store
    const sales = await Sales.find({
      plant: store._id
    }).populate({
      path: 'materialCode',
      select: 'name softwareCode category',
      populate: {
        path: 'category',
        select: 'name'
      }
    });

    // Debug: Check what's being populated
    if (sales.length > 0) {
      console.log('Store sales materialCode debug:', {
        firstSale: sales[0].materialCode,
        category: sales[0].materialCode?.category,
        categoryType: typeof sales[0].materialCode?.category,
        hasName: sales[0].materialCode?.category?.name,
        materialCodeKeys: Object.keys(sales[0].materialCode || {}),
        categoryKeys: sales[0].materialCode?.category ? Object.keys(sales[0].materialCode.category) : 'No category'
      });
    }

    if (sales.length === 0) {
      return {
        topProducts: [],
        store: {
          name: store.storeName,
          storeId: store.storeId,
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
          brand: 'Brand info not available', // Product model doesn't have brand field
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
        discountImpact: product.gsv - product.nsv,
        discountImpactPercentage: product.gsv > 0 ? ((product.gsv - product.nsv) / product.gsv * 100).toFixed(2) : 0,
        estimatedGrossProfit: product.nsv - (product.price * product.quantity * 0.7),
        estimatedGrossProfitPercentage: product.nsv > 0 ? ((product.nsv - (product.price * product.quantity * 0.7)) / product.nsv * 100).toFixed(2) : 0
      }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 10);

    return {
      topProducts,
      store: {
        name: store.storeName,
        storeId: store.storeId,
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
    // For now, return empty data structure
    return {
      forecast: {
        period: 'Next Month',
        totalForecast: 0,
        growthRate: 0,
        confidence: 0,
        breakdown: {
          byStore: [],
          byCategory: []
        }
      },
      message: 'Sales forecast data not available. Please check database connection.'
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
    // For now, return empty data structure
    return {
      storeForecast: {
        period: 'Next Month',
        totalForecast: 0,
        storeBreakdown: []
      },
      message: 'Store sales forecast data not available. Please check database connection.'
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
    // For now, return empty data structure
    return {
      demandForecast: {
        period: 'Next 3 Months',
        totalDemand: 0,
        growthRate: 0,
        confidence: 0,
        breakdown: {
          byMonth: [],
          byProduct: []
        }
      },
      message: 'Demand forecast data not available. Please check database connection.'
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
    // For now, return empty data structure
    return {
      status: 'No replenishment data available',
      summary: {
        totalStores: 0,
        storesNeedingReplenishment: 0,
        criticalStockLevels: 0,
        averageForecastAccuracy: 0,
        totalReplenishmentValue: 0
      },
      breakdown: {
        byPriority: [],
        byStore: []
      },
      message: 'Replenishment data not available. Please check database connection.'
    };
  } catch (error) {
    console.error('Error getting replenishment status:', error);
    throw error;
  }
};

/**
 * Generate text summary HTML with natural, conversational language
 * @param {Object} question - Question object
 * @param {Object} data - Response data
 * @returns {string} HTML string
 */
const generateTextSummaryHTML = (question, data) => {
  let summary = '';

  if (question.action === 'getStoreSalesStatus') {
    if (data.data && data.data.totalSales > 0) {
      summary = `
        <p>Hey! I found the sales data for ${data.location || 'that location'} for last month. Here's what's happening:</p>
        <p>The total sales came to <strong>₹${data.data.totalSales.toLocaleString()}</strong>, which is pretty solid! The net sales value is <strong>₹${data.data.totalNSV.toLocaleString()}</strong>, and they moved about <strong>${data.data.totalQuantity.toLocaleString()} units</strong>.</p>
        <p>I also noticed they had <strong>₹${data.data.totalDiscount.toLocaleString()}</strong> in discounts and <strong>₹${data.data.totalTax.toLocaleString()}</strong> in taxes. Overall, it looks like a good month with <strong>${data.data.totalResults}</strong> transactions processed.</p>
      `;
    } else {
      summary = `
        <p>I looked for sales data for ${data.location || 'that location'} but couldn't find anything for last month. This could mean either there were no sales recorded, or maybe the data isn't available yet.</p>
        <p>Would you like me to check a different time period, or maybe look at a different store location?</p>
      `;
    }
  } else if (question.action === 'getTopPerformingItem') {
    if (data.topItem) {
      summary = `
        <p>Great question! I dug into the data for <strong>${data.location || 'that area'}</strong> and found the star performer:</p>
        <p><strong>${data.topItem.name}</strong> is absolutely crushing it! This product (code: <strong>${data.topItem.softwareCode}</strong>) brought in <strong>₹${data.topItem.sales.toLocaleString()}</strong> in sales and generated <strong>₹${data.topItem.revenue.toLocaleString()}</strong> in revenue.</p>
        <p>They sold <strong>${data.topItem.quantity.toLocaleString()} units</strong> with an estimated gross profit of <strong>₹${data.topItem.estimatedGrossProfit?.toLocaleString() || '0'}</strong> (${data.topItem.estimatedGrossProfitPercentage || '0'}% of revenue). The product is in the <strong>${data.topItem.category || 'general'}</strong> category.</p>
        <p><em>Note: Estimated gross profit assumes 30% markup on MRP. Discount impact: ₹${data.topItem.discountImpact?.toLocaleString() || '0'} (${data.topItem.discountImpactPercentage || '0'}% of gross sales).</em></p>
        <p>I also noticed there are <strong>${data.storeCount || 0} stores</strong> in that location, and they're carrying <strong>${data.totalProducts || 0} different products</strong> total. Pretty impressive variety!</p>
        <p>This item is definitely a winner in that location - it's clearly resonating with customers!</p>
      `;
    } else {
      summary = `
        <p>I searched through the data for <strong>${data.location || 'that area'}</strong> but couldn't find any top performing items. This might be because there's no sales data available, or maybe the location name doesn't match exactly.</p>
        <p>Could you try asking about a different location, or maybe check if the spelling is correct? I'm here to help once we get the right data!</p>
      `;
    }
  } else if (question.action === 'getStoreSalesPerformance') {
    if (data.performance && data.performance.totalSales > 0) {
      summary = `
        <p>Let me tell you about the sales performance for <strong>${data.storeName || 'that store'}</strong>:</p>
        <p>They had a total sales volume of <strong>₹${data.performance.totalSales.toLocaleString()}</strong> with net sales value of <strong>₹${data.performance.totalNSV.toLocaleString()}</strong>. Pretty good numbers!</p>
        <p>They processed <strong>${data.performance.totalQuantity.toLocaleString()} units</strong> across <strong>${data.performance.totalResults}</strong> transactions. The discount amount was <strong>₹${data.performance.totalDiscount.toLocaleString()}</strong> and taxes came to <strong>₹${data.performance.totalTax.toLocaleString()}</strong>.</p>
        <p>Overall, it looks like a solid performance month for them!</p>
      `;
    } else {
      summary = `
        <p>I tried to get the sales performance for <strong>${data.storeName || 'that store'}</strong>, but I couldn't find any data. This could mean either the store doesn't exist in our system, or there's no sales data recorded for them yet.</p>
        <p>Could you double-check the store name? I'm happy to help once we get the right information!</p>
      `;
    }
  } else if (question.action === 'getSalesForecast') {
    if (data.forecast && data.forecast.totalForecast > 0) {
      summary = `
        <p>Looking at the sales forecast for <strong>${data.forecast.period}</strong>, things are looking pretty promising!</p>
        <p>The total forecast is <strong>₹${data.forecast.totalForecast.toLocaleString()}</strong> with a growth rate of <strong>${data.forecast.growthRate}%</strong>. I'm feeling confident about this prediction - our confidence level is <strong>${data.forecast.confidence}%</strong>.</p>
        <p>The top performing store is expected to be <strong>${data.forecast.breakdown.byStore[0]?.storeName || 'one of our stores'}</strong> with a forecast of <strong>₹${data.forecast.breakdown.byStore[0]?.forecast?.toLocaleString() || '0'}</strong>.</p>
        <p>And the <strong>${data.forecast.breakdown.byCategory[0]?.category || 'top category'}</strong> is projected to bring in <strong>₹${data.forecast.breakdown.byCategory[0]?.forecast?.toLocaleString() || '0'}</strong>.</p>
        <p>Pretty exciting numbers, don't you think?</p>
      `;
    } else {
      summary = `
        <p>I tried to get the sales forecast data, but it looks like there's nothing available right now. This could be because the forecasting system isn't set up yet, or maybe there's not enough historical data to make predictions.</p>
        <p>Would you like me to check if there are any other analytics available, or maybe we can look at historical sales data instead?</p>
      `;
    }
  } else if (question.action === 'getReplenishmentStatus') {
    if (data.summary && data.summary.totalStores > 0) {
      summary = `
        <p>Let me give you the lowdown on the replenishment situation across all our stores:</p>
        <p>Out of <strong>${data.summary.totalStores}</strong> total stores, we have <strong>${data.summary.storesNeedingReplenishment}</strong> that need restocking. That's actually pretty manageable!</p>
        <p>There are <strong>${data.summary.criticalStockLevels}</strong> stores with critical stock levels that need immediate attention. Our forecast accuracy is sitting at <strong>${data.summary.averageForecastAccuracy}%</strong>, which is pretty solid.</p>
        <p>The total replenishment value across all stores is <strong>₹${data.summary.totalReplenishmentValue.toLocaleString()}</strong>.</p>
        <p>Here's the priority breakdown:</p>
        <ul>
          ${data.breakdown.byPriority.map(priority => 
            `<li><strong>${priority.priority}:</strong> ${priority.count} stores need attention (₹${priority.value.toLocaleString()})</li>`
          ).join('')}
        </ul>
        <p>Overall, the replenishment situation looks pretty well under control!</p>
      `;
    } else {
      summary = `
        <p>I tried to check the replenishment status, but I couldn't find any data available. This might mean the replenishment system isn't set up yet, or there's no data being tracked.</p>
        <p>Would you like me to help you set up replenishment tracking, or maybe we can look at inventory levels instead?</p>
      `;
    }
  } else if (question.action === 'getStoreTopProducts') {
    if (data.error) {
      summary = `
        <p>Oops! I ran into an issue while trying to get the top products for that store. The error says: <strong>${data.error}</strong></p>
        <p>This usually happens when the store name or ID doesn't match what's in our system. Could you double-check the store information and try again?</p>
        <p>I'm here to help once we get the right details!</p>
      `;
    } else if (data.topProducts && data.topProducts.length > 0) {
      // Real data with store info
      summary = `
        <p>Great! I found the top performing products for <strong>${data.store.name}</strong> (${data.store.storeId}) in <strong>${data.store.city}</strong>.</p>
        <p>I discovered <strong>${data.topProducts.length}</strong> products with solid performance. Here are the top 5 that are really killing it:</p>
        <ul>
          ${data.topProducts.slice(0, 5).map((product, index) => `
            <li><strong>${index + 1}. ${product.name}</strong> (${product.softwareCode})</li>
            <li>&nbsp;&nbsp;&nbsp;Sales: <strong>₹${product.sales.toLocaleString()}</strong> | Quantity: <strong>${product.quantity} units</strong> | Revenue: <strong>₹${product.revenue.toLocaleString()}</strong> | Est. Profit: <strong>₹${product.estimatedGrossProfit?.toLocaleString() || '0'}</strong></li>
          `).join('')}
        </ul>
        <p>Here's the overall performance summary:</p>
        <ul>
          <li>Total Sales Value: <strong>₹${data.topProducts.reduce((sum, p) => sum + p.sales, 0).toLocaleString()}</strong></li>
          <li>Total Revenue: <strong>₹${data.topProducts.reduce((sum, p) => sum + p.revenue, 0).toLocaleString()}</strong></li>
          <li>Total Quantity: <strong>${data.topProducts.reduce((sum, p) => sum + p.quantity, 0).toLocaleString()} units</strong></li>
          <li>Total Estimated Gross Profit: <strong>₹${data.topProducts.reduce((sum, p) => sum + (p.estimatedGrossProfit || 0), 0).toLocaleString()}</strong></li>
          <li>Total Discount Impact: <strong>₹${data.topProducts.reduce((sum, p) => sum + (p.discountImpact || 0), 0).toLocaleString()}</strong></li>
        </ul>
        <p><em>Note: Estimated gross profit assumes 30% markup on MRP. Discount impact shows revenue lost due to discounts.</em></p>
        <p>Pretty impressive numbers, right? This store is definitely moving some product!</p>
      `;
    } else {
      summary = `
        <p>I looked for top products in <strong>${data.store?.name || 'that store'}</strong> (${data.store?.storeId || 'unknown ID'}), but I couldn't find any sales data.</p>
        <p>This could mean either the store doesn't have any sales recorded yet, or maybe there's no data for the time period you're asking about.</p>
        <p>Would you like me to check a different store, or maybe look at a different time period?</p>
      `;
    }
  } else {
    summary = `
      <p>I found some data, but I'm not sure how to present it in the best way. Here's what I have:</p>
      <p><strong>Data:</strong> ${JSON.stringify(data, null, 2)}</p>
      <p>Let me know if you'd like me to format this differently or if you have a specific question about the data!</p>
    `;
  }

  return HTML_TEMPLATES.textSummary(data, 'Analysis Results', summary);
};